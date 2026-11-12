import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarApp } from '../src/server/app.js';
import { cnpj, envBanco } from './helpers.js';

let app, base, dir;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hs-srv-'));
  app = criarApp({ dataDir: dir, urlBase: 'http://teste', webDir: join(dir, 'web'), env: envBanco() });
  await new Promise((ok) => app.server.listen(0, ok));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => { app.server.close(); await app.banco.fechar(); rmSync(dir, { recursive: true, force: true }); });

function cliente() {
  let cookie = '';
  const req = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, {
      method, headers: { 'X-HS': '1', ...(body !== undefined && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text(), headers: r.headers };
  };
  return { req, rpc: (action, payload) => req('POST', '/api/rpc', { action, payload }), get cookie() { return cookie; } };
}

test('cadastro, login, sessão, CSRF e bloqueio por tentativas', async () => {
  const c = cliente();
  assert.equal((await c.req('POST', '/api/auth/cadastro', { email: 'dono@empresa.com', senha: 'curta' })).status, 422);
  const r = await c.req('POST', '/api/auth/cadastro', { email: 'Dono@Empresa.com', senha: 'senhaForte1', nome: 'Dono' });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const perfil = await c.rpc('meuPerfil');
  assert.equal(perfil.body.data.precisa_onboarding, true);
  // sem cabeçalho anti-CSRF é recusado
  const semHeader = await fetch(base + '/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: c.cookie }, body: '{"action":"meuPerfil"}' });
  assert.equal(semHeader.status, 403);
  // onboarding cria a empresa
  const emp = await c.rpc('registrarEmpresa', { razao_social: 'Empresa Teste', cnpj: cnpj(9), email: 'a@b.com', telefone: '1133334444', endereco: 'Rua 1', responsavel_legal: 'X', aceite_termos: true, aceite_privacidade: true });
  assert.equal(emp.status, 200, JSON.stringify(emp.body));
  await c.req('POST', '/api/auth/logout', {});
  assert.equal((await c.rpc('meuPerfil')).status, 401);
  assert.equal((await c.req('POST', '/api/auth/login', { email: 'dono@empresa.com', senha: 'errada123' })).status, 401);
  assert.equal((await c.req('POST', '/api/auth/login', { email: 'dono@empresa.com', senha: 'senhaForte1' })).status, 200);
  assert.equal((await c.rpc('meuPerfil')).body.data.usuario.perfil, 'ADMIN_EMPRESA');
  const x = cliente();
  for (let i = 0; i < 5; i++) await x.req('POST', '/api/auth/login', { email: 'dono@empresa.com', senha: 'errada' + i });
  assert.match((await x.req('POST', '/api/auth/login', { email: 'dono@empresa.com', senha: 'senhaForte1' })).body.error, /Muitas tentativas/);
});

test('convite por link define senha; e-mail convidado não pode ser tomado por cadastro público', async () => {
  const admin = cliente();
  await admin.req('POST', '/api/auth/cadastro', { email: 'adm2@empresa.com', senha: 'senhaForte1' });
  await admin.rpc('registrarEmpresa', { razao_social: 'Outra', cnpj: cnpj(10), email: 'o@b.com', telefone: '1133334444', endereco: 'Rua 1', responsavel_legal: 'X', aceite_termos: true, aceite_privacidade: true });
  const conv = await admin.rpc('convidarUsuario', { nome: 'Fin', email: 'fin@empresa.com', perfil: 'FINANCEIRO_EMPRESA' });
  assert.match(conv.body.data.convite_link, /^http:\/\/teste\/convite\//);
  const token = conv.body.data.convite_link.split('/').pop();
  const intruso = cliente();
  assert.equal((await intruso.req('POST', '/api/auth/cadastro', { email: 'fin@empresa.com', senha: 'senhaForte1' })).status, 422);
  const fin = cliente();
  assert.equal((await fin.req('GET', `/api/auth/convite/${token}`)).body.data.email, 'fin@empresa.com');
  assert.equal((await fin.req('POST', '/api/auth/convite', { token, senha: 'outraSenha9' })).status, 200);
  assert.equal((await fin.rpc('meuPerfil')).body.data.usuario.perfil, 'FINANCEIRO_EMPRESA');
  assert.equal((await fin.req('POST', '/api/auth/convite', { token, senha: 'outraSenha9' })).status, 422, 'convite é de uso único');
});

test('upload privado, vínculo ao documento e link assinado temporário', async () => {
  const c = cliente();
  await c.req('POST', '/api/auth/login', { email: 'adm2@empresa.com', senha: 'senhaForte1' });
  await app.exclusivo(async () => { const e = (await app.db.Empresa.filter({ razao_social: 'Outra' }))[0]; await app.db.Empresa.update(e.id, { status: 'ATIVA' }); });
  const dev = await c.rpc('salvarDevedor', { nome: 'Fulano', tipo_pessoa: 'PF', cpf_cnpj: '52998224725', whatsapp: '11999990000' });
  const div = await c.rpc('salvarDivida', { devedor_id: dev.body.data.id, valor_original_centavos: 1000, data_vencimento: '2026-01-10' });
  const falso = await c.req('POST', '/api/upload', new TextEncoder().encode('não sou pdf'), { 'Content-Type': 'application/pdf', 'X-Filename': 'x.pdf' });
  assert.equal(falso.status, 422);
  const up = await c.req('POST', '/api/upload', new TextEncoder().encode('%PDF-1.4 teste'), { 'Content-Type': 'application/pdf', 'X-Filename': encodeURIComponent('nota fiscal.pdf') });
  assert.equal(up.status, 200);
  const file_uri = up.body.data.file_uri;
  const anexo = await c.rpc('anexarDocumento', { divida_id: div.body.data.id, file_uri, nome_arquivo: 'nf.pdf' });
  assert.equal(anexo.status, 200);
  assert.equal((await c.rpc('anexarDocumento', { divida_id: div.body.data.id, file_uri })).status, 422, 'arquivo não pode ser reutilizado');
  const url = (await c.rpc('urlDocumento', { documento_id: anexo.body.data.id })).body.data.url;
  const arq = await fetch(base + url);
  assert.equal(arq.status, 200);
  assert.equal(await arq.text(), '%PDF-1.4 teste');
  assert.match(arq.headers.get('content-security-policy'), /sandbox/);
  const adulterado = await fetch(base + url.replace(/sig=(.)/, (_, c) => `sig=${c === 'A' ? 'B' : 'A'}`));
  assert.equal(adulterado.status, 404);
  // anônimo não envia arquivos
  assert.equal((await cliente().req('POST', '/api/upload', new TextEncoder().encode('%PDF-'), { 'Content-Type': 'application/pdf' })).status, 401);
});

test('falha numa ação desfaz todas as gravações dela (transação)', async () => {
  const antes = await app.exclusivo(() => app.db.HistoricoAuditoria.filter({}));
  const r = await app.exclusivo(async () => {
    await app.db.HistoricoAuditoria.create({ acao: 'TESTE', data_hora: 'x' });
    return { status: 422, __rollback: true };
  });
  assert.equal(r.status, 422);
  const depois = await app.exclusivo(() => app.db.HistoricoAuditoria.filter({}));
  assert.equal(depois.length, antes.length);
  await assert.rejects(app.exclusivo(async () => { await app.db.Notificacao.create({ usuario_id: 'u', titulo: 't' }); throw new Error('boom'); }));
  assert.equal((await app.exclusivo(() => app.db.Notificacao.filter({ usuario_id: 'u' }))).length, 0);
});

test('atrás do proxy, o limite de tentativas é por IP real do cliente', async () => {
  const d = mkdtempSync(join(tmpdir(), 'hs-px-'));
  const a = criarApp({ dataDir: d, webDir: join(d, 'web'), confiarProxy: true, env: envBanco() });
  await new Promise((ok) => a.server.listen(0, ok));
  const url = `http://127.0.0.1:${a.server.address().port}/api/auth/login`;
  const tentar = (ip) => fetch(url, { method: 'POST', headers: { 'X-HS': '1', 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: '{"email":"x@x.com","senha":"errada1"}' });
  for (let i = 0; i < 21; i++) await tentar('203.0.113.7');
  assert.equal((await tentar('203.0.113.7')).status, 429);
  assert.equal((await tentar('198.51.100.9')).status, 401, 'outro cliente não é bloqueado');
  a.server.close(); await a.banco.fechar(); rmSync(d, { recursive: true, force: true });
});

test('site público: planos ativos sem login e sem dados internos', async () => {
  await app.exclusivo(async () => { if (!(await app.db.Plano.filter({})).length) await app.db.Plano.create({ nome: 'HS ESSENCIAL', preco_mensal_centavos: 4990, status: 'ATIVO', ordem: 1, limite_devedores: 200, funcionalidades: ['devedores'] }); await app.db.Plano.create({ nome: 'OCULTO', preco_mensal_centavos: 1, status: 'INATIVO' }); });
  const r = await fetch(base + '/api/publico');
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.ok(j.data.planos.some((p) => p.nome === 'HS ESSENCIAL'));
  assert.ok(!j.data.planos.some((p) => p.nome === 'OCULTO'));
  assert.equal(j.data.planos[0].id, undefined, 'não expõe ids');
});
