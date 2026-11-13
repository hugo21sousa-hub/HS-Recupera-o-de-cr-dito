import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, cenario, cnpj, AGORA, AUTORIZACAO } from './helpers.js';
import { processarWebhookAsaas } from '../src/app/actions/comercial.js';
import { rodarLembretes, lembretesMensalidade, lembretesTeste, lembretesParcelas } from '../src/app/lembretes.js';

const SISTEMA = { id: 'sistema', nome: 'Sistema', email: 'sistema', perfil: 'SISTEMA', status: 'ATIVO' };

async function base() {
  const t = app();
  await t.db.UsuarioPlataforma.create({ nome: 'Super', email: 'super@hs.com', perfil: 'SUPERADMIN_HS', empresa_id: null, status: 'ATIVO' });
  await t.ok('super@hs.com', 'seedPlanos');
  const planos = await t.ok('super@hs.com', 'listarPlanos');
  const plano = (n) => planos.find((p) => p.nome === n);
  const empresa = async (k, seed) => {
    const adm = `adm@${k}.com`;
    const { empresa: e } = await t.ok(adm, 'registrarEmpresa', { razao_social: `${k} Ltda`, nome_fantasia: k, cnpj: cnpj(seed), email: `c@${k}.com`, telefone: '11999990000', endereco: 'Rua 1', responsavel_legal: 'Resp', admin_nome: `Adm ${k}`, aceite_termos: true, aceite_privacidade: true });
    await t.ok(adm, 'escolherServico', { modalidade_servico: 'PLATAFORMA' });
    return { ...e, adm };
  };
  const sys = () => ({ db: t.db, now: () => t.estado.agora, user: SISTEMA, authEmail: 'sistema', aposConfirmar: [], ...t.estado.extras });
  return { t, plano, empresa, sys };
}

test('indicadores do negócio: assinantes, MRR, tolerância, teste grátis e receita recebida sem duplicar', async () => {
  const { t, plano, empresa, sys } = await base();
  await empresa('teste', 31);
  const b = await empresa('emdia', 32);
  await t.ok('super@hs.com', 'salvarAssinatura', { empresa_id: b.id, plano_id: plano('ACORLY ESSENCIAL').id, data_inicio: '2026-11-01', data_vencimento: '2026-12-01' });
  const c = await empresa('atrasada', 33);
  await t.ok('super@hs.com', 'salvarAssinatura', { empresa_id: c.id, plano_id: plano('ACORLY PROFISSIONAL').id, data_inicio: '2026-10-09', data_vencimento: '2026-11-09' });
  const d = await empresa('asaas', 34);
  t.estado.extras.asaas = { disponivel: true, ambiente: 'sandbox', criarCliente: async () => ({ id: 'cus_d' }), criarAssinatura: async () => ({ id: 'sub_d' }), cobrancasDaAssinatura: async () => ({ data: [] }), cancelarAssinatura: async () => {} };
  await t.ok(d.adm, 'assinarPlano', { plano_id: plano('ACORLY EMPRESARIAL').id });
  await processarWebhookAsaas(sys(), { id: 'e1', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_d1', subscription: 'sub_d', value: 159.9, dueDate: '2026-11-11' } });
  await processarWebhookAsaas(sys(), { id: 'e2', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_d1', subscription: 'sub_d', value: 159.9, dueDate: '2026-11-11' } });

  const r = await t.ok('super@hs.com', 'indicadoresNegocio');
  assert.equal(r.assinantes_ativos, 3);
  assert.equal(r.em_dia, 2);
  assert.equal(r.em_tolerancia, 1);
  assert.equal(r.em_teste, 1);
  assert.equal(r.mrr_centavos, 4990 + 15990);
  assert.equal(r.mrr_em_risco_centavos, 8990);
  assert.equal(r.recebido_mes_centavos, 15990, 'confirmado + recebido do mesmo pagamento conta uma vez');
  assert.equal(r.inadimplentes.length, 1);
  assert.equal(r.inadimplentes[0].empresa, 'atrasada');
  assert.equal(r.inadimplentes[0].situacao, 'Em tolerância');
  assert.deepEqual(r.por_plano.map((p) => [p.plano, p.empresas]), [['ACORLY ESSENCIAL', 1], ['ACORLY PROFISSIONAL', 1], ['ACORLY EMPRESARIAL', 1]]);
  assert.equal(r.meses.length, 6);
  assert.equal(r.meses[5].mes, '2026-11');
  await t.falha(b.adm, 'indicadoresNegocio', {}, 403);
});

test('lembretes à empresa: mensalidade 3 dias antes e fim do teste grátis, uma vez cada', async () => {
  const { t, plano, empresa, sys } = await base();
  const b = await empresa('pagante', 41);
  await t.ok('super@hs.com', 'salvarAssinatura', { empresa_id: b.id, plano_id: plano('ACORLY ESSENCIAL').id, data_inicio: '2026-10-14', data_vencimento: '2026-11-14' });
  assert.equal(await lembretesMensalidade(sys()), 1);
  assert.equal(await lembretesMensalidade(sys()), 0, 'não repete');
  const notifs = await t.db.Notificacao.filter({ empresa_id: b.id });
  assert.ok(notifs.some((n) => /vence em 14\/11\/2026/.test(n.titulo)));

  const nova = await empresa('nova', 42);
  t.estado.agora = new Date('2026-11-15T14:00:00Z');
  assert.equal(await lembretesTeste(sys()), 0, 'faltam 3 dias: ainda não');
  t.estado.agora = new Date('2026-11-16T14:00:00Z');
  assert.equal(await lembretesTeste(sys()), 1);
  assert.equal(await lembretesTeste(sys()), 0);
  t.estado.agora = new Date('2026-11-17T14:00:00Z');
  assert.equal(await lembretesTeste(sys()), 1);
  const titulos = (await t.db.Notificacao.filter({ empresa_id: nova.id })).map((n) => n.titulo);
  assert.ok(titulos.some((x) => /termina em 17\/11\/2026/.test(x)));
  assert.ok(titulos.some((x) => /último dia do seu teste/.test(x)));
  t.estado.agora = new Date('2026-11-17T23:30:00Z');
  assert.equal(await rodarLembretes(sys()), null, 'fora do horário comercial');
  assert.equal(AGORA.toISOString(), '2026-11-11T14:00:00.000Z');
});

test('lembrete de parcela do acordo por e-mail ao devedor: 3 dias antes e no dia, respeitando descadastro', async () => {
  const t = await cenario();
  const A = t.empresas.A;
  await t.ok(A.adm, 'encaminharParaHS', { tipo_selecao: 'DIVIDAS', divida_ids: [A.dividas[0].id], contrato_servico_id: A.contrato.id, autorizacao: { ...AUTORIZACAO, canais_autorizados: ['WHATSAPP', 'EMAIL'] }, confirmacao: true });
  const fila = await t.ok('gestor@hs.com', 'listarCasos', { escopo: 'validacao', filtros: { empresa_id: A.empresa.id } });
  await t.ok('gestor@hs.com', 'validarCaso', { caso_ids: fila.itens.map((c) => c.id), aprovado: true });
  const caso = await t.ok('gestor@hs.com', 'atribuirCaso', { caso_id: fila.itens[0].id, operador_id: t.op1.id });
  const neg = await t.ok('op1@hs.com', 'proporNegociacao', { caso_id: caso.id, desconto_bps: 1000, entrada_centavos: 15000, quantidade_parcelas: 2, primeira_data_vencimento: '2026-12-11', data_entrada: '2026-11-14' });
  await t.ok('op1@hs.com', 'formalizarAcordo', { negociacao_id: neg.id, aceite_devedor: true, meio_aceite: 'WHATSAPP', data_aceite: '2026-11-11' });
  const enviados = [];
  const email = { cobrancaDisponivel: true, paraDevedor: async (o) => { enviados.push(o); return { ok: true, id: 'm' }; } };
  const sys = () => ({ db: t.db, now: () => t.estado.agora, user: SISTEMA, authEmail: 'sistema', aposConfirmar: [], email, descadastro: { link: (id) => `https://x/descadastrar/${id}.sig` } });
  assert.equal(await lembretesParcelas({ ...sys(), email: { cobrancaDisponivel: false } }), 0, 'sem e-mail de cobrança configurado, nada é enviado');
  assert.equal(await lembretesParcelas(sys()), 1, 'entrada vence em 14/11 (3 dias)');
  assert.equal(enviados[0].nomeRemetente, 'HS Recuperação de Crédito');
  assert.equal(enviados[0].responderPara, 'op1@hs.com');
  assert.match(enviados[0].assunto, /a entrada do seu acordo com Loja A vence em 14\/11\/2026/);
  assert.match(enviados[0].texto, /diretamente à Loja A/);
  assert.equal(await lembretesParcelas(sys()), 0, 'não repete no mesmo dia');
  t.estado.agora = new Date('2026-11-14T14:00:00Z');
  assert.equal(await lembretesParcelas(sys()), 1, 'no dia do vencimento');
  assert.match(enviados[1].assunto, /vence hoje/);
  const inter = (await t.db.Interacao.filter({ caso_id: caso.id })).filter((i) => i.operador_id === 'sistema');
  assert.equal(inter.length, 2);
  await t.db.Devedor.update(caso.devedor_id, { nao_contatar_email: true });
  t.estado.agora = new Date('2026-12-08T14:00:00Z');
  assert.equal(await lembretesParcelas(sys()), 0, 'devedor descadastrado não recebe');
});

test('Asaas: avisos ao cliente só por e-mail (sem SMS, ligação ou WhatsApp)', async () => {
  const { criarAsaas } = await import('../src/server/asaas.js');
  const chamadas = [];
  const fetchImpl = async (url, op) => {
    chamadas.push({ url, metodo: op.method, corpo: op.body ? JSON.parse(op.body) : null });
    const dados = op.method === 'GET'
      ? { data: [{ id: 'n1', event: 'PAYMENT_DUEDATE_WARNING', scheduleOffset: 10, enabled: true, emailEnabledForCustomer: true, smsEnabledForCustomer: true }, { id: 'n2', event: 'PAYMENT_OVERDUE', scheduleOffset: 1, enabled: false, emailEnabledForCustomer: false, smsEnabledForCustomer: true }, { id: 'n3', event: 'SEND_LINHA_DIGITAVEL', enabled: false, emailEnabledForCustomer: false }] }
      : { ok: true };
    return { ok: true, json: async () => dados };
  };
  const a = criarAsaas({ config: { chave: 'k', base: 'https://api.test/v3', webhookToken: 't' }, fetchImpl });
  assert.equal(await a.configurarNotificacoes('cus_1'), 3);
  assert.equal(chamadas[0].url, 'https://api.test/v3/customers/cus_1/notifications');
  const lote = chamadas[1];
  assert.equal(lote.url, 'https://api.test/v3/notifications/batch');
  assert.equal(lote.corpo.customer, 'cus_1');
  const [n1, n2, n3] = lote.corpo.notifications;
  assert.deepEqual([n1.enabled, n1.emailEnabledForCustomer, n1.smsEnabledForCustomer, n1.scheduleOffset], [true, true, false, 10]);
  assert.deepEqual([n2.enabled, n2.emailEnabledForCustomer, n2.smsEnabledForCustomer], [true, true, false]);
  assert.deepEqual([n3.enabled, n3.emailEnabledForCustomer, n3.whatsappEnabledForCustomer], [false, false, false]);
});
