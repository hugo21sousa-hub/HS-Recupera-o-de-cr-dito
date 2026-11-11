// Servidor HTTP (sem framework): API, autenticação, arquivos e frontend estático.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { abrirBanco } from './db.js';
import { criarAuth } from './auth.js';
import { criarArquivos } from './files.js';
import { handle } from '../app/router.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const COOKIE = 'hs_sessao';

export function criarApp({ dataDir = './data', urlBase = '', producao = false, webDir = './web/dist', arquivoBanco } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const segredoPath = join(dataDir, 'segredo');
  const segredo = process.env.SEGREDO || (existsSync(segredoPath) ? readFileSync(segredoPath, 'utf8') : (() => { const s = randomBytes(32).toString('hex'); writeFileSync(segredoPath, s, { mode: 0o600 }); return s; })());
  const banco = abrirBanco(arquivoBanco || join(dataDir, 'hs.sqlite'));
  const { db, exclusivo } = banco;
  const auth = criarAuth({ db, urlBase });
  const arquivos = criarArquivos({ db, dir: join(dataDir, 'arquivos'), segredo });
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

  async function contexto(req) {
    const s = await auth.sessao(lerCookie(req));
    if (!s) return null;
    const perfis = await db.UsuarioPlataforma.filter({ email: s.email });
    return {
      db, user: perfis[0] || null, authEmail: s.email, authName: s.nome, now: () => new Date(),
      files: arquivos, invite: (email) => auth.gerarConvite(email),
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

  async function rotear(req, res) {
    headersSeguranca(res);
    const url = new URL(req.url, 'http://local');
    const ip = req.socket.remoteAddress || '?';
    const rota = `${req.method} ${url.pathname}`;

    if (url.pathname.startsWith('/api/')) {
      // Proteção CSRF: cookie SameSite=Strict + cabeçalho customizado obrigatório
      if (req.method !== 'GET' && req.headers['x-hs'] !== '1') return json(res, 403, { ok: false, error: 'Requisição recusada' });
    }

    if (rota === 'GET /api/saude') return json(res, 200, { ok: true });
    if (rota === 'GET /api/auth/sessao') {
      const s = await exclusivo(() => auth.sessao(lerCookie(req)));
      return json(res, 200, { ok: true, data: { logado: !!s } });
    }

    if (rota === 'POST /api/auth/login' || rota === 'POST /api/auth/cadastro') {
      if (limitar(ip, rota)) return json(res, 429, { ok: false, error: 'Muitas tentativas. Aguarde alguns minutos.' });
      const b = await lerJSON(req);
      const r = await exclusivo(() => (rota.endsWith('login') ? auth.login(b.email, b.senha) : auth.cadastrar(b)));
      if (r.erro) return json(res, rota.endsWith('login') ? 401 : 422, { ok: false, error: r.erro });
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookieSessao(r.token, r.expira) });
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

    if (rota === 'POST /api/rpc') {
      const b = await lerJSON(req);
      const r = await exclusivo(async () => {
        const ctx = await contexto(req);
        if (!ctx) return { status: 401, body: { ok: false, error: 'Sessão expirada. Entre novamente.' }, __rollback: true };
        const out = await handle(ctx, b.action, b.payload ?? {});
        if (out.status !== 200) out.__rollback = true;
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
      if (!e.status) console.error('[http]', e);
      if (!res.headersSent) json(res, e.status || 500, { ok: false, error: e.status ? e.message : 'Erro interno' });
      else res.end();
    });
  });

  return { server, db, banco, auth, exclusivo };
}
