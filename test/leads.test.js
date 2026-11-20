import { test } from 'node:test';
import { TABELA_ANTERIOR } from '../src/core/comissao.js';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarApp } from '../src/server/app.js';
import { analisarPlanilha } from '../src/app/actions/leads.js';
import { app, envBanco } from './helpers.js';

const CSV = 'nome;cpf_cnpj;valor_original;data_vencimento\nAna;52998224725;1.000,00;01/10/2026\nBeto;11144477735;2.000,00;01/03/2026\nCaio;39053344705;500,00;01/12/2026\nSem valor;12345678909;;01/01/2026\n';

test('análise da planilha: total, vencido, a vencer, faixas de atraso e comissão estimada', () => {
  const a = analisarPlanilha(CSV, { hoje: '2026-11-14', faixas: TABELA_ANTERIOR });
  assert.equal(a.validas, 3);
  assert.equal(a.ignoradas, 1);
  assert.equal(a.devedores, 3);
  assert.equal(a.total_centavos, 350000);
  assert.equal(a.a_vencer_centavos, 50000);
  assert.equal(a.vencido_centavos, 300000);
  assert.equal(a.por_faixa[0].quantidade, 1, 'Ana: 44 dias');
  assert.equal(a.por_faixa[2].quantidade, 1, 'Beto: 258 dias');
  assert.equal(a.comissao_estimada_centavos, 10000 + 40000);
  assert.throws(() => analisarPlanilha('nome;valor\n', { hoje: '2026-11-14' }), /vazia/);
});

test('formulário público de diagnóstico: grava o pedido com análise, avisa a equipe e confirma ao contato', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hs-lead-'));
  const enviados = [];
  const a = criarApp({ dataDir: dir, webDir: join(dir, 'web'), env: envBanco(), urlBase: 'https://acorly.com.br', transporteEmail: { sendMail: async (m) => { enviados.push(m); return { messageId: 'x' }; } } });
  await a.exclusivo(() => a.db.UsuarioPlataforma.create({ nome: 'Super', email: 'super@hs.com', perfil: 'SUPERADMIN_HS', empresa_id: null, status: 'ATIVO' }));
  await new Promise((ok) => a.server.listen(0, ok));
  const b = `http://127.0.0.1:${a.server.address().port}/api/publico/diagnostico`;
  const enviar = (corpo) => fetch(b, { method: 'POST', headers: { 'X-HS': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const base = { nome: 'Joana Lima', empresa: 'Escola Saber', email: 'joana@escola.com', whatsapp: '(71) 99999-0000', segmento: 'ESCOLA_CURSO', aceite_privacidade: true, tempo_ms: 9000 };
  try {
    assert.match((await enviar({ ...base, aceite_privacidade: false })).body.error, /Política de Privacidade/);
    assert.match((await enviar({ ...base, email: 'x' })).body.error, /e-mail válido/);
    // robô: campo invisível preenchido → responde ok, mas não grava
    assert.equal((await enviar({ ...base, site: 'http://spam' })).status, 200);
    const r = await enviar({ ...base, arquivo: { nome: 'carteira.csv', conteudo: Buffer.from(CSV).toString('base64') } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const leads = await a.exclusivo(() => a.db.Lead.filter({}));
    assert.equal(leads.length, 1);
    const l = leads[0];
    assert.equal(l.status, 'NOVO');
    assert.equal(l.whatsapp, '71999990000');
    assert.ok(l.arquivo_uri);
    assert.equal(JSON.parse(l.analise).devedores, 3);
    const aviso = (await a.exclusivo(() => a.db.Notificacao.filter({}))).find((n) => n.tipo === 'LEAD');
    assert.match(aviso.titulo, /Novo pedido de diagnóstico: Escola Saber/);
    assert.ok(enviados.some((m) => m.to === 'joana@escola.com' && /Recebemos seu pedido/.test(m.subject)), 'confirmação ao contato');
    assert.match((await enviar({ ...base, arquivo: { nome: 'x.exe', conteudo: 'AAAA' } })).body.error, /CSV, XLSX ou PDF/);
    for (let i = 0; i < 3; i++) await enviar({ ...base });
    assert.equal((await enviar({ ...base })).status, 429, 'limite de envios por hora');
  } finally {
    a.server.close(); await a.banco.fechar(); rmSync(dir, { recursive: true, force: true });
  }
});

test('equipe acompanha os pedidos: lista com contagem por situação e atualização', async () => {
  const t = app();
  await t.db.UsuarioPlataforma.create({ nome: 'Super', email: 'super@hs.com', perfil: 'SUPERADMIN_HS', empresa_id: null, status: 'ATIVO' });
  await t.db.UsuarioPlataforma.create({ nome: 'Op', email: 'op@hs.com', perfil: 'OPERADOR_HS', empresa_id: null, status: 'ATIVO' });
  const l = await t.db.Lead.create({ nome: 'Joana', empresa: 'Escola', email: 'j@e.com', status: 'NOVO', recebido_em: '2026-11-14T10:00:00Z', analise: JSON.stringify({ devedores: 2 }) });
  const lista = await t.ok('super@hs.com', 'listarLeads', {});
  assert.equal(lista.total, 1);
  assert.equal(lista.itens[0].analise.devedores, 2);
  assert.equal(lista.contagem.NOVO, 1);
  await t.ok('super@hs.com', 'atualizarLead', { id: l.id, status: 'EM_CONTATO', observacoes: 'Liguei, retorno sexta' });
  assert.equal((await t.db.Lead.filter({ id: l.id }))[0].status, 'EM_CONTATO');
  await t.falha('super@hs.com', 'atualizarLead', { id: l.id, status: 'XYZ' }, 422);
  await t.falha('op@hs.com', 'listarLeads', {}, 403);
});

test('diagnóstico anônimo: planilha só com valor e vencimento é analisada com a tabela do Piloto', async () => {
  const { analisarPlanilha } = await import('../src/app/actions/leads.js');
  const a = analisarPlanilha('valor;vencimento\n1250,50;10/08/2026\n480,00;05/09/2026\n', { hoje: '2026-11-20' });
  assert.equal(a.validas, 2);
  assert.equal(a.vencido_centavos, 173050);
  assert.equal(a.por_faixa.length, 2);
  assert.equal(a.comissao_estimada_centavos, Math.round(173050 * 0.10));
});
