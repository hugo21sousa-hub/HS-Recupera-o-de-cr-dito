import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import { criarApp } from '../src/server/app.js';
import { transporteBrevo } from '../src/server/email.js';
import { envBanco } from './helpers.js';

let app, base, dir;
const transporte = nodemailer.createTransport({ jsonTransport: true });
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hs-cod-'));
  app = criarApp({ dataDir: dir, urlBase: 'http://teste', webDir: join(dir, 'web'), transporteEmail: transporte, env: envBanco() });
  await new Promise((ok) => app.server.listen(0, ok));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => { app.server.close(); await app.banco.fechar(); rmSync(dir, { recursive: true, force: true }); });

function cliente() {
  let cookie = '';
  const req = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'X-HS': '1', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { req, rpc: (action, payload) => req('POST', '/api/rpc', { action, payload }) };
}
const ultimoCodigo = (para) => {
  const m = [...app.email.enviados].reverse().find((x) => x.para === para && /código de acesso/.test(x.assunto));
  return m && m.assunto.match(/^(\d{6})/)[1];
};

test('login pede código enviado ao e-mail; código errado falha; certo entra; código é de uso único', async () => {
  const c = cliente();
  await c.req('POST', '/api/auth/cadastro', { email: 'dono@empresa.com', senha: 'SenhaForte1' });
  await c.req('POST', '/api/auth/logout', {});
  const l = await c.req('POST', '/api/auth/login', { email: 'dono@empresa.com', senha: 'SenhaForte1' });
  assert.equal(l.body.data.precisa_2fa, true);
  assert.equal(l.body.data.metodo, 'email');
  assert.equal(l.body.data.destino, 'd***o@empresa.com');
  assert.equal((await c.rpc('meuPerfil')).status, 401, 'sem sessão antes do código');
  const codigo = ultimoCodigo('dono@empresa.com');
  assert.match(codigo, /^\d{6}$/);
  const errado = codigo === '000000' ? '111111' : '000000';
  assert.equal((await c.req('POST', '/api/auth/2fa/verificar', { desafio: l.body.data.desafio, codigo: errado })).status, 401);
  assert.equal((await c.req('POST', '/api/auth/2fa/verificar', { desafio: l.body.data.desafio, codigo })).status, 200);
  assert.equal((await c.rpc('meuPerfil')).status, 200);
  assert.equal((await cliente().req('POST', '/api/auth/2fa/verificar', { desafio: l.body.data.desafio, codigo })).status, 401, 'uso único');
});

test('reenvio: aguarda 1 minuto, troca o código e invalida o anterior; 5 erros encerram a verificação', async () => {
  const c = cliente();
  await c.req('POST', '/api/auth/cadastro', { email: 'b@empresa.com', senha: 'SenhaForte1' });
  const l = await c.req('POST', '/api/auth/login', { email: 'b@empresa.com', senha: 'SenhaForte1' });
  const desafio = l.body.data.desafio;
  const primeiro = ultimoCodigo('b@empresa.com');
  assert.equal((await c.req('POST', '/api/auth/2fa/reenviar', { desafio })).status, 422, 'antes de 1 minuto');
  // simula 61 s depois do envio
  await app.exclusivo(async () => { const d = (await app.db.Desafio2FA.filter({ email: 'b@empresa.com' }))[0]; await app.db.Desafio2FA.update(d.id, { ultimo_envio: new Date(Date.now() - 61e3).toISOString() }); });
  assert.equal((await c.req('POST', '/api/auth/2fa/reenviar', { desafio })).status, 200);
  const segundo = ultimoCodigo('b@empresa.com');
  if (primeiro !== segundo) assert.equal((await c.req('POST', '/api/auth/2fa/verificar', { desafio, codigo: primeiro })).status, 401, 'código antigo não vale');
  for (let i = 0; i < 5; i++) await c.req('POST', '/api/auth/2fa/verificar', { desafio, codigo: segundo === '999999' ? '999998' : '999999' });
  assert.equal((await c.req('POST', '/api/auth/2fa/verificar', { desafio, codigo: segundo })).status, 401, 'bloqueado após 5 erros');
});

test('equipe HS: com código por e-mail, não é obrigada a configurar aplicativo', async () => {
  let link;
  await app.exclusivo(async () => { await app.db.UsuarioPlataforma.create({ nome: 'Op', email: 'op@hs.com', perfil: 'OPERADOR_HS', status: 'ATIVO', capacidade_casos: 10 }); link = (await app.auth.gerarConvite('op@hs.com')).link; });
  const c = cliente();
  assert.equal((await c.req('POST', '/api/auth/convite', { token: link.split('/').pop(), senha: 'SenhaForte1' })).status, 200);
  const p = await c.rpc('meuPerfil');
  assert.equal(p.body.data.seguranca.metodo, 'email');
  assert.equal(p.body.data.seguranca.exige_2fa, false);
  assert.equal((await c.rpc('listarTarefas')).status, 200);
  const d = cliente();
  const l = await d.req('POST', '/api/auth/login', { email: 'op@hs.com', senha: 'SenhaForte1' });
  assert.equal(l.body.data.metodo, 'email', 'login da equipe HS também pede código por e-mail');
});

test('Brevo: envia pela API HTTPS com remetente e destinatário corretos', async () => {
  let pedido;
  const t = transporteBrevo({ chave: 'xkeysib-teste', fetchImpl: async (url, init) => { pedido = { url, init }; return new Response(JSON.stringify({ messageId: '<m1>' }), { status: 201 }); } });
  await t.sendMail({ from: 'HS Recuperação <hsrecupera@gmail.com>', to: 'cliente@x.com', subject: 'Assunto', text: 'oi', html: '<p>oi</p>' });
  assert.equal(pedido.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(pedido.init.headers['api-key'], 'xkeysib-teste');
  const corpo = JSON.parse(pedido.init.body);
  assert.deepEqual(corpo.sender, { name: 'HS Recuperação', email: 'hsrecupera@gmail.com' });
  assert.deepEqual(corpo.to, [{ email: 'cliente@x.com' }]);
  const falha = transporteBrevo({ chave: 'x', fetchImpl: async () => new Response('{"message":"sender not verified"}', { status: 400 }) });
  await assert.rejects(falha.sendMail({ from: 'a@b.com', to: 'c@d.com', subject: 's', text: 't', html: 'h' }), /sender not verified/);
});

test('se o e-mail falhar, quem tem aplicativo autenticador entra por ele; quem não tem recebe aviso', async () => {
  const d2 = mkdtempSync(join(tmpdir(), 'hs-cod2-'));
  const quebrado = { sendMail: async () => { throw new Error('Brevo fora do ar'); } };
  const a = criarApp({ dataDir: d2, webDir: join(d2, 'web'), transporteEmail: quebrado, env: envBanco() });
  const { codigo } = await import('../src/server/totp.js');
  let segredo;
  await a.exclusivo(async () => {
    await a.auth.cadastrar({ email: 'com-app@x.com', senha: 'SenhaForte1' });
    const ini = await a.auth.iniciar2fa('com-app@x.com');
    segredo = ini.segredo.replace(/\s/g, '');
    await a.auth.ativar2fa('com-app@x.com', codigo(segredo, Math.floor(Date.now() / 30000)));
    await a.auth.cadastrar({ email: 'sem-app@x.com', senha: 'SenhaForte1' });
  });
  const r1 = await a.exclusivo(() => a.auth.login('com-app@x.com', 'SenhaForte1'));
  assert.equal(r1.metodo, 'app');
  assert.match(r1.aviso, /aplicativo/);
  const r2 = await a.exclusivo(() => a.auth.login('sem-app@x.com', 'SenhaForte1'));
  assert.match(r2.erro, /Não foi possível enviar/);
  await a.banco.fechar(); rmSync(d2, { recursive: true, force: true });
});
