// Servidor HTTP (sem framework): API, autenticação, arquivos e frontend estático.
import { createServer } from 'node:http';
import { DIAS_TESTE } from '../app/acesso.js';
import { confirmarPorDecursoDePrazo } from '../app/actions/pagamentos.js';
import { garantirModelosPadrao } from '../app/actions/mensagens.js';
import { rodarLembretes } from '../app/lembretes.js';
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { abrirBanco } from './db.js';
import { abrirBancoPg } from './db-pg.js';
import { armazenamentoSupabase, configSupabase } from './armazenamento.js';
import { gzipSync } from 'node:zlib';
import { criarAuth } from './auth.js';
import { criarArquivos } from './files.js';
import { handle } from '../app/router.js';
import { criarEmail, configSMTP } from './email.js';
import { criarWhatsApp, configWhatsApp } from './whatsapp.js';
import { criarAsaas, configAsaas } from './asaas.js';
import { criarDescadastro, paginaDescadastro } from './descadastro.js';
import { getById, alterar, notificar } from '../app/context.js';
import { processarWebhookWhatsApp } from '../app/actions/whatsapp.js';
import { processarWebhookAsaas } from '../app/actions/comercial.js';
import { executarRetencao } from '../app/retencao.js';
import { PERFIS_HS } from '../core/permissions.js';
import { TABELA_PADRAO, rotuloFaixa } from '../core/comissao.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.webp': 'image/webp' };
const COOKIE = 'hs_sessao';

const SISTEMA = { id: 'sistema', nome: 'Sistema', email: 'sistema', perfil: 'SISTEMA', status: 'ATIVO' };
// Ações liberadas para quem ainda precisa ativar o 2FA obrigatório
const LIBERADAS_SEM_2FA = new Set(['meuPerfil', 'listarNotificacoes', 'marcarNotificacaoLida']);

export function criarApp({ dataDir = './data', urlBase = '', producao = false, webDir = './web/dist', arquivoBanco, env = process.env, transporteEmail, fetchImpl, exigir2faHS = env.EXIGIR_2FA_HS !== 'false', confiarProxy = false } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const segredoPath = join(dataDir, 'segredo');
  const segredo = env.SEGREDO || (existsSync(segredoPath) ? readFileSync(segredoPath, 'utf8') : (() => { const s = randomBytes(32).toString('hex'); writeFileSync(segredoPath, s, { mode: 0o600 }); return s; })());
  const databaseUrl = env.DATABASE_URL;
  const esquema = env.DATABASE_SCHEMA === 'auto' ? `t_${randomBytes(6).toString('hex')}` : env.DATABASE_SCHEMA || null;
  const banco = databaseUrl ? abrirBancoPg(databaseUrl, { schema: esquema, env }) : abrirBanco(arquivoBanco || join(dataDir, 'hs.sqlite'));
  const supa = configSupabase(env);
  const armazenamento = supa ? armazenamentoSupabase(supa, fetchImpl || fetch) : undefined;
  if (databaseUrl && !supa) console.warn('[hs] DATABASE_URL sem SUPABASE_URL/SUPABASE_SERVICE_KEY: anexos ficarão no disco local (podem se perder em hospedagens sem disco permanente).');
  if (databaseUrl && !env.SEGREDO) console.warn('[hs] Defina SEGREDO no ambiente: sem ele, links de arquivos e 2FA deixam de valer a cada reinício.');
  const { db, exclusivo } = banco;
  const email = criarEmail({ config: configSMTP(env), transporte: transporteEmail, urlBase, env, fetchImpl });
  // Verificação do login: código por e-mail (padrão quando há envio de e-mail) ou aplicativo autenticador
  let metodoVerificacao = env.VERIFICACAO_LOGIN || (email.disponivel ? 'email' : 'app');
  if (metodoVerificacao === 'email' && !email.disponivel) { console.warn('[hs] VERIFICACAO_LOGIN=email sem envio de e-mail configurado (BREVO_API_KEY ou SMTP): usando o aplicativo autenticador.'); metodoVerificacao = 'app'; }
  const auth = criarAuth({ db, urlBase, segredo, codigoPorEmail: metodoVerificacao === 'email' ? (para, codigo) => email.codigoAcesso(para, codigo) : null });
  const arquivos = criarArquivos({ db, dir: join(dataDir, 'arquivos'), segredo, armazenamento });
  const whatsCfg = configWhatsApp(env);
  const whatsapp = criarWhatsApp({ config: whatsCfg, fetchImpl: fetchImpl || fetch });
  const asaas = criarAsaas({ config: configAsaas(env), fetchImpl: fetchImpl || fetch });
  const descadastro = criarDescadastro({ segredo, urlBase });
  const integracoes = { email, descadastro, whatsapp: whatsapp.disponivel ? whatsapp : null, asaas: asaas.disponivel ? asaas : null };

  /** Executa em transação; efeitos externos (e-mails) só depois do COMMIT. */
  async function transacao(fn) {
    const posteriores = [];
    const r = await exclusivo(() => fn(posteriores));
    if (!(r && r.__rollback)) for (const f of posteriores) await Promise.resolve().then(f).catch((e) => console.error('[pos-commit]', e.message));
    return r;
  }

  const ctxSistema = (posteriores = []) => ({ db, user: SISTEMA, authEmail: 'sistema', now: () => new Date(), files: arquivos, ...integracoes, aposConfirmar: posteriores });

  /** Banco PostgreSQL + Supabase Storage: backup diário (JSON compactado) no bucket, guardando 14 dias. */
  async function backupNaNuvem() {
    if (banco.tipo !== 'postgres' || !armazenamento?.listar) return null;
    const dados = await exclusivo(() => banco.exportar());
    const nome = `backups/hs-${new Date().toISOString().slice(0, 10)}.json.gz`;
    await armazenamento.put(nome, gzipSync(JSON.stringify({ gerado_em: new Date().toISOString(), tabelas: dados })), 'application/gzip');
    const todos = (await armazenamento.listar('backups/')).filter((n) => /hs-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(n)).sort();
    for (const velho of todos.slice(0, Math.max(0, todos.length - 14))) await armazenamento.del(velho);
    return nome;
  }

  async function rodarRetencao() {
    await backupNaNuvem().catch((e) => console.error('[backup]', e.message));
    return transacao(async (pos) => {
      const r = await executarRetencao(ctxSistema(pos));
      r.pagamentos_confirmados_por_decurso = (await confirmarPorDecursoDePrazo(ctxSistema(pos))).confirmados;
      const agoraISO = new Date().toISOString();
      for (const ent of ['Sessao', 'Convite', 'Desafio2FA']) for (const x of await db[ent].filter({})) if (x.expira_em < agoraISO) await db[ent].delete(x.id);
      return r;
    });
  }
  const tentativas = new Map(); // limite simples por IP para login/cadastro

  function limitar(ip, chave, max = 20, janelaMs = 15 * 60e3) {
    const k = `${chave}:${ip}`, agora = Date.now();
    const t = (tentativas.get(k) || []).filter((x) => agora - x < janelaMs);
    t.push(agora);
    tentativas.set(k, t);
    return t.length > max;
  }

  const headersSeguranca = (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (producao) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  };

  const json = (res, status, body, extraHeaders = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
    res.end(JSON.stringify(body));
  };

  const cookieSessao = (token, expira) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${producao ? '; Secure' : ''}; Expires=${new Date(expira).toUTCString()}`;
  const cookieLimpo = `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict${producao ? '; Secure' : ''}; Max-Age=0`;

  function lerCookie(req) {
    const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
    return m ? m[1] : null;
  }

  function lerCorpo(req, limite) {
    return new Promise((ok, falha) => {
      const partes = [];
      let total = 0;
      req.on('data', (c) => { total += c.length; if (total > limite) { falha(Object.assign(new Error('Conteúdo muito grande'), { status: 413 })); req.destroy(); } else partes.push(c); });
      req.on('end', () => ok(Buffer.concat(partes)));
      req.on('error', falha);
    });
  }

  async function lerJSON(req) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error('Use application/json'), { status: 415 });
    const b = await lerCorpo(req, 8 * 1024 * 1024);
    try { return b.length ? JSON.parse(b.toString('utf8')) : {}; } catch { throw Object.assign(new Error('JSON inválido'), { status: 400 }); }
  }

  async function contexto(req, posteriores = []) {
    const s = await auth.sessao(lerCookie(req));
    if (!s) return null;
    const perfis = await db.UsuarioPlataforma.filter({ email: s.email });
    const user = perfis[0] || null;
    const dois = await auth.status2fa(s.email);
    return {
      db, user, authEmail: s.email, authName: s.nome, now: () => new Date(), files: arquivos, ...integracoes, aposConfirmar: posteriores,
      seguranca: { metodo: metodoVerificacao, dois_fatores_ativo: dois.ativo, codigos_recuperacao_restantes: dois.codigos_recuperacao_restantes, exige_2fa: !!(exigir2faHS && metodoVerificacao === 'app' && user && PERFIS_HS.includes(user.perfil)) },
      invite: async (para) => {
        const c = await auth.gerarConvite(para);
        if (email.disponivel) posteriores.push(() => email.convite(para, c.link));
        return { ...c, enviado_por_email: email.disponivel };
      },
    };
  }

  function servirEstatico(req, res, caminho) {
    const raiz = resolve(webDir);
    let p = resolve(raiz, '.' + decodeURIComponent(caminho));
    if (!p.startsWith(raiz + sep) && p !== raiz) { res.writeHead(403); return res.end(); }
    if (!existsSync(p) || statSync(p).isDirectory()) p = join(raiz, 'index.html');
    if (!existsSync(p)) { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Frontend não compilado. Rode: npm run build'); }
    const ext = extname(p);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': p.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache' });
    res.end(readFileSync(p));
  }

  // Endereço oficial (ex.: https://acorly.com.br): páginas abertas pelo www ou pelo endereço do Render
  // são redirecionadas para ele. API, webhooks, arquivos e descadastro continuam respondendo em qualquer endereço.
  const hostOficial = (() => { try { const u = new URL(urlBase); return /\.onrender\.com$|^localhost$|^127\./.test(u.hostname) ? null : u; } catch { return null; } })();
  const LIVRES = /^\/(api|webhooks|arquivos|descadastrar)(\/|$)/;

  async function rotear(req, res) {
    headersSeguranca(res);
    const url = new URL(req.url, 'http://local');
    const hostPedido = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
    if (hostOficial && (req.method === 'GET' || req.method === 'HEAD') && !LIVRES.test(url.pathname)
      && (hostPedido === `www.${hostOficial.hostname}` || hostPedido.endsWith('.onrender.com'))) {
      res.writeHead(301, { Location: `${hostOficial.origin}${url.pathname}${url.search}` });
      return res.end();
    }
    // Atrás do proxy (Caddy), o IP real é o último item de X-Forwarded-For, acrescentado pelo próprio proxy
    const xff = confiarProxy ? String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean) : [];
    const ip = xff.length ? xff[xff.length - 1] : req.socket.remoteAddress || '?';
    const rota = `${req.method} ${url.pathname}`;

    if (url.pathname.startsWith('/api/')) {
      // Proteção CSRF: cookie SameSite=Strict + cabeçalho customizado obrigatório
      if (req.method !== 'GET' && req.headers['x-hs'] !== '1') return json(res, 403, { ok: false, error: 'Requisição recusada' });
    }

    if (rota === 'GET /api/saude') {
      // Também mantém o banco "acordado" (o Supabase grátis pausa projetos sem uso)
      const ok = await exclusivo(() => db.Plano.filter({ id: '_' })).then(() => true).catch(() => false);
      return json(res, ok ? 200 : 503, { ok });
    }
    if (rota === 'GET /api/publico') {
      // Dados do site de apresentação (sem login): planos ativos e contato configurado
      const planos = await exclusivo(() => db.Plano.filter({ status: 'ATIVO' }));
      return json(res, 200, { ok: true, data: {
        planos: planos.sort((a, b) => (a.ordem || 0) - (b.ordem || 0)).map((p) => ({ nome: p.nome, preco_mensal_centavos: p.preco_mensal_centavos, limite_devedores: p.limite_devedores, limite_usuarios: p.limite_usuarios, funcionalidades: p.funcionalidades || [] })),
        contato: { email: env.CONTATO_EMAIL || 'contato@acorly.com.br', whatsapp: env.CONTATO_WHATSAPP || null },
        dias_teste: DIAS_TESTE,
        comissao: await exclusivo(async () => { const cfg = (await db.ConfiguracaoHS.filter({}))[0]; const f = cfg?.comissao_faixas?.length ? cfg.comissao_faixas : TABELA_PADRAO; return f.map((x, i) => ({ ...x, faixa: rotuloFaixa(f, i) })); }),
      } });
    }
    if (rota === 'GET /api/auth/sessao') {
      const s = await exclusivo(() => auth.sessao(lerCookie(req)));
      return json(res, 200, { ok: true, data: { logado: !!s, email_disponivel: email.disponivel } });
    }

    // ---- Webhooks (sem cookie; autenticados por assinatura/token do provedor) ----
    if (rota === 'GET /webhooks/whatsapp') {
      const ch = whatsapp.desafio(url.searchParams);
      res.writeHead(ch ? 200 : 403, { 'Content-Type': 'text/plain' });
      return res.end(ch || 'forbidden');
    }
    if (rota === 'POST /webhooks/whatsapp') {
      if (!whatsapp.disponivel) return json(res, 404, { ok: false });
      const bruto = await lerCorpo(req, 2 * 1024 * 1024);
      if (!whatsapp.assinaturaValida(bruto, req.headers['x-hub-signature-256'])) return json(res, 401, { ok: false });
      let payload; try { payload = JSON.parse(bruto.toString('utf8')); } catch { return json(res, 400, { ok: false }); }
      const r = await transacao((pos) => processarWebhookWhatsApp(ctxSistema(pos), payload));
      return json(res, 200, { ok: true, ...r });
    }
    if (rota === 'POST /webhooks/asaas') {
      if (!asaas.disponivel || !asaas.webhookValido(req.headers['asaas-access-token'])) return json(res, 401, { ok: false });
      const bruto = await lerCorpo(req, 1024 * 1024);
      let ev; try { ev = JSON.parse(bruto.toString('utf8')); } catch { return json(res, 400, { ok: false }); }
      const r = await transacao((pos) => processarWebhookAsaas(ctxSistema(pos), ev));
      return json(res, 200, { ok: true, ...r });
    }

    if (rota === 'POST /api/auth/login' || rota === 'POST /api/auth/cadastro') {
      if (limitar(ip, rota)) return json(res, 429, { ok: false, error: 'Muitas tentativas. Aguarde alguns minutos.' });
      const b = await lerJSON(req);
      const r = await exclusivo(() => (rota.endsWith('login') ? auth.login(b.email, b.senha) : auth.cadastrar(b)));
      if (r.erro) return json(res, rota.endsWith('login') ? 401 : 422, { ok: false, error: r.erro });
      if (r.precisa_2fa) return json(res, 200, { ok: true, data: { precisa_2fa: true, desafio: r.desafio, metodo: r.metodo, destino: r.destino, aviso: r.aviso } });
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookieSessao(r.token, r.expira) });
    }

    if (rota === 'POST /api/auth/2fa/verificar') {
      if (limitar(ip, rota, 30)) return json(res, 429, { ok: false, error: 'Muitas tentativas. Aguarde alguns minutos.' });
      const b = await lerJSON(req);
      const r = await exclusivo(() => auth.verificar2fa(b.desafio, b.codigo));
      if (r.erro) return json(res, 401, { ok: false, error: r.erro });
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookieSessao(r.token, r.expira) });
    }

    if (rota === 'POST /api/auth/2fa/reenviar') {
      if (limitar(ip, rota, 10)) return json(res, 429, { ok: false, error: 'Muitas solicitações. Aguarde alguns minutos.' });
      const b = await lerJSON(req);
      const r = await exclusivo(() => auth.reenviarCodigo(b.desafio));
      if (r.erro) return json(res, 422, { ok: false, error: r.erro });
      return json(res, 200, { ok: true, data: r });
    }

    if (['POST /api/auth/2fa/iniciar', 'POST /api/auth/2fa/ativar', 'POST /api/auth/2fa/desativar'].includes(rota)) {
      const b = await lerJSON(req);
      const s = await exclusivo(() => auth.sessao(lerCookie(req)));
      if (!s) return json(res, 401, { ok: false, error: 'Não autenticado' });
      if (rota.endsWith('desativar')) {
        const perfil = (await exclusivo(() => db.UsuarioPlataforma.filter({ email: s.email })))[0];
        if (exigir2faHS && perfil && PERFIS_HS.includes(perfil.perfil)) return json(res, 403, { ok: false, error: 'A verificação em duas etapas é obrigatória para a equipe Acorly' });
      }
      const r = await exclusivo(() => (rota.endsWith('iniciar') ? auth.iniciar2fa(s.email) : rota.endsWith('ativar') && !rota.endsWith('desativar') ? auth.ativar2fa(s.email, b.codigo) : auth.desativar2fa(s.email, b.senha, b.codigo)));
      if (r.erro) return json(res, 422, { ok: false, error: r.erro });
      return json(res, 200, { ok: true, data: r });
    }

    if (rota === 'POST /api/auth/esqueci') {
      if (limitar(ip, rota, 5)) return json(res, 429, { ok: false, error: 'Muitas solicitações. Aguarde alguns minutos.' });
      const b = await lerJSON(req);
      if (!email.disponivel) return json(res, 200, { ok: true, data: { email_disponivel: false } });
      const e = String(b.email || '').trim().toLowerCase();
      await transacao(async (pos) => {
        const conta = (await db.Conta.filter({ email: e }))[0];
        const perfil = (await db.UsuarioPlataforma.filter({ email: e }))[0];
        if (conta && conta.status !== 'DESATIVADA' && (!perfil || perfil.status === 'ATIVO')) {
          const c = await auth.gerarConvite(e);
          pos.push(() => email.convite(e, c.link, true));
        }
      });
      // Resposta idêntica exista ou não a conta (não revela e-mails cadastrados)
      return json(res, 200, { ok: true, data: { email_disponivel: true } });
    }

    if (rota === 'POST /api/auth/logout') {
      await exclusivo(() => auth.logout(lerCookie(req)));
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookieLimpo });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/auth/convite/')) {
      const c = await exclusivo(() => auth.lerConvite(url.pathname.split('/').pop()));
      if (!c) return json(res, 404, { ok: false, error: 'Convite inválido ou expirado' });
      return json(res, 200, { ok: true, data: { email: c.email } });
    }

    if (rota === 'POST /api/auth/convite') {
      if (limitar(ip, rota)) return json(res, 429, { ok: false, error: 'Muitas tentativas.' });
      const b = await lerJSON(req);
      const r = await exclusivo(() => auth.aceitarConvite(b.token, b.senha, b.nome));
      if (r.erro) return json(res, 422, { ok: false, error: r.erro });
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookieSessao(r.token, r.expira) });
    }

    if (rota === 'POST /api/auth/senha') {
      const b = await lerJSON(req);
      const s = await exclusivo(() => auth.sessao(lerCookie(req)));
      if (!s) return json(res, 401, { ok: false, error: 'Não autenticado' });
      const r = await exclusivo(() => auth.trocarSenha(s.email, b.atual, b.nova));
      if (r.erro) return json(res, 422, { ok: false, error: r.erro });
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookieSessao(r.token, r.expira) });
    }

    if (url.pathname.startsWith('/descadastrar/') && (req.method === 'GET' || req.method === 'POST')) {
      const id = descadastro.validar(decodeURIComponent(url.pathname.slice('/descadastrar/'.length)));
      const html = (status, p) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(paginaDescadastro(p)); };
      if (!id) return html(404, { titulo: 'Link inválido', texto: 'Este link não é válido. Se quiser parar de receber e-mails, responda a mensagem pedindo o descadastro.' });
      // GET só mostra a confirmação (leitores de e-mail abrem links sozinhos); o descadastro é feito no POST
      if (req.method === 'GET') return html(200, { titulo: 'Parar de receber e-mails', texto: 'Confirme abaixo para não receber mais e-mails sobre esta cobrança. Os outros meios de contato combinados podem continuar.', botao: 'Não quero mais receber e-mails' });
      await lerCorpo(req, 4096).catch(() => null);
      await transacao(async (pos) => {
        const ctx = ctxSistema(pos);
        const d = await getById(ctx, 'Devedor', id);
        if (d && !d.nao_contatar_email) {
          await alterar(ctx, 'Devedor', d, { nao_contatar_email: true, email_descadastrado_em: new Date().toISOString() }, 'DESCADASTRO_EMAIL');
          await notificar(ctx, d.empresa_id, { perfis: ['ADMIN_EMPRESA'], tipo: 'DESCADASTRO_EMAIL', titulo: 'Devedor pediu para não receber e-mails', mensagem: d.nome, link: `/devedores/${d.id}` });
        }
      });
      return html(200, { titulo: 'Pronto', texto: 'Você não receberá mais e-mails sobre esta cobrança.' });
    }
    if (rota === 'POST /api/rpc') {
      const b = await lerJSON(req);
      const r = await transacao(async (pos) => {
        const ctx = await contexto(req, pos);
        if (!ctx) return { status: 401, body: { ok: false, error: 'Sessão expirada. Entre novamente.' }, __rollback: true };
        ctx.ip = ip;
        if (ctx.seguranca.exige_2fa && !ctx.seguranca.dois_fatores_ativo && !LIBERADAS_SEM_2FA.has(b.action)) {
          return { status: 403, body: { ok: false, error: 'Ative a verificação em duas etapas para continuar.', details: { codigo: 'EXIGE_2FA' } }, __rollback: true };
        }
        const out = await handle(ctx, b.action, b.payload ?? {});
        if (out.status !== 200) out.__rollback = true;
        else if (b.action === 'meuPerfil') out.body.data.seguranca = { ...ctx.seguranca, email_disponivel: email.disponivel };
        return out;
      });
      return json(res, r.status, r.body);
    }

    if (rota === 'POST /api/upload') {
      const ctxOk = await exclusivo(() => contexto(req));
      if (!ctxOk?.user || ctxOk.user.status !== 'ATIVO') return json(res, 401, { ok: false, error: 'Não autenticado' });
      const buffer = await lerCorpo(req, 10 * 1024 * 1024 + 1);
      const mime = String(req.headers['content-type'] || '').split(';')[0].trim();
      const nome = decodeURIComponent(String(req.headers['x-filename'] || 'arquivo'));
      const r = await exclusivo(() => arquivos.salvar({ buffer, mime, nome, email: ctxOk.authEmail }));
      if (r.erro) return json(res, 422, { ok: false, error: r.erro });
      return json(res, 200, { ok: true, data: r });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/arquivos/')) {
      const f = await exclusivo(() => arquivos.ler(url.pathname.split('/').pop(), url.searchParams.get('exp'), url.searchParams.get('sig')));
      if (!f) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Link inválido ou expirado'); }
      res.writeHead(200, {
        'Content-Type': f.mime, 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Disposition': `${['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(f.mime) ? 'inline' : 'attachment'}; filename="${encodeURIComponent(f.nome)}"`,
      });
      return res.end(f.buffer);
    }

    if (url.pathname.startsWith('/api/')) return json(res, 404, { ok: false, error: 'Rota não encontrada' });
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return servirEstatico(req, res, url.pathname);
  }

  const server = createServer((req, res) => {
    rotear(req, res).catch((e) => {
      if (!e.status && !(e.code && /^(28P01|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|3D000)$/.test(e.code))) console.error('[http]', e);
      if (!res.headersSent) json(res, e.status || 500, { ok: false, error: e.status ? e.message : 'Erro interno' });
      else res.end();
    });
  });

  // Retenção LGPD e limpeza: ao iniciar e a cada 24 h
  let timer = null;
  let timerLembretes = null;
  const agendarRetencao = () => {
    const rodar = () => rodarRetencao().then((r) => { if (r.titulares_anonimizados || r.pagamentos_confirmados_por_decurso) console.log('[retencao]', r); }).catch((e) => console.error('[retencao]', e.code ? `${e.code} (ver mensagem do banco acima)` : e));
    rodar();
    timer = setInterval(rodar, 24 * 3600e3);
    timer.unref();
    // Lembretes (mensalidade, fim do teste, parcelas de acordo): de hora em hora, só em horário comercial
    const lembrar = () => transacao((pos) => rodarLembretes(ctxSistema(pos))).then((r) => { if (r && (r.mensalidade || r.teste || r.parcelas || r.prestacoes)) console.log('[lembretes]', r); }).catch((e) => console.error('[lembretes]', e.message));
    setTimeout(lembrar, 60e3).unref();
    timerLembretes = setInterval(lembrar, 3600e3);
    timerLembretes.unref();
  };
  server.on('close', () => { if (timer) clearInterval(timer); if (timerLembretes) clearInterval(timerLembretes); });

  /**
   * Primeiro acesso sem terminal (ex.: Render grátis): com SUPERADMIN_EMAIL definido, cria o superadmin,
   * os planos padrão e mostra nos registros (logs) o link para definir a senha. Enquanto a pessoa não
   * criar a senha, um novo link é mostrado a cada inicialização.
   */
  async function primeiroAcesso() {
    const emailAdm = String(env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
    if (!emailAdm) return null;
    const { PLANOS_PADRAO, PLANOS_PADRAO_ANTERIORES, PLANOS_NOMES_ANTERIORES } = await import('../app/actions/comercial.js');
    return exclusivo(async () => {
      let u = (await db.UsuarioPlataforma.filter({ email: emailAdm }))[0];
      if (u && u.perfil !== 'SUPERADMIN_HS') return null;
      if (!u) u = await db.UsuarioPlataforma.create({ nome: env.SUPERADMIN_NOME || 'Administrador Acorly', email: emailAdm, perfil: 'SUPERADMIN_HS', empresa_id: null, status: 'ATIVO', data_criacao: new Date().toISOString() });
      await garantirModelosPadrao(db);
      const planos = await db.Plano.filter({});
      for (const pl of planos) {
        const novo = PLANOS_NOMES_ANTERIORES[pl.nome];
        if (novo && !planos.some((x) => x.nome === novo)) { await db.Plano.update(pl.id, { nome: novo }); pl.nome = novo; }
        // "API (futura)" deixou de ser anunciado nos planos
        if ((pl.funcionalidades || []).includes('api_futura')) { pl.funcionalidades = pl.funcionalidades.filter((f) => f !== 'api_futura'); await db.Plano.update(pl.id, { funcionalidades: pl.funcionalidades }); }
      }
      for (const p of PLANOS_PADRAO) {
        const atual = planos.find((x) => x.nome === p.nome);
        if (!atual) { await db.Plano.create(p); continue; }
        const antigo = PLANOS_PADRAO_ANTERIORES[p.nome];
        if (antigo && atual.preco_mensal_centavos === antigo.preco_mensal_centavos && atual.limite_devedores === antigo.limite_devedores) {
          await db.Plano.update(atual.id, { preco_mensal_centavos: p.preco_mensal_centavos, limite_devedores: p.limite_devedores });
        }
      }
      if ((await db.Conta.filter({ email: emailAdm })).length) return null; // já tem senha
      // Código escolhido pelo dono no ambiente (PRIMEIRO_ACESSO_CODIGO): link previsível, sem precisar dos logs
      const codigo = String(env.PRIMEIRO_ACESSO_CODIGO || '').trim();
      if (codigo && !/^[A-Za-z0-9_-]{16,100}$/.test(codigo)) console.error('[hs] PRIMEIRO_ACESSO_CODIGO ignorado: use de 16 a 100 letras e números, sem espaços.');
      const tokenFixo = /^[A-Za-z0-9_-]{16,100}$/.test(codigo) ? codigo : null;
      // Não cancela links anteriores: o servidor reinicia com frequência (deploys, plano grátis "dormindo")
      const c = await auth.gerarConvite(emailAdm, { invalidarAnteriores: false, tokenFixo });
      console.log(`\n[hs] PRIMEIRO ACESSO do superadmin ${emailAdm}: abra este link para criar a senha (vale 7 dias):\n[hs] ${c.link}\n`);
      return c.link;
    });
  }

  return { server, db, banco, auth, exclusivo, email, rodarRetencao, agendarRetencao, backupNaNuvem, primeiroAcesso };
}
