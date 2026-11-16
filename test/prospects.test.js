import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, envBanco } from './helpers.js';
import { criarApp } from '../src/server/app.js';

const C = (x) => ({ segmento: 'ESCOLA_CURSO', cidade: 'Salvador/BA', fonte_url: 'https://www.escol.as/316921-colegio-sophia', ...x });

async function base() {
  const t = app();
  await t.db.UsuarioPlataforma.create({ nome: 'Hugo', email: 'super@hs.com', perfil: 'SUPERADMIN_HS', empresa_id: null, status: 'ATIVO' });
  return t;
}

test('lista do dia: importa contatos válidos, ignora repetidos e inválidos, avisa o superadmin', async () => {
  const t = await base();
  await t.db.Lead.create({ nome: 'Já', empresa: 'Já cliente', email: 'contato@jacliente.com.br', status: 'CONVERTIDO' });
  const r = await t.ok('super@hs.com', 'adicionarProspects', { contatos: [
    C({ empresa: 'Colégio Sophia', email: 'contato@colegiosophia.com.br', telefone: '(71) 3249-3860', site: 'https://www.colegiosophia.com.br' }),
    C({ empresa: 'Colégio Sophia (outra página)', telefone: '7132493860' }),
    C({ empresa: 'Outra Escola', email: 'secretaria@colegiosophia.com.br' }),
    C({ empresa: 'Já cliente', email: 'financeiro@jacliente.com.br' }),
    C({ empresa: 'Sem contato' }),
    C({ empresa: 'Sem fonte', email: 'a@b.com.br', fonte_url: '' }),
    C({ empresa: 'Clínica Boa Saúde', segmento: 'SAUDE', whatsapp: '71999990000' }),
  ] });
  assert.equal(r.criados, 2);
  assert.equal(r.duplicados, 3, 'mesmo telefone, mesmo domínio de e-mail e domínio de cliente já existente');
  assert.equal(r.invalidos.length, 2);
  const lista = await t.ok('super@hs.com', 'listarProspects', {});
  assert.equal(lista.total, 2);
  assert.equal(lista.novos_hoje, 2);
  assert.ok((await t.db.Notificacao.filter({})).some((n) => /Lista do dia: 2 novo/.test(n.titulo)));
});

test('abordagem: WhatsApp com mensagem pronta; abordado sai da lista e vira lead; não abordado continua', async () => {
  const t = await base();
  await t.ok('super@hs.com', 'adicionarProspects', { contatos: [C({ empresa: 'Clínica Boa Saúde', segmento: 'SAUDE', whatsapp: '71999990000' }), C({ empresa: 'Escola Alfa', email: 'contato@alfa.com.br' }), C({ empresa: 'Escola Beta', email: 'contato@beta.com.br' })] });
  let lista = await t.ok('super@hs.com', 'listarProspects', {});
  const clinica = lista.itens.find((p) => p.empresa === 'Clínica Boa Saúde');
  const w = await t.ok('super@hs.com', 'whatsappProspect', { id: clinica.id });
  assert.match(w.link, /^https:\/\/wa\.me\/5571999990000\?text=/);
  assert.match(w.mensagem, /Sou Hugo, da HS Recuperação de Crédito\. Ajudamos clínicas e consultórios/);
  const r = await t.ok('super@hs.com', 'registrarAbordagemProspect', { id: clinica.id, canal: 'WHATSAPP', observacao: 'Respondeu que vai ver' });
  const [lead] = await t.db.Lead.filter({ id: r.lead_id });
  assert.equal(lead.origem, 'PROSPECCAO');
  assert.equal(lead.whatsapp, '71999990000');
  assert.match(lead.observacoes, /abordado por WhatsApp — Respondeu que vai ver/);
  // e-mail pelo envio comercial também tira da lista
  const enviados = [];
  t.estado.extras.email = { comercial: async (m) => { enviados.push(m); return { ok: true }; } };
  const alfa = lista.itens.find((p) => p.empresa === 'Escola Alfa');
  const modelos = await t.ok('super@hs.com', 'listarModelosComerciais');
  await t.ok('super@hs.com', 'enviarEmailComercial', { prospect_id: alfa.id, para: alfa.email, empresa: alfa.empresa, segmento: 'ESCOLA_CURSO', modelo_id: modelos[0].id });
  lista = await t.ok('super@hs.com', 'listarProspects', {});
  assert.deepEqual(lista.itens.map((p) => p.empresa), ['Escola Beta'], 'só o não abordado continua na lista');
  assert.equal((await t.ok('super@hs.com', 'listarProspects', { status: 'ABORDADO' })).total, 2);
  await t.falha('super@hs.com', 'registrarAbordagemProspect', { id: clinica.id, canal: 'WHATSAPP' }, 422);
  // repetido de quem já foi abordado não volta para a lista
  assert.equal((await t.ok('super@hs.com', 'adicionarProspects', { contatos: [C({ empresa: 'Clínica Boa Saúde', whatsapp: '(71) 99999-0000' })] })).duplicados, 1);
});

test('busca diária envia pela integração com token; sem token é recusado', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hs-pros-'));
  const token = 'tk_' + 'x'.repeat(30);
  const a = criarApp({ dataDir: dir, webDir: join(dir, 'web'), env: { ...envBanco(), LEADS_API_TOKEN: token } });
  await new Promise((ok) => a.server.listen(0, ok));
  const b = `http://127.0.0.1:${a.server.address().port}/api/integracao/prospects`;
  const enviar = (auth, corpo) => fetch(b, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) }, body: JSON.stringify(corpo) });
  try {
    assert.equal((await enviar(null, { contatos: [] })).status, 401);
    assert.equal((await enviar('Bearer errado', { contatos: [] })).status, 401);
    const r = await enviar(`Bearer ${token}`, { contatos: [C({ empresa: 'Escola Gama', email: 'contato@gama.com.br' })] });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).data.criados, 1);
    assert.equal((await a.exclusivo(() => a.db.Prospect.filter({}))).length, 1);
  } finally {
    a.server.close(); await a.banco.fechar(); rmSync(dir, { recursive: true, force: true });
  }
});

test('diagnósticos e prospecção: só o superadmin acessa', async () => {
  const t = await base();
  await t.db.UsuarioPlataforma.create({ nome: 'Gil', email: 'gestor@hs.com', perfil: 'GESTOR_OPERACOES_HS', empresa_id: null, status: 'ATIVO' });
  await t.db.UsuarioPlataforma.create({ nome: 'Olga', email: 'oper@hs.com', perfil: 'OPERADOR_HS', empresa_id: null, status: 'ATIVO' });
  for (const quem of ['gestor@hs.com', 'oper@hs.com']) {
    for (const acao of ['listarProspects', 'listarLeads', 'listarModelosComerciais']) await t.falha(quem, acao, {}, 403);
  }
  await t.ok('super@hs.com', 'listarLeads', {});
});
