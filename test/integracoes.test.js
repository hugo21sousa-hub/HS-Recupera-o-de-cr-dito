import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import nodemailer from 'nodemailer';
import { codigo, base32, verificar } from '../src/server/totp.js';
import { criarApp } from '../src/server/app.js';
import { criarWhatsApp } from '../src/server/whatsapp.js';
import { processarWebhookWhatsApp } from '../src/app/actions/whatsapp.js';
import { processarWebhookAsaas } from '../src/app/actions/comercial.js';
import { executarRetencao } from '../src/app/retencao.js';
import { cenario, casosHS, AGORA } from './helpers.js';

test('TOTP segue a RFC 6238 (vetor oficial)', () => {
  const segredo = base32(Buffer.from('12345678901234567890'));
  assert.equal(segredo, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(codigo(segredo, 1), '287082'); // T = 59 s
  assert.equal(codigo(segredo, 37037036), '081804'); // T = 1111111109 s
  assert.equal(verificar(segredo, '081804', 1111111109 * 1000), 37037036);
  assert.equal(verificar(segredo, '000000', 1111111109 * 1000), null);
});

// ---------- Servidor: 2FA e e-mail ----------
let app, base, dir;
const transporte = nodemailer.createTransport({ jsonTransport: true });
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hs-int-'));
  app = criarApp({ dataDir: dir, urlBase: 'http://teste', webDir: join(dir, 'web'), transporteEmail: transporte, env: {} });
  await new Promise((ok) => app.server.listen(0, ok));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => { app.server.close(); app.banco.fechar(); rmSync(dir, { recursive: true, force: true }); });

function cliente() {
  let cookie = '';
  const req = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'X-HS': '1', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { req, rpc: (action, payload) => req('POST', '/api/rpc', { action, payload }) };
}

test('2FA obrigatório para a equipe HS: bloqueio, ativação, login com código e recuperação', async () => {
  let link;
  await app.exclusivo(async () => {
    await app.db.UsuarioPlataforma.create({ nome: 'Super', email: 'super@hs.com', perfil: 'SUPERADMIN_HS', status: 'ATIVO' });
    link = (await app.auth.gerarConvite('super@hs.com')).link;
  });
  const c = cliente();
  assert.equal((await c.req('POST', '/api/auth/convite', { token: link.split('/').pop(), senha: 'SenhaForte1' })).status, 200);
  const perfil = await c.rpc('meuPerfil');
  assert.equal(perfil.body.data.seguranca.exige_2fa, true);
  const bloq = await c.rpc('listarEmpresas');
  assert.equal(bloq.status, 403);
  assert.equal(bloq.body.details.codigo, 'EXIGE_2FA');
  const ini = await c.req('POST', '/api/auth/2fa/iniciar', {});
  assert.match(ini.body.data.otpauth, /^otpauth:\/\/totp\//);
  const segredo = ini.body.data.segredo.replace(/\s/g, '');
  assert.equal((await c.req('POST', '/api/auth/2fa/ativar', { codigo: '000000' })).status, 422);
  const at = await c.req('POST', '/api/auth/2fa/ativar', { codigo: codigo(segredo, Math.floor(Date.now() / 30000)) });
  assert.equal(at.body.data.codigos_recuperacao.length, 8);
  assert.equal((await c.rpc('listarEmpresas')).status, 200);
  assert.equal((await c.req('POST', '/api/auth/2fa/desativar', { senha: 'SenhaForte1', codigo: '123456' })).status, 403, 'HS não pode desligar');
  // novo login exige o segundo fator
  const d = cliente();
  const l = await d.req('POST', '/api/auth/login', { email: 'super@hs.com', senha: 'SenhaForte1' });
  assert.equal(l.body.data.precisa_2fa, true);
  assert.equal((await d.rpc('meuPerfil')).status, 401, 'sem sessão antes do código');
  // o mesmo código usado na ativação não pode ser reutilizado (replay)
  assert.equal((await d.req('POST', '/api/auth/2fa/verificar', { desafio: l.body.data.desafio, codigo: codigo(segredo, Math.floor(Date.now() / 30000)) })).status, 401);
  const rec = at.body.data.codigos_recuperacao[0];
  assert.equal((await d.req('POST', '/api/auth/2fa/verificar', { desafio: l.body.data.desafio, codigo: rec })).status, 200);
  assert.equal((await d.rpc('meuPerfil')).body.data.usuario.perfil, 'SUPERADMIN_HS');
  // código de recuperação é de uso único
  const e = cliente();
  const l2 = await e.req('POST', '/api/auth/login', { email: 'super@hs.com', senha: 'SenhaForte1' });
  assert.equal((await e.req('POST', '/api/auth/2fa/verificar', { desafio: l2.body.data.desafio, codigo: rec })).status, 401);
});

test('e-mail: convite enviado após o commit e "esqueci minha senha" sem revelar contas', async () => {
  const adm = cliente();
  await adm.req('POST', '/api/auth/cadastro', { email: 'dono@loja.com', senha: 'SenhaForte1' });
  await adm.rpc('registrarEmpresa', { razao_social: 'Loja', cnpj: '11222333000181', email: 'a@loja.com', telefone: '1133334444', endereco: 'Rua 1', responsavel_legal: 'X', aceite_termos: true, aceite_privacidade: true });
  const antes = app.email.enviados.length;
  const conv = await adm.rpc('convidarUsuario', { nome: 'Fin', email: 'fin@loja.com', perfil: 'FINANCEIRO_EMPRESA' });
  assert.equal(conv.body.data.convite_enviado_por_email, true);
  const enviado = app.email.enviados.slice(antes).find((x) => x.para === 'fin@loja.com');
  assert.ok(enviado, 'convite enviado por e-mail');
  assert.ok(JSON.parse(enviado.info.message).html.includes(conv.body.data.convite_link));
  // convite inválido (e-mail duplicado) não envia nada: transação desfeita
  const n = app.email.enviados.length;
  assert.equal((await adm.rpc('convidarUsuario', { nome: 'Fin', email: 'fin@loja.com', perfil: 'FINANCEIRO_EMPRESA' })).status, 422);
  assert.equal(app.email.enviados.length, n);
  const anon = cliente();
  assert.equal((await anon.req('POST', '/api/auth/esqueci', { email: 'dono@loja.com' })).status, 200);
  assert.equal((await anon.req('POST', '/api/auth/esqueci', { email: 'naoexiste@x.com' })).status, 200);
  const resets = app.email.enviados.filter((x) => /Redefinição/.test(x.assunto));
  assert.equal(resets.length, 1);
  assert.equal(resets[0].para, 'dono@loja.com');
});

test('retenção: anonimiza titulares quitados após o prazo e mantém os ativos', async () => {
  const t = await cenario();
  const { A } = t.empresas;
  await t.ok(A.adm, 'informarPagamento', { divida_id: A.dividas[0].id, valor_centavos: 100000, data_informada: '2026-11-10', confirmar_agora: true });
  const ctx = (agora) => ({ db: t.db, now: () => agora, user: { id: 'sistema', email: 'sistema', perfil: 'SISTEMA' }, files: { remover: async () => {} } });
  assert.equal((await executarRetencao(ctx(new Date('2027-01-01T00:00:00Z')))).titulares_anonimizados, 0, 'dentro do prazo');
  const r = await executarRetencao(ctx(new Date('2032-01-01T00:00:00Z')));
  assert.equal(r.titulares_anonimizados, 1);
  assert.equal(r.documentos_removidos, 1);
  const dev = (await t.db.Devedor.filter({ id: A.devedores[0].id }))[0];
  assert.equal(dev.status, 'ANONIMIZADO');
  assert.equal(dev.cpf_cnpj.startsWith('ANON-'), true);
  assert.equal((await t.db.Devedor.filter({ id: A.devedores[1].id }))[0].status, 'ATIVO', 'dívida em aberto mantém o titular');
  assert.equal((await t.db.Pagamento.filter({ divida_id: A.dividas[0].id }))[0].valor_confirmado_centavos, 100000, 'histórico financeiro preservado');
});

// ---------- WhatsApp Business (API simulada) ----------
test('WhatsApp: janela de 24h, modelo aprovado, resposta recebida, PARAR e triagem', async () => {
  const t = await cenario();
  const enviados = [];
  t.estado.extras.whatsapp = {
    disponivel: true,
    enviarTexto: async (para, texto) => { enviados.push({ para, texto }); return `wamid.${enviados.length}`; },
    enviarModelo: async (para, nome, idioma, params) => { enviados.push({ para, nome, idioma, params }); return `wamid.${enviados.length}`; },
  };
  const [caso] = await casosHS(t, 'A', [0]);
  await t.falha('op1@hs.com', 'enviarWhatsApp', { caso_id: caso.id, mensagem: 'Olá' }, 422); // fora da janela
  const m = await t.ok('super@hs.com', 'salvarModeloMensagem', { nome: 'Primeiro contato', conteudo: 'Olá {{nome}}, a {{credor}} tem uma proposta para o valor de {{valor}}.', nome_template_meta: 'primeiro_contato', idioma_template: 'pt_BR' });
  assert.equal(m.aprovado_meta, true);
  const env = await t.ok('op1@hs.com', 'enviarWhatsApp', { caso_id: caso.id, modelo_id: m.id });
  assert.equal(env.modo, 'MODELO_META');
  assert.deepEqual(enviados[0].params, ['Devedor', 'Loja A', 'R$ 1.000,00']);
  assert.equal(enviados[0].para, '5511988887777');
  // webhook: status de entrega e resposta do devedor
  const sys = { db: t.db, now: () => AGORA, user: { id: 'sistema', email: 'sistema', perfil: 'SISTEMA' } };
  const msg = (id, from, body) => ({ entry: [{ changes: [{ value: { messages: [{ id, from, timestamp: String(AGORA.getTime() / 1000), type: 'text', text: { body } }], statuses: [{ id: 'wamid.1', status: 'read' }] } }] }] });
  const r = await processarWebhookWhatsApp(sys, msg('in.1', '5511988887777', 'Quero negociar'));
  assert.equal(r.mensagens, 1);
  assert.equal((await processarWebhookWhatsApp(sys, msg('in.1', '5511988887777', 'Quero negociar'))).duplicadas, 1);
  const det = await t.ok('op1@hs.com', 'detalheCaso', { caso_id: caso.id });
  assert.equal(det.caso.status_operacional, 'DEVEDOR_RESPONDEU');
  assert.ok(det.interacoes.some((i) => i.resposta === 'Quero negociar' && i.tipo_interacao === 'RESPOSTA_DEVEDOR'));
  assert.equal(det.interacoes.find((i) => i.mensagem_externa_id === 'wamid.1').status_entrega, 'read');
  // janela aberta: texto livre permitido
  await t.ok('op1@hs.com', 'enviarWhatsApp', { caso_id: caso.id, mensagem: 'Ótimo! Posso propor 10% de desconto à vista.' });
  await t.falha('op1@hs.com', 'enviarWhatsApp', { caso_id: caso.id, mensagem: 'Pague senão vai ser preso' }, 422);
  // número desconhecido vai para triagem
  await processarWebhookWhatsApp(sys, msg('in.2', '5521900000000', 'Quem é?'));
  const tri = await t.ok('gestor@hs.com', 'listarMensagensSemCaso', {});
  assert.equal(tri.total, 1);
  await t.falha('op1@hs.com', 'listarMensagensSemCaso', {}, 403);
  await t.ok('gestor@hs.com', 'vincularMensagem', { log_id: tri.itens[0].id, caso_id: caso.id });
  // PARAR: interrompe contatos
  await processarWebhookWhatsApp(sys, msg('in.3', '5511988887777', 'PARAR'));
  await t.falha('op1@hs.com', 'enviarWhatsApp', { caso_id: caso.id, mensagem: 'Olá' }, 422);
  assert.equal((await t.db.Devedor.filter({ id: caso.devedor_id }))[0].nao_contatar, true);
  // empresa não usa a API em casos HS
  await t.falha(t.empresas.A.adm, 'enviarWhatsApp', { caso_id: caso.id, mensagem: 'x' });
  delete t.estado.extras.whatsapp;
  await t.falha('op1@hs.com', 'enviarWhatsApp', { caso_id: caso.id, mensagem: 'x' }, 422);
});

test('WhatsApp: assinatura do webhook e verificação do endpoint', () => {
  const w = criarWhatsApp({ config: { token: 't', phoneId: '1', versao: 'v21.0', verifyToken: 'vt', appSecret: 'segredo-app' } });
  const corpo = Buffer.from('{"entry":[]}');
  const ass = 'sha256=' + createHmac('sha256', 'segredo-app').update(corpo).digest('hex');
  assert.equal(w.assinaturaValida(corpo, ass), true);
  assert.equal(w.assinaturaValida(corpo, 'sha256=' + '0'.repeat(64)), false);
  assert.equal(w.assinaturaValida(corpo, undefined), false);
  assert.equal(w.desafio(new URLSearchParams('hub.mode=subscribe&hub.verify_token=vt&hub.challenge=123')), '123');
  assert.equal(w.desafio(new URLSearchParams('hub.mode=subscribe&hub.verify_token=errado&hub.challenge=123')), null);
});

// ---------- Asaas (API simulada) ----------
test('Assinatura online: fatura, confirmação pelo webhook, idempotência e inadimplência', async () => {
  const t = await cenario();
  const { A } = t.empresas;
  const chamadas = [];
  t.estado.extras.asaas = {
    disponivel: true,
    criarCliente: async (d) => { chamadas.push(['cliente', d]); return { id: 'cus_1' }; },
    criarAssinatura: async (d) => { chamadas.push(['assinatura', d]); return { id: 'sub_1' }; },
    cobrancasDaAssinatura: async () => ({ data: [{ id: 'pay_1', invoiceUrl: 'https://asaas/fatura/1' }] }),
    cancelarAssinatura: async (id) => { chamadas.push(['cancelar', id]); },
  };
  const planos = await t.ok(A.adm, 'listarPlanos');
  await t.falha(A.fin, 'assinarPlano', { plano_id: planos[1].id }, 403);
  const r = await t.ok(A.adm, 'assinarPlano', { plano_id: planos[1].id });
  assert.equal(r.fatura_url, 'https://asaas/fatura/1');
  assert.equal(chamadas.find((c) => c[0] === 'assinatura')[1].valorCentavos, 7990);
  let ass = await t.ok(A.adm, 'minhaAssinatura');
  assert.equal(ass.pendente.status, 'AGUARDANDO_PAGAMENTO');
  assert.equal(ass.atual, null);
  const sys = { db: t.db, now: () => AGORA, user: { id: 'sistema', email: 'sistema', perfil: 'SISTEMA' } };
  const ev = { id: 'evt_1', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_1', subscription: 'sub_1', value: 79.9, dueDate: '2026-11-11', status: 'CONFIRMED' } };
  assert.equal((await processarWebhookAsaas(sys, ev)).status, 'ATIVA');
  assert.equal((await processarWebhookAsaas(sys, ev)).duplicado, true);
  ass = await t.ok(A.adm, 'minhaAssinatura');
  assert.equal(ass.atual.status, 'ATIVA');
  assert.equal(ass.atual.data_vencimento, '2026-12-11');
  assert.equal(ass.plano.nome, 'HS PROFISSIONAL');
  await processarWebhookAsaas(sys, { id: 'evt_2', event: 'PAYMENT_OVERDUE', payment: { id: 'pay_2', subscription: 'sub_1', invoiceUrl: 'https://asaas/fatura/2' } });
  ass = await t.ok(A.adm, 'minhaAssinatura');
  assert.equal(ass.atual.status, 'INADIMPLENTE');
  // valores das dívidas nunca passam pelo gateway
  assert.ok(chamadas.every((c) => c[0] !== 'assinatura' || c[1].descricao.includes('Assinatura')));
});

test('falha de rede no WhatsApp vira mensagem clara (502), não erro interno', async () => {
  const w = criarWhatsApp({ config: { token: 't', phoneId: '1', versao: 'v21.0', base: 'http://x' }, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(w.enviarTexto('5511999999999', 'oi'), (e) => e.status === 502 && /envio manual/.test(e.message));
});
