import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from './helpers.js';
import { registrarLead } from '../src/app/actions/leads.js';
import { avisoFollowups } from '../src/app/actions/acompanhamento.js';
import { epocaDoMes } from '../src/app/comercial/epoca.js';

const S = 'super@hs.com';
async function base() {
  const t = app();
  await t.db.UsuarioPlataforma.create({ nome: 'Hugo Sousa', email: S, perfil: 'SUPERADMIN_HS', empresa_id: null, status: 'ATIVO' });
  t.estado.extras.email = { comercial: async () => ({ ok: true }) };
  return t;
}
const sys = (t) => ({ db: t.db, user: { id: 'sistema', perfil: 'SUPERADMIN_HS', nome: 'Sistema' }, now: () => t.estado.agora });
const dia = (t, d) => { t.estado.agora = new Date(Date.parse('2026-11-11T14:00:00Z') + d * 864e5); };
const lead1 = async (t) => (await t.db.Lead.filter({}))[0];

test('época: em novembro a prioridade é 13º salário (escolas primeiro) e a lista do dia vem ordenada', async () => {
  assert.equal(epocaDoMes(11).decimo_terceiro, true);
  assert.equal(epocaDoMes(11).segmentos[0], 'ESCOLA_CURSO');
  assert.equal(epocaDoMes(1).segmentos[1], 'ACADEMIA');
  const t = await base();
  const fonte = 'https://exemplo.com.br/lista';
  await t.ok(S, 'adicionarProspects', { contatos: [
    { empresa: 'Distribuidora Z', segmento: 'DISTRIBUIDORA', email: 'a@dz.com.br', fonte_url: fonte },
    { empresa: 'Escola A', segmento: 'ESCOLA_CURSO', email: 'a@ea.com.br', whatsapp: '71999990001', fonte_url: fonte, contato_nome: 'Maria Souza', contato_cargo: 'Diretora' },
    { empresa: 'Contábil C', segmento: 'CONTABILIDADE', email: 'a@cc.com.br', telefone: '7133334444', fonte_url: fonte },
  ] });
  const l = await t.ok(S, 'listarProspects', {});
  assert.deepEqual(l.itens.map((p) => p.empresa), ['Escola A', 'Contábil C', 'Distribuidora Z']);
  assert.equal(l.itens[0].prioridade, true);
  assert.match(l.epoca.tema, /13º/);
  const w = await t.ok(S, 'whatsappProspect', { id: l.itens[0].id });
  assert.match(w.mensagem, /^Olá, Maria!.*13º/);
  assert.match((await t.ok(S, 'whatsappProspect', { id: l.itens[1].id })).mensagem, /parceria com o escritório/);
  // decisor vem para o lead ao abordar
  const r = await t.ok(S, 'registrarAbordagemProspect', { id: l.itens[0].id, canal: 'TELEFONE' });
  const [lead] = await t.db.Lead.filter({ id: r.lead_id });
  assert.equal(lead.decisor_nome, 'Maria Souza');
  assert.equal(lead.decisor_cargo, 'Diretora');
});

test('modelo do 13º entra para quem já tinha os modelos antigos', async () => {
  const t = await base();
  await t.db.ModeloComercial.create({ nome: 'Apresentação dos serviços', assunto: 'x', corpo: 'y', ativo: true });
  const m = await t.ok(S, 'listarModelosComerciais');
  const treze = m.find((x) => /13º/.test(x.nome));
  assert.ok(treze);
  assert.equal(m.length, 3, 'só entram os modelos novos (13º e Piloto Sem Risco); não recria os outros');
  assert.ok(m.some((x) => x.nome === 'Piloto Sem Risco'));
  const p = await t.ok(S, 'previaEmailComercial', { modelo_id: treze.id, empresa: 'Escola A' });
  assert.match(p.html, /dezembro é o mês em que mais se recupera/);
  assert.equal((p.html.match(/contato@acorly\.com\.br/g) || []).length, 1);
});

test('cadência: abordagem agenda follow-ups nos dias 3, 7 e 14; e-mail de retorno conta; aviso diário', async () => {
  const t = await base();
  const [modelo] = await t.ok(S, 'listarModelosComerciais');
  await t.ok(S, 'enviarEmailComercial', { para: 'contato@escolab.com.br', empresa: 'Escola B', modelo_id: modelo.id });
  let l = await lead1(t);
  assert.equal(l.cadencia_inicio, '2026-11-11');
  assert.equal(l.proximo_followup, '2026-11-14');
  assert.equal((await t.ok(S, 'listarLeads', { filtros: { followup: 'HOJE' } })).total, 0);
  dia(t, 3);
  const lista = await t.ok(S, 'listarLeads', { filtros: { followup: 'HOJE' } });
  assert.equal(lista.total, 1);
  assert.equal(lista.followups_hoje, 1);
  assert.equal(await avisoFollowups(sys(t)), 1);
  assert.equal(await avisoFollowups(sys(t)), 0, 'avisa uma vez por dia');
  assert.ok((await t.db.Notificacao.filter({})).some((n) => /1 follow-up\(s\) para hoje/.test(n.titulo)));
  // follow-up 1 por e-mail (retorno)
  await t.ok(S, 'enviarEmailComercial', { lead_id: l.id, para: l.email, modelo_id: modelo.id });
  l = await lead1(t);
  assert.equal(l.cadencia_etapa, 1);
  assert.equal(l.proximo_followup, '2026-11-18');
  // follow-up 2 por WhatsApp: precisa de número
  await t.falha(S, 'whatsappLead', { id: l.id }, 422);
  await t.ok(S, 'atualizarLead', { id: l.id, decisor_nome: 'Carlos Lima', decisor_cargo: 'Mantenedor', decisor_contato: '(71) 98888-7777' });
  dia(t, 7);
  const w = await t.ok(S, 'whatsappLead', { id: l.id });
  assert.match(w.link, /^https:\/\/wa\.me\/5571988887777\?text=/);
  assert.match(w.mensagem, /^Olá, Carlos!.*13º/);
  await t.ok(S, 'registrarFollowupLead', { id: l.id, canal: 'WHATSAPP', observacao: 'Visualizou' });
  l = await lead1(t);
  assert.equal(l.proximo_followup, '2026-11-25');
  assert.match(l.observacoes, /follow-up 2 \(Algo útil\) por WhatsApp — Visualizou/);
  dia(t, 14);
  assert.match((await t.ok(S, 'whatsappLead', { id: l.id })).mensagem, /Vou encerrar por aqui/);
  await t.ok(S, 'registrarFollowupLead', { id: l.id, canal: 'TELEFONE' });
  l = await lead1(t);
  assert.equal(l.proximo_followup, null);
  assert.equal(l.cadencia_fim, 'Concluída sem resposta');
  await t.falha(S, 'registrarFollowupLead', { id: l.id }, 422);
});

test('cadência para quando o contato responde ou muda de situação', async () => {
  const t = await base();
  const [modelo] = await t.ok(S, 'listarModelosComerciais');
  await t.ok(S, 'enviarEmailComercial', { para: 'contato@escolac.com.br', empresa: 'Escola C', modelo_id: modelo.id });
  let l = await lead1(t);
  await t.ok(S, 'atualizarLead', { id: l.id, status: 'DIAGNOSTICO_ENVIADO' });
  l = await lead1(t);
  assert.equal(l.proximo_followup, null);
  await t.ok(S, 'atualizarLead', { id: l.id, status: 'EM_CONTATO' });
  await t.ok(S, 'iniciarCadenciaLead', { id: l.id });
  await t.ok(S, 'encerrarCadenciaLead', { id: l.id, motivo: 'Respondeu: vai pensar' });
  l = await lead1(t);
  assert.equal(l.proximo_followup, null);
  assert.match(l.observacoes, /cadência encerrada — Respondeu: vai pensar/);
});

test('indicação: parceiro com link próprio; pedido pelo link fica vinculado; comissão registrada', async () => {
  const t = await base();
  const p = await t.ok(S, 'salvarParceiro', { nome: 'Ana Contadora', empresa: 'Contábil Ária Ltda', email: 'ana@aria.com.br', whatsapp: '71999998888' });
  assert.equal(p.codigo, 'contabil-aria-ltda');
  assert.match(p.regra_comissao, /10%/);
  await t.falha(S, 'salvarParceiro', { nome: 'Outro', codigo: 'Contábil Ária Ltda' }, 422);
  const [lp] = await t.ok(S, 'listarParceiros');
  assert.equal(lp.link, 'https://acorly.com.br/diagnostico?ref=contabil-aria-ltda');
  assert.match(lp.texto_divulgacao, /diagnostico\?ref=contabil-aria-ltda/);
  const ctx = { ...sys(t), aposConfirmar: null };
  const r = await registrarLead(ctx, { nome: 'João', empresa: 'Clínica Sorriso', email: 'joao@sorriso.com.br', aceite_privacidade: true, ref: 'contabil-aria-ltda' });
  const [lead] = await t.db.Lead.filter({ id: r.id });
  assert.equal(lead.parceiro_id, p.id);
  assert.equal(lead.origem, 'INDICACAO:contabil-aria-ltda');
  assert.ok((await t.db.Notificacao.filter({})).some((n) => /indicado por Ana Contadora/.test(n.titulo)));
  const semRef = await registrarLead(ctx, { nome: 'Zé', empresa: 'Loja Z', email: 'ze@lojaz.com.br', aceite_privacidade: true, ref: 'nao-existe' });
  assert.equal((await t.db.Lead.filter({ id: semRef.id }))[0].parceiro_id, null);
  await t.ok(S, 'atualizarLead', { id: lead.id, status: 'CONVERTIDO' });
  await t.ok(S, 'registrarPagamentoParceiro', { parceiro_id: p.id, lead_id: lead.id, valor: '150,00', pago_em: '2026-12-10', descricao: 'Comissão nov/2026' });
  await t.falha(S, 'registrarPagamentoParceiro', { parceiro_id: p.id, lead_id: semRef.id, valor: '10', pago_em: '2026-12-10' }, 422);
  const [resumo] = await t.ok(S, 'listarParceiros');
  assert.deepEqual([resumo.indicados, resumo.convertidos, resumo.pago_centavos], [1, 1, 15000]);
  const ind = await t.ok(S, 'indicacoesDoParceiro', { id: p.id });
  assert.equal(ind.leads[0].empresa, 'Clínica Sorriso');
  // parceiro inativo não vincula mais
  await t.ok(S, 'salvarParceiro', { ...p, status: 'INATIVO' });
  const depois = await registrarLead(ctx, { nome: 'Lu', empresa: 'Academia L', email: 'lu@academial.com.br', aceite_privacidade: true, ref: 'contabil-aria-ltda' });
  assert.equal((await t.db.Lead.filter({ id: depois.id }))[0].parceiro_id, null);
});
