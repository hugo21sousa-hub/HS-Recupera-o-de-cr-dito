import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, envBanco } from './helpers.js';
import { renderizarEmailComercial, preencher } from '../src/core/emailComercial.js';
import { MODELOS_COMERCIAIS } from '../src/app/actions/prospeccao.js';
import { criarApp } from '../src/server/app.js';
import { criarDescadastro } from '../src/server/descadastro.js';

test('e-mail comercial: marcações viram HTML com a marca, texto puro e link de saída', () => {
  const corpo = preencher('Olá, {{nome}}!\n## Serviços\n- **Plataforma** com <script>\n[[botao:Diagnóstico|https://acorly.com.br/diagnostico]]\n[[link:Vídeo|javascript:alert(1)]]', { nome: 'Ana' });
  const r = renderizarEmailComercial({ corpo, urlBase: 'https://acorly.com.br', rodape: 'HS', sair: 'https://acorly.com.br/sair/x.y' });
  assert.match(r.html, /Olá, Ana!/);
  assert.match(r.html, /<h2[^>]*>Serviços<\/h2>/);
  assert.match(r.html, /<li[^>]*><strong>Plataforma<\/strong> com &lt;script&gt;<\/li>/);
  assert.match(r.html, /href="https:\/\/acorly\.com\.br\/diagnostico"/);
  assert.doesNotMatch(r.html, /href="javascript/, 'link inseguro não vira botão');
  assert.match(r.html, /email-logo\.png/);
  assert.match(r.texto, /• Plataforma com <script>/);
  assert.match(r.texto, /Para não receber mais: https:\/\/acorly\.com\.br\/sair\/x\.y/);
});

test('prospecção: modelos padrão, prévia personalizada, envio cria o lead e respeita limite e descadastro', async () => {
  const t = app();
  await t.db.UsuarioPlataforma.create({ nome: 'Hugo Sousa', email: 'super@hs.com', perfil: 'SUPERADMIN_HS', empresa_id: null, status: 'ATIVO' });
  await t.db.UsuarioPlataforma.create({ nome: 'Op', email: 'op@hs.com', perfil: 'OPERADOR_HS', empresa_id: null, status: 'ATIVO' });
  const enviados = [];
  t.estado.extras.urlBase = 'https://acorly.com.br';
  t.estado.extras.contato = { email: 'contato@acorly.com.br', whatsapp: '71999990000' };
  t.estado.extras.email = { comercial: async (m) => { enviados.push(m); return { ok: true, id: 'm1' }; } };
  t.estado.extras.descadastro = { linkComercial: (id) => `https://acorly.com.br/sair/${id}.sig` };
  const modelos = await t.ok('super@hs.com', 'listarModelosComerciais');
  assert.equal(modelos.length, MODELOS_COMERCIAIS.length);
  await t.falha('op@hs.com', 'listarModelosComerciais', {}, 403);
  const geral = modelos.find((m) => m.nome === 'Apresentação dos serviços');
  const previa = await t.ok('super@hs.com', 'previaEmailComercial', { modelo_id: geral.id, nome: 'Joana Lima', empresa: 'Colégio Saber', segmento: 'ESCOLA_CURSO' });
  assert.equal(previa.assunto, 'Colégio Saber: recuperar a inadimplência sem desgastar seus clientes');
  assert.match(previa.html, /Olá, Joana, tudo bem\?/);
  assert.match(previa.html, /Sou Hugo Sousa, da HS Recuperação de Crédito\. Ajudamos escolas e cursos como a Colégio Saber/);
  assert.match(previa.html, /assinatura-email\.png/, "no HTML a assinatura é a imagem (com o WhatsApp da Acorly)");
  assert.ok(!previa.html.includes("Abraço,"));

  const r = await t.ok('super@hs.com', 'enviarEmailComercial', { modelo_id: geral.id, para: 'Joana@ColegioSaber.com.br', nome: 'Joana Lima', empresa: 'Colégio Saber', segmento: 'ESCOLA_CURSO' });
  assert.equal(enviados[0].para, 'joana@colegiosaber.com.br');
  assert.match(enviados[0].sair, /\/sair\//);
  const [lead] = await t.db.Lead.filter({ id: r.lead_id });
  assert.equal(lead.origem, 'PROSPECCAO');
  assert.equal(lead.status, 'EM_CONTATO');
  assert.equal((await t.ok('super@hs.com', 'enviosDoLead', { lead_id: lead.id })).length, 1);
  // retorno usa o mesmo lead
  const retorno = modelos.find((m) => m.nome.startsWith('Retorno'));
  await t.ok('super@hs.com', 'enviarEmailComercial', { modelo_id: retorno.id, para: 'joana@colegiosaber.com.br' });
  assert.equal((await t.db.Lead.filter({ email: 'joana@colegiosaber.com.br' })).length, 1);
  assert.match(enviados[1].assunto, /^Re: Colégio Saber/);
  // descadastrado não recebe mais
  await t.db.Lead.update(lead.id, { nao_receber_comercial: true });
  assert.match((await t.falha('super@hs.com', 'enviarEmailComercial', { modelo_id: geral.id, para: 'joana@colegiosaber.com.br' }, 422)).error, /não receber/);
  assert.match((await t.falha('super@hs.com', 'enviarEmailComercial', { modelo_id: geral.id, para: 'x' }, 422)).error, /e-mail válido/);
});

test('link "sair da lista": confirmação por POST marca o lead e avisa o superadmin', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hs-sair-'));
  const a = criarApp({ dataDir: dir, webDir: join(dir, 'web'), env: { ...envBanco(), SEGREDO: 'seg' }, urlBase: 'http://local' });
  await a.exclusivo(async () => { await a.db.UsuarioPlataforma.create({ nome: 'S', email: 's@hs.com', perfil: 'SUPERADMIN_HS', empresa_id: null, status: 'ATIVO' }); });
  const lead = await a.exclusivo(() => a.db.Lead.create({ nome: 'J', empresa: 'Escola', email: 'j@e.com', status: 'EM_CONTATO' }));
  const caminho = new URL(criarDescadastro({ segredo: 'seg', urlBase: 'http://local' }).linkComercial(lead.id)).pathname;
  await new Promise((ok) => a.server.listen(0, ok));
  const b = `http://127.0.0.1:${a.server.address().port}`;
  try {
    assert.match(await (await fetch(b + caminho)).text(), /<form method="post">/);
    assert.equal((await fetch(b + caminho, { method: 'POST' })).status, 200);
    const [l] = await a.exclusivo(() => a.db.Lead.filter({ id: lead.id }));
    assert.equal(l.nao_receber_comercial, true);
    assert.equal(l.status, 'PERDIDO');
    assert.equal((await fetch(`${b}/sair/${lead.id}.invalido00000000000000000000000000`)).status, 404);
  } finally {
    a.server.close(); await a.banco.fechar(); rmSync(dir, { recursive: true, force: true });
  }
});
