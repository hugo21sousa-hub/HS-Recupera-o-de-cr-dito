import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from './helpers.js';
import { processarCampanhas } from '../src/app/actions/campanhas.js';
import { rodarLembretes } from '../src/app/lembretes.js';

const S = 'super@hs.com';
async function base({ falhar = () => false } = {}) {
  const t = app();
  await t.db.UsuarioPlataforma.create({ nome: 'Hugo Sousa', email: S, perfil: 'SUPERADMIN_HS', empresa_id: null, status: 'ATIVO' });
  t.enviados = [];
  t.estado.extras.email = { comercial: async (m) => { if (falhar(m)) return { ok: false, erro: 'timeout' }; t.enviados.push(m); return { ok: true, id: `m${t.enviados.length}` }; } };
  t.estado.extras.descadastro = { linkComercial: (id) => `https://acorly.com.br/sair/${id}` };
  return t;
}
const sys = (t) => ({ db: t.db, user: { id: 'sistema', perfil: 'SUPERADMIN_HS', nome: 'Sistema' }, now: () => t.estado.agora, email: t.estado.extras.email, descadastro: t.estado.extras.descadastro });
const lista = (n, dom = 'empresa') => Array.from({ length: n }, (_, i) => ({ email: `contato@${dom}${i}.com.br`, nome: `Pessoa ${i}` }));

test('prévia confere a planilha: inválidos, repetidos, quem saiu, quem recebeu há pouco', async () => {
  const t = await base();
  await t.db.Lead.create({ nome: 'X', empresa: 'Saiu', email: 'contato@saiu.com.br', status: 'PERDIDO', nao_receber_comercial: true });
  await t.db.EnvioComercial.create({ email: 'contato@recente.com.br', enviado_em: '2026-11-01T12:00:00Z' });
  await t.db.EnvioComercial.create({ email: 'contato@antigo.com.br', enviado_em: '2026-09-01T12:00:00Z' });
  const [modelo] = await t.ok(S, 'listarModelosComerciais');
  const p = await t.ok(S, 'previaCampanha', { modelo_id: modelo.id, contatos: [
    { email: 'Financeiro@Colegio-Sophia.com.br', nome: 'Ana Lima', segmento: 'Escola' },
    { email: 'financeiro@colegio-sophia.com.br' },
    { email: 'sem-arroba' },
    { email: 'fulano@gmail.com' },
    { email: 'fulano2@gmail.com', empresa: 'Loja do Fulano' },
    { email: 'contato@saiu.com.br' },
    { email: 'contato@recente.com.br' },
    { email: 'contato@antigo.com.br' },
  ] });
  assert.equal(p.validos, 3);
  assert.deepEqual(p.invalidos.map((x) => x.motivo), ['E-mail inválido', 'Informe a empresa (e-mail de Gmail, Hotmail etc.)']);
  assert.deepEqual(p.ignorados.map((x) => x.motivo), ['Repetido na planilha', 'Pediu para não receber e-mails da Acorly', 'Recebeu e-mail nos últimos 30 dias']);
  assert.equal(p.amostra.length, 3);
  assert.match(p.amostra[0].html, /Olá, Ana, tudo bem\?/);
  assert.match(p.amostra[0].assunto, /^Colegio Sophia/);
  assert.equal(t.enviados.length, 0, 'prévia não envia nada');
});

test('campanha: primeiro lote na hora, resto de hora em hora, sem passar de 50 por dia; conclui e avisa', async () => {
  const t = await base();
  const [modelo] = await t.ok(S, 'listarModelosComerciais');
  const r = await t.ok(S, 'criarCampanha', { nome: 'Escolas novembro', modelo_id: modelo.id, contatos: lista(70), arquivo_nome: 'escolas.csv' });
  assert.equal(r.na_fila, 70);
  assert.equal(r.enviados_agora, 10);
  assert.match(t.enviados[0].html, /Hugo Sousa/, 'assina quem criou a campanha');
  assert.match(t.enviados[0].html, /sair\//, 'link para sair da lista');
  for (let h = 0; h < 6; h++) await processarCampanhas(sys(t));
  assert.equal(t.enviados.length, 50, 'para no limite diário');
  let [c] = (await t.ok(S, 'listarCampanhas')).itens;
  assert.deepEqual([c.enviados, c.pendentes, c.status, c.dias_restantes], [50, 20, 'ATIVA', 1]);
  await t.falha(S, 'enviarLoteCampanha', { id: c.id }, 422);
  // dia seguinte, pelo job de lembretes (horário comercial)
  t.estado.agora = new Date('2026-11-12T13:00:00Z');
  await rodarLembretes(sys(t));
  await rodarLembretes(sys(t));
  [c] = (await t.ok(S, 'listarCampanhas')).itens;
  assert.deepEqual([c.enviados, c.pendentes, c.status], [70, 0, 'CONCLUIDA']);
  assert.ok((await t.db.Notificacao.filter({})).some((n) => /Campanha concluída: Escolas novembro/.test(n.titulo)));
  // cada destinatário virou contato com cadência
  const leads = await t.db.Lead.filter({});
  assert.equal(leads.length, 70);
  assert.ok(leads.every((l) => l.proximo_followup && l.origem === 'PROSPECCAO'));
  assert.equal((await t.db.EnvioComercial.filter({ campanha_id: c.id })).length, 70);
  // mesma lista de novo: todos ignorados (recebeu nos últimos 30 dias)
  const p = await t.ok(S, 'previaCampanha', { modelo_id: modelo.id, contatos: lista(5) });
  assert.equal(p.validos, 0);
});

test('pausar, retomar, cancelar; falha de envio tenta de novo e desiste após 3; quem saiu no meio é ignorado', async () => {
  const t = await base({ falhar: (m) => m.para === 'contato@empresa1.com.br' });
  const [modelo] = await t.ok(S, 'listarModelosComerciais');
  const { id } = await t.ok(S, 'criarCampanha', { nome: 'Teste', modelo_id: modelo.id, contatos: lista(3) });
  let ds = await t.ok(S, 'destinatariosCampanha', { id });
  assert.deepEqual(ds.map((d) => d.status), ['ENVIADO', 'PENDENTE', 'ENVIADO']);
  await t.ok(S, 'alterarCampanha', { id, acao: 'pausar' });
  assert.equal((await processarCampanhas(sys(t))).enviados, 0);
  await t.ok(S, 'alterarCampanha', { id, acao: 'retomar' });
  await processarCampanhas(sys(t)); await processarCampanhas(sys(t));
  ds = await t.ok(S, 'destinatariosCampanha', { id });
  assert.equal(ds[1].status, 'FALHA');
  assert.equal(ds[1].tentativas, 3);
  assert.equal((await t.ok(S, 'listarCampanhas')).itens[0].status, 'CONCLUIDA');
  // cancelar e saída no meio
  const c2 = await t.ok(S, 'criarCampanha', { nome: 'Outra', modelo_id: modelo.id, contatos: lista(40, 'loja') });
  const [l] = await t.db.Lead.filter({ email: 'contato@loja12.com.br' });
  assert.equal(l, undefined);
  await t.db.Lead.create({ nome: 'L', empresa: 'Loja 12', email: 'contato@loja12.com.br', status: 'PERDIDO', nao_receber_comercial: true });
  await processarCampanhas(sys(t));
  ds = await t.ok(S, 'destinatariosCampanha', { id: c2.id });
  assert.equal(ds.find((d) => d.email === 'contato@loja12.com.br').status, 'IGNORADO');
  await t.falha(S, 'criarCampanha', { nome: 'Dupla', modelo_id: modelo.id, contatos: lista(15, 'loja') }, 422);
  await t.ok(S, 'alterarCampanha', { id: c2.id, acao: 'cancelar' });
});

test('só o superadmin cria campanhas', async () => {
  const t = await base();
  await t.db.UsuarioPlataforma.create({ nome: 'Gil', email: 'gestor@hs.com', perfil: 'GESTOR_OPERACOES_HS', empresa_id: null, status: 'ATIVO' });
  await t.falha('gestor@hs.com', 'criarCampanha', { nome: 'x', contatos: lista(1) }, 403);
  await t.falha('gestor@hs.com', 'listarCampanhas', {}, 403);
});

test('fila: só uma campanha por vez; a próxima começa quando a anterior termina (ou é cancelada)', async () => {
  const t = await base();
  const [modelo] = await t.ok(S, 'listarModelosComerciais');
  const a = await t.ok(S, 'criarCampanha', { nome: 'Camp A', modelo_id: modelo.id, contatos: lista(25, 'a') });
  t.estado.agora = new Date(t.estado.agora.getTime() + 60e3);
  const b = await t.ok(S, 'criarCampanha', { nome: 'Camp B', modelo_id: modelo.id, contatos: lista(5, 'b') });
  t.estado.agora = new Date(t.estado.agora.getTime() + 60e3);
  const c = await t.ok(S, 'criarCampanha', { nome: 'Camp C', modelo_id: modelo.id, contatos: lista(30, 'c') });
  assert.deepEqual([a.enviados_agora, b.enviados_agora, b.aguardando, b.posicao, c.posicao], [10, 0, true, 2, 3]);
  await t.falha(S, 'enviarLoteCampanha', { id: b.id }, 422);
  const st = async () => Object.fromEntries((await t.ok(S, 'listarCampanhas')).itens.map((x) => [x.nome, [x.status, x.enviados]]));
  assert.deepEqual(await st(), { 'Camp A': ['ATIVA', 10], 'Camp B': ['AGUARDANDO', 0], 'Camp C': ['AGUARDANDO', 0] });
  await processarCampanhas(sys(t)); // A: +10 (20)
  assert.deepEqual(await st(), { 'Camp A': ['ATIVA', 20], 'Camp B': ['AGUARDANDO', 0], 'Camp C': ['AGUARDANDO', 0] });
  await processarCampanhas(sys(t)); // A termina (+5) e B começa na mesma rodada (+5, termina); C começa
  assert.deepEqual(await st(), { 'Camp A': ['CONCLUIDA', 25], 'Camp B': ['CONCLUIDA', 5], 'Camp C': ['ATIVA', 0] });
  assert.ok((await t.db.Notificacao.filter({})).some((n) => /Campanha começou: Camp C/.test(n.titulo)));
  // pausar a atual segura a fila; cancelar libera a próxima
  const d = await t.ok(S, 'criarCampanha', { nome: 'Camp D', modelo_id: modelo.id, contatos: lista(3, 'd') });
  await t.ok(S, 'alterarCampanha', { id: c.id, acao: 'pausar' });
  await processarCampanhas(sys(t));
  assert.deepEqual(await st(), { 'Camp A': ['CONCLUIDA', 25], 'Camp B': ['CONCLUIDA', 5], 'Camp C': ['PAUSADA', 0], 'Camp D': ['AGUARDANDO', 0] });
  await t.ok(S, 'alterarCampanha', { id: c.id, acao: 'cancelar' });
  assert.equal((await st())['Camp D'][0], 'ATIVA');
  assert.ok(d.id);
});

test('campanhas antigas abertas ao mesmo tempo entram em fila pela ordem de criação', async () => {
  const t = await base();
  for (const [nome, h] of [['Primeira', 10], ['Segunda', 11], ['Terceira', 12]]) {
    const c = await t.db.CampanhaEmail.create({ nome, status: 'ATIVA', assunto: 'x', corpo: 'y', criada_em: `2026-11-11T${h}:00:00Z`, total: 1 });
    await t.db.CampanhaDestinatario.create({ campanha_id: c.id, email: `x@${nome.toLowerCase()}.com.br`, empresa: nome, status: 'PENDENTE', ordem: 0 });
  }
  const l = await t.ok(S, 'listarCampanhas');
  assert.deepEqual(l.itens.map((x) => [x.nome, x.status, x.posicao_fila]), [['Terceira', 'AGUARDANDO', 3], ['Segunda', 'AGUARDANDO', 2], ['Primeira', 'ATIVA', 1]]);
});
