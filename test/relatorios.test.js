import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario, casosHS } from './helpers.js';

test('indicadores separam confirmado, informado, negociado e saldo pendente; isolados por empresa', async () => {
  const t = await cenario();
  const { A, B } = t.empresas;
  const [c1, c2] = await casosHS(t, 'A', [0, 1]);
  for (const c of [c1, c2]) await t.ok('op1@hs.com', 'registrarInteracao', { caso_id: c.id, canal: 'WHATSAPP', tipo_interacao: 'MENSAGEM_ENVIADA', mensagem: 'Olá' });
  const p1 = await t.ok('op1@hs.com', 'informarPagamento', { caso_id: c1.id, valor_centavos: 25000, data_informada: '2026-11-10' });
  await t.ok(A.fin, 'confirmarPagamento', { pagamento_id: p1.id });
  await t.ok('op1@hs.com', 'informarPagamento', { caso_id: c1.id, valor_centavos: 5000, data_informada: '2026-11-11' });
  await t.ok('op1@hs.com', 'proporNegociacao', { caso_id: c2.id, desconto_bps: 2500, entrada_centavos: 0, quantidade_parcelas: 3, primeira_data_vencimento: '2026-12-01' });

  const dA = (await t.ok(A.adm, 'dashboardEmpresa', {})).financeiro;
  assert.equal(dA.valor_original_centavos, 300000);
  assert.equal(dA.valor_recuperado_confirmado_centavos, 25000);
  assert.equal(dA.valor_informado_pago_centavos, 5000);
  assert.equal(dA.valor_em_negociacao_centavos, 75000);
  assert.equal(dA.saldo_pendente_centavos, 275000);
  assert.equal(dA.valor_encaminhado_hs_centavos, 175000);
  assert.equal(dA.taxa_recuperacao_bps, 833);
  const dB = (await t.ok(B.adm, 'dashboardEmpresa', {})).financeiro;
  assert.equal(dB.valor_recuperado_confirmado_centavos, 0);
  assert.equal(dB.saldo_pendente_centavos, 300000);
  // filtros
  const soHS = (await t.ok(A.adm, 'dashboardEmpresa', { filtros: { modalidade: 'AUTOCONTRATADA' } })).financeiro;
  assert.equal(soHS.valor_original_centavos, 100000);

  const hs = await t.ok('super@hs.com', 'dashboardHS', {});
  assert.equal(hs.empresas_ativas, 2);
  assert.equal(hs.empresas_cobranca_gerenciada, 2);
  assert.equal(hs.valor_recuperado_confirmado_centavos, 25000);
  assert.equal(hs.valor_informado_pago_centavos, 5000);
  assert.equal(hs.casos_em_negociacao, 1);
  assert.equal(hs.produtividade_mensal.find((p) => p.nome === 'Op1').interacoes, 2);
  const hsB = await t.ok('gestor@hs.com', 'dashboardHS', { filtros: { empresa_id: B.empresa.id } });
  assert.equal(hsB.valor_recuperado_confirmado_centavos, 0);
  await t.falha('op1@hs.com', 'dashboardHS', {}, 403);
  await t.falha(A.adm, 'dashboardHS', {}, 403);
});

test('prestação de contas por contrato/período e exportação CSV com escopo', async () => {
  const t = await cenario();
  const { A, B } = t.empresas;
  const [c1] = await casosHS(t, 'A', [0]);
  await t.ok('op1@hs.com', 'registrarInteracao', { caso_id: c1.id, canal: 'WHATSAPP', tipo_interacao: 'MENSAGEM_ENVIADA', mensagem: 'Olá' });
  await t.ok('op1@hs.com', 'registrarInteracao', { caso_id: c1.id, canal: 'WHATSAPP', tipo_interacao: 'RESPOSTA_DEVEDOR', resposta: 'Vou pagar', resultado: 'RESPONDEU' });
  const p = await t.ok('op1@hs.com', 'informarPagamento', { caso_id: c1.id, valor_centavos: 100000, data_informada: '2026-11-11' });
  await t.ok(A.fin, 'confirmarPagamento', { pagamento_id: p.id });
  const pc = await t.ok('gestor@hs.com', 'gerarPrestacaoContas', { contrato_servico_id: A.contrato.id, periodo_inicio: '2026-11-01', periodo_fim: '2026-11-30' });
  const rel = JSON.parse(pc.relatorio);
  assert.equal(rel.casos_recebidos, 1);
  assert.equal(rel.contatos_realizados, 2);
  assert.equal(rel.respostas_recebidas, 1);
  assert.equal(rel.pagamentos_confirmados, 1);
  assert.equal(rel.valor_recuperado_centavos, 100000);
  await t.falha(B.adm, 'gerarPrestacaoContas', { contrato_servico_id: A.contrato.id, periodo_inicio: '2026-11-01', periodo_fim: '2026-11-30' }, 404);
  const own = await t.ok(A.adm, 'listarPrestacoes', {});
  assert.equal(own.length, 1);
  assert.equal((await t.ok(B.adm, 'listarPrestacoes', {})).length, 0);
  const csv = await t.ok(A.fin, 'exportarCSV', { tipo: 'pagamentos' });
  assert.match(csv.conteudo, /CONFIRMADO/);
  assert.equal(csv.conteudo.trim().split('\r\n').length, 2);
  const csvB = await t.ok(B.adm, 'exportarCSV', { tipo: 'pagamentos' });
  assert.equal(csvB.conteudo.trim().split('\r\n').length, 1);
  await t.falha(A.vis, 'exportarCSV', { tipo: 'dividas' }, 403);
  await t.falha('op1@hs.com', 'exportarCSV', { tipo: 'dividas' }, 403);
});
