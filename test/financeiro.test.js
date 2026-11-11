import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario, casosHS } from './helpers.js';

test('pagamento parcial, confirmação, saldo e histórico financeiro', async () => {
  const t = await cenario();
  const { A } = t.empresas;
  const [caso] = await casosHS(t, 'A', [0]);
  await t.ok('op1@hs.com', 'registrarInteracao', { caso_id: caso.id, canal: 'WHATSAPP', tipo_interacao: 'MENSAGEM_ENVIADA', mensagem: 'Olá', resultado: 'PROMESSA_PAGAMENTO' });
  const pag = await t.ok('op1@hs.com', 'informarPagamento', { caso_id: caso.id, valor_centavos: 30000, data_informada: '2026-11-10', identificador_transacao: 'E123' });
  assert.equal(pag.status_confirmacao, 'INFORMADO');
  let d = await t.ok(A.fin, 'detalheDivida', { divida_id: A.dividas[0].id });
  assert.equal(d.divida.saldo_atual_centavos, 100000, 'informado não reduz saldo');
  assert.equal(d.casos[0].status_operacional, 'PAGAMENTO_INFORMADO');
  const notif = await t.ok(A.fin, 'listarNotificacoes', { naoLidas: true });
  assert.ok(notif.itens.some((n) => n.tipo === 'PAGAMENTO_INFORMADO'));
  await t.ok(A.fin, 'iniciarConferencia', { pagamento_id: pag.id });
  const conf = await t.ok(A.fin, 'confirmarPagamento', { pagamento_id: pag.id, evidencia: 'Extrato 10/11' });
  assert.equal(conf.saldo_atual_centavos, 70000);
  assert.equal(conf.quitada, false);
  d = await t.ok(A.fin, 'detalheDivida', { divida_id: A.dividas[0].id });
  assert.equal(d.divida.status_financeiro, 'PARCIALMENTE_PAGA');
  assert.equal(d.casos[0].status_operacional, 'PARCIALMENTE_RECUPERADO');
  const hist = await t.ok(A.fin, 'historicoFinanceiro', { divida_id: A.dividas[0].id });
  assert.deepEqual(hist.map((l) => [l.tipo, l.saldo_posterior_centavos]), [['SALDO_INICIAL', 100000], ['PAGAMENTO_CONFIRMADO', 70000]]);
  // confirmação dupla bloqueada
  await t.falha(A.adm, 'confirmarPagamento', { pagamento_id: pag.id }, 422);
  // mesmo pagamento informado de novo (mesma transação) bloqueado
  await t.falha('op1@hs.com', 'informarPagamento', { caso_id: caso.id, valor_centavos: 30000, data_informada: '2026-11-10', identificador_transacao: 'E123' }, 422);
  await t.falha('op1@hs.com', 'informarPagamento', { caso_id: caso.id, valor_centavos: 30000, data_informada: '2026-11-10' }, 422);
  // valor maior que saldo / data futura
  await t.falha('op1@hs.com', 'informarPagamento', { caso_id: caso.id, valor_centavos: 70001, data_informada: '2026-11-10' }, 422);
  await t.falha('op1@hs.com', 'informarPagamento', { caso_id: caso.id, valor_centavos: 100, data_informada: '2026-12-10' }, 422);
});

test('rejeição de pagamento informado não altera saldo', async () => {
  const t = await cenario();
  const { A } = t.empresas;
  const [caso] = await casosHS(t, 'A', [0]);
  await t.ok('op1@hs.com', 'registrarInteracao', { caso_id: caso.id, canal: 'TELEFONE', tipo_interacao: 'LIGACAO', resultado: 'RESPONDEU' });
  const pag = await t.ok('op1@hs.com', 'informarPagamento', { caso_id: caso.id, valor_centavos: 100000, data_informada: '2026-11-09', comprovante_file_uri: 'private/comp.png' });
  await t.falha(A.fin, 'rejeitarPagamento', { pagamento_id: pag.id }, 422);
  await t.ok(A.fin, 'rejeitarPagamento', { pagamento_id: pag.id, motivo: 'Valor não identificado no extrato' });
  await t.falha(A.fin, 'confirmarPagamento', { pagamento_id: pag.id }, 422);
  const d = await t.ok(A.fin, 'detalheDivida', { divida_id: A.dividas[0].id });
  assert.equal(d.divida.saldo_atual_centavos, 100000);
  assert.equal(d.casos[0].status_operacional, 'EM_CONTATO');
  const opNotif = await t.ok('op1@hs.com', 'listarNotificacoes', {});
  assert.ok(opNotif.itens.some((n) => n.tipo === 'PAGAMENTO_REJEITADO'));
  // após rejeição, o mesmo valor/data pode ser informado novamente (não é duplicidade)
  await t.ok('op1@hs.com', 'informarPagamento', { caso_id: caso.id, valor_centavos: 100000, data_informada: '2026-11-09' });
});

test('pagamento integral quita a dívida e encerra o caso', async () => {
  const t = await cenario();
  const { A } = t.empresas;
  const [caso] = await casosHS(t, 'A', [0]);
  await t.ok('op1@hs.com', 'registrarInteracao', { caso_id: caso.id, canal: 'WHATSAPP', tipo_interacao: 'MENSAGEM_ENVIADA', mensagem: 'Olá' });
  const pag = await t.ok('op1@hs.com', 'informarPagamento', { caso_id: caso.id, valor_centavos: 100000, data_informada: '2026-11-11' });
  const r = await t.ok(A.adm, 'confirmarPagamento', { pagamento_id: pag.id });
  assert.equal(r.quitada, true);
  const d = await t.ok(A.adm, 'detalheDivida', { divida_id: A.dividas[0].id });
  assert.equal(d.divida.status_financeiro, 'QUITADA');
  assert.equal(d.casos[0].status_operacional, 'RECUPERADO_INTEGRALMENTE');
  assert.ok(d.casos[0].data_encerramento);
  await t.falha('op1@hs.com', 'detalheCaso', { caso_id: caso.id }, 404); // encerrado sai da carteira do operador
  await t.falha(A.adm, 'informarPagamento', { divida_id: A.dividas[0].id, valor_centavos: 1, data_informada: '2026-11-11' }, 422);
});

test('acordo parcelado com desconto: parcelas, cumprimento e quitação rastreável', async () => {
  const t = await cenario();
  const { A } = t.empresas;
  const [caso] = await casosHS(t, 'A', [0]);
  const neg = await t.ok('op1@hs.com', 'proporNegociacao', { caso_id: caso.id, desconto_bps: 1000, entrada_centavos: 30000, quantidade_parcelas: 2, primeira_data_vencimento: '2026-12-10', data_entrada: '2026-11-11' });
  await t.ok('op1@hs.com', 'formalizarAcordo', { negociacao_id: neg.id, aceite_devedor: true });
  const parcelas = (await t.ok(A.adm, 'listarParcelas', { filtros: { divida_id: A.dividas[0].id } })).itens;
  assert.deepEqual(parcelas.map((p) => p.valor_original_centavos), [30000, 30000, 30000]);
  for (const p of parcelas) {
    const pag = await t.ok('op1@hs.com', 'informarPagamento', { caso_id: caso.id, parcela_id: p.id, valor_centavos: p.valor_original_centavos, data_informada: '2026-11-11', identificador_transacao: 'T' + p.numero });
    assert.equal(pag.acordo_id, p.acordo_id);
    await t.ok(A.fin, 'confirmarPagamento', { pagamento_id: pag.id });
  }
  const d = await t.ok(A.adm, 'detalheDivida', { divida_id: A.dividas[0].id });
  assert.equal(d.divida.saldo_atual_centavos, 0);
  assert.equal(d.divida.status_financeiro, 'QUITADA');
  assert.equal(d.casos[0].status_operacional, 'RECUPERADO_INTEGRALMENTE');
  const tipos = d.lancamentos.map((l) => l.tipo);
  assert.deepEqual(tipos.filter((x) => x === 'PAGAMENTO_CONFIRMADO').length, 3);
  const desconto = d.lancamentos.find((l) => l.tipo === 'DESCONTO_ACORDO');
  assert.equal(desconto.valor_centavos, -10000);
  const acordos = await t.ok(A.adm, 'listarAcordos', {});
  assert.equal(acordos.itens[0].status, 'CUMPRIDO');
  const dash = await t.ok(A.adm, 'dashboardEmpresa', {});
  assert.equal(dash.financeiro.valor_recuperado_confirmado_centavos, 90000, 'desconto não conta como recuperado');
});

test('cobrança própria: empresa registra e confirma pagamento sem HS', async () => {
  const t = await cenario();
  const { B } = t.empresas;
  const caso = await t.ok(B.adm, 'abrirCobrancaPropria', { divida_id: B.dividas[1].id });
  assert.equal(caso.modalidade_cobranca, 'AUTOCONTRATADA');
  await t.ok(B.adm, 'registrarInteracao', { caso_id: caso.id, canal: 'EMAIL', tipo_interacao: 'MENSAGEM_ENVIADA', mensagem: 'Lembrete de pagamento' });
  const r = await t.ok(B.fin, 'informarPagamento', { divida_id: B.dividas[1].id, valor_centavos: 40000, data_informada: '2026-11-05', confirmar_agora: true });
  assert.equal(r.saldo_atual_centavos, 60000);
  const casos = await t.ok(B.adm, 'listarCasos', {});
  assert.equal(casos.itens[0].status_operacional, 'PARCIALMENTE_RECUPERADO');
});
