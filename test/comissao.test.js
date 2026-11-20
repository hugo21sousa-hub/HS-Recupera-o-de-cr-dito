import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TABELA_PADRAO, faixaPara, validarFaixas, rotuloFaixa, calcularComissao } from '../src/core/comissao.js';
import { cenario, casosHS, AUTORIZACAO } from './helpers.js';

test('faixas de comissão: seleção, rótulos e validação', () => {
  assert.deepEqual(faixaPara(0), { bps: 1000, faixa: 'até 90 dias', indice: 0 });
  assert.equal(faixaPara(90).bps, 1000);
  assert.equal(faixaPara(91).bps, 1500);
  assert.equal(faixaPara(180).faixa, '91 a 180 dias');
  assert.equal(faixaPara(365).bps, 2000);
  assert.deepEqual(faixaPara(366), { bps: 2500, faixa: 'acima de 365 dias', indice: 3 });
  assert.equal(rotuloFaixa(TABELA_PADRAO, 2), '181 a 365 dias');
  assert.equal(calcularComissao(30000, 1500), 4500);
  assert.equal(calcularComissao(33333, 1500), 5000); // arredondamento ao centavo
  assert.throws(() => validarFaixas([{ ate_dias: 90, bps: 1000 }, { ate_dias: 60, bps: 1500 }, { ate_dias: null, bps: 2000 }]), /crescentes/);
  assert.throws(() => validarFaixas([{ ate_dias: 90, bps: 1000 }]), /última faixa/);
  assert.throws(() => validarFaixas([{ ate_dias: null, bps: 12000 }]), /100%/);
  assert.deepEqual(validarFaixas([{ ate_dias: null, bps: 1200 }]), [{ ate_dias: null, bps: 1200 }]);
});

test('cliente vê a comissão antes de encaminhar; ela fica fixada no caso e é calculada só sobre o que foi recebido', async () => {
  const t = await cenario();
  const { A } = t.empresas;
  // dívidas do cenário vencem em 10/08/2026; hoje (cenário) = 11/11/2026 → 93 dias → faixa 91 a 180 dias = 15%
  const previa = await t.ok(A.adm, 'comissaoDivida', { divida_id: A.dividas[0].id });
  assert.equal(previa.dias_atraso, 93);
  assert.equal(previa.comissao_bps, 1500);
  assert.equal(previa.comissao_faixa, '91 a 180 dias');
  assert.equal(previa.estimativa_centavos, 15000);
  assert.equal(previa.tabela.length, 4);
  const conf = await t.ok(A.adm, 'previewEncaminhamento', { tipo_selecao: 'DIVIDAS', divida_ids: [A.dividas[0].id], contrato_servico_id: A.contrato.id });
  assert.equal(conf.itens[0].comissao_bps, 1500);
  assert.equal(conf.resumo.comissao_estimada_elegiveis_centavos, 15000);
  const [caso] = await casosHS(t, 'A', [0]);
  assert.equal(caso.comissao_bps, 1500);
  assert.equal(caso.dias_atraso_no_envio, 93);
  // depois de encaminhada, a tela da dívida mostra a comissão fixada
  assert.equal((await t.ok(A.adm, 'comissaoDivida', { divida_id: A.dividas[0].id })).ja_encaminhada, true);
  // pagamento parcial de R$ 300,00 → comissão de R$ 45,00
  await t.ok('op1@hs.com', 'registrarInteracao', { caso_id: caso.id, canal: 'WHATSAPP', tipo_interacao: 'MENSAGEM_ENVIADA', mensagem: 'Olá' });
  const pag = await t.ok('op1@hs.com', 'informarPagamento', { caso_id: caso.id, valor_centavos: 30000, data_informada: '2026-11-10' });
  const r = await t.ok(A.fin, 'confirmarPagamento', { pagamento_id: pag.id, valor_confirmado_centavos: 30000 });
  assert.equal(r.comissao_hs_centavos, 4500);
  const dash = (await t.ok(A.adm, 'dashboardEmpresa', {})).financeiro;
  assert.equal(dash.comissao_hs_centavos, 4500);
  const pc = await t.ok('gestor@hs.com', 'gerarPrestacaoContas', { contrato_servico_id: A.contrato.id, periodo_inicio: '2026-11-01', periodo_fim: '2026-11-30' });
  const rel = JSON.parse(pc.relatorio);
  assert.equal(rel.comissao_hs_centavos, 4500);
  assert.equal(rel.comissoes[0].comissao_centavos, 4500);
  // cobrança própria (sem HS): sem comissão
  const proprio = await t.ok(A.adm, 'abrirCobrancaPropria', { divida_id: A.dividas[2].id });
  const r2 = await t.ok(A.adm, 'informarPagamento', { divida_id: A.dividas[2].id, valor_centavos: 10000, data_informada: '2026-11-10', confirmar_agora: true });
  assert.equal(r2.comissao_hs_centavos, 0);
  assert.ok(proprio.id);
});

test('superadmin define a tabela padrão; contrato pode ter tabela própria; empresa vê a do seu contrato', async () => {
  const t = await cenario();
  const { A, B } = t.empresas;
  await t.falha(A.adm, 'salvarTabelaComissao', { faixas: [{ ate_dias: null, bps: 100 }] }, 403);
  await t.falha('gestor@hs.com', 'salvarTabelaComissao', { faixas: [{ ate_dias: null, bps: 100 }] }, 403);
  await t.ok('super@hs.com', 'salvarTabelaComissao', { faixas: [{ ate_dias: 60, bps: 800 }, { ate_dias: null, bps: 1800 }] });
  // contratos já existentes do cenário foram criados com a tabela de fábrica "congelada"
  assert.equal((await t.ok(A.adm, 'obterTabelaComissao')).faixas[1].bps, 1500);
  // novo contrato de B com tabela própria
  const c = await t.ok('super@hs.com', 'salvarContrato', { empresa_id: B.empresa.id, modalidade: 'PACOTE_CASOS', quantidade_casos_contratada: 50, valor_contratado_centavos: 0, data_inicio: '2026-11-11', comissao_faixas: [{ ate_dias: null, bps: 1200 }] });
  await t.ok(B.adm, 'encerrarContrato', { contrato_id: B.contrato.id, motivo: 'troca' });
  await t.ok(B.adm, 'aceitarContrato', { contrato_id: c.id, aceite: true });
  const tb = await t.ok(B.adm, 'obterTabelaComissao');
  assert.equal(tb.origem, 'CONTRATO');
  assert.deepEqual(tb.faixas.map((f) => f.bps), [1200]);
  assert.equal((await t.ok(B.adm, 'comissaoDivida', { divida_id: B.dividas[0].id })).comissao_bps, 1200);
  await t.ok(B.adm, 'encaminharParaHS', { tipo_selecao: 'DIVIDAS', divida_ids: [B.dividas[0].id], contrato_servico_id: c.id, autorizacao: AUTORIZACAO, confirmacao: true });
  const casos = await t.ok(B.adm, 'listarCasos', { filtros: { modalidade_cobranca: 'HS_GERENCIADA' } });
  assert.equal(casos.itens[0].comissao_bps, 1200);
  // proposta nova sem tabela própria usa a padrão atual (8% / 18%)
  const c2 = await t.ok('super@hs.com', 'salvarContrato', { empresa_id: A.empresa.id, modalidade: 'CARTEIRA_ESPECIFICA', valor_contratado_centavos: 0, data_inicio: '2026-11-11' });
  assert.deepEqual(c2.comissao_faixas.map((f) => f.bps), [800, 1800]);
  await t.falha('super@hs.com', 'salvarContrato', { empresa_id: A.empresa.id, modalidade: 'CARTEIRA_ESPECIFICA', valor_contratado_centavos: 0, data_inicio: '2026-11-11', comissao_faixas: [{ ate_dias: 30, bps: 500 }] }, 422);
});

test('casos encaminhados antes da tabela: comissão pela data do encaminhamento, gravada no caso', async () => {
  const t = await cenario();
  const { A } = t.empresas;
  const [caso] = await casosHS(t, 'A', [0]);
  // simula caso antigo, sem comissão gravada, encaminhado em 05/10/2026 (56 dias de atraso → 10%)
  await t.db.CasoCobranca.update(caso.id, { comissao_bps: null, comissao_faixa: null, dias_atraso_no_envio: null, data_recebimento: '2026-10-05T12:00:00.000Z' });
  const c = await t.ok(A.adm, 'comissaoDivida', { divida_id: A.dividas[0].id });
  assert.equal(c.ja_encaminhada, true);
  assert.equal(c.comissao_bps, 1000);
  assert.equal(c.dias_atraso, 56);
  assert.equal((await t.db.CasoCobranca.filter({ id: caso.id }))[0].comissao_bps, 1000, 'gravado no caso');
});
