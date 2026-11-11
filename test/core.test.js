import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReais, formatBRL, dividirEmParcelas, aplicarPercentual, taxaBps } from '../src/core/money.js';
import { cpfValido, cnpjValido } from '../src/core/documento.js';
import { simular, verificarAlcada } from '../src/core/negotiation.js';
import { transicao, podeTransitar } from '../src/core/caseStatus.js';
import { validarCarteira } from '../src/core/portfolio.js';
import { parseCSV, normalizarLinhasImportacao } from '../src/core/csvImport.js';
import { verificarMensagem } from '../src/core/compliance.js';
import { dashboardFinanceiro, toCSV } from '../src/core/reports.js';
import { calcularConfirmacao, detectarDuplicidade } from '../src/core/payments.js';
import { addMeses } from '../src/core/dates.js';
import { cpf, cnpj } from './helpers.js';

test('dinheiro em centavos sem erro de ponto flutuante', () => {
  assert.equal(parseReais('1.234,56'), 123456);
  assert.equal(parseReais('R$ 0,10'), 10);
  assert.equal(parseReais(0.1 + 0.2), 30);
  assert.equal(parseReais('1234.5'), 123450);
  assert.throws(() => parseReais('12,345'));
  assert.equal(formatBRL(123456789), 'R$ 1.234.567,89');
  assert.deepEqual(dividirEmParcelas(100000, 3), [33333, 33333, 33334]);
  assert.equal(dividirEmParcelas(100001, 7).reduce((a, b) => a + b), 100001);
  assert.equal(aplicarPercentual(99999, 1550), 15500); // 15,5% de 999,99 = 154,998 → 155,00
  assert.equal(taxaBps(1, 3), 3333);
});

test('CPF/CNPJ com dígito verificador', () => {
  assert.ok(cpfValido(cpf(5)));
  assert.ok(!cpfValido('11111111111'));
  assert.ok(!cpfValido('12345678900'));
  assert.ok(cnpjValido(cnpj(3)));
  assert.ok(cnpjValido('11.222.333/0001-81'));
  assert.ok(!cnpjValido('11222333000180'));
});

test('simulador de negociação calcula valores e respeita alçada', () => {
  const s = simular({ saldo_centavos: 100000, desconto_bps: 2000, entrada_centavos: 10000, quantidade_parcelas: 3, primeira_data_vencimento: '2026-01-31' });
  assert.equal(s.valor_proposto_centavos, 80000);
  assert.deepEqual(s.parcelas.map((p) => p.valor_centavos), [23333, 23333, 23334]);
  assert.deepEqual(s.parcelas.map((p) => p.vencimento), ['2026-01-31', '2026-02-28', '2026-03-31']);
  const aut = { status: 'ATIVA', limite_desconto_bps: 3000, limite_parcelamento: 6, entrada_minima_bps: 1000 };
  assert.equal(verificarAlcada(s, aut).dentro_alcada, true);
  const fora = simular({ saldo_centavos: 100000, desconto_bps: 5000, entrada_centavos: 0, quantidade_parcelas: 10, primeira_data_vencimento: '2026-01-10' });
  const r = verificarAlcada(fora, aut);
  assert.equal(r.dentro_alcada, false);
  assert.equal(r.violacoes.length, 3);
  assert.throws(() => simular({ saldo_centavos: 1000, entrada_centavos: 2000 }));
  assert.equal(addMeses('2026-12-31', 2), '2027-02-28');
});

test('transições de status controladas', () => {
  assert.ok(podeTransitar('AGUARDANDO_OPERADOR', 'ATRIBUIDO'));
  assert.ok(!podeTransitar('AGUARDANDO_VALIDACAO', 'EM_NEGOCIACAO'));
  assert.ok(!podeTransitar('RECUPERADO_INTEGRALMENTE', 'EM_CONTATO'));
  assert.throws(() => transicao({ status_operacional: 'EM_CONTATO' }, 'SUSPENSO'), /Motivo/);
  const p = transicao({ status_operacional: 'EM_CONTATO' }, 'SUSPENSO', { motivo: 'x' });
  assert.equal(p.status_anterior, 'EM_CONTATO');
  const r = transicao({ status_operacional: 'SUSPENSO', status_anterior: 'EM_CONTATO' }, 'REATIVAR', { motivo: 'ok' });
  assert.equal(r.status_operacional, 'EM_CONTATO');
});

test('validação de carteira: obrigatórios, duplicidade, documentação, não vencida', () => {
  const dev = { id: 'd1', nome: 'A', tipo_pessoa: 'PF', cpf_cnpj: cpf(1), whatsapp: '11999998888' };
  const base = { valor_original_centavos: 1000, saldo_atual_centavos: 1000, data_vencimento: '2026-01-01', documento_referencia: 'X', status_financeiro: 'EM_ABERTO' };
  const r = validarCarteira([
    { divida: { ...base, id: 'v1' }, devedor: dev, documentos: [1] },
    { divida: { ...base, id: 'v2' }, devedor: dev, documentos: [1] },
    { divida: { ...base, id: 'v3', documento_referencia: 'Y' }, devedor: dev, documentos: [] },
    { divida: { ...base, id: 'v4', documento_referencia: 'Z', data_vencimento: '2027-01-01' }, devedor: dev, documentos: [1] },
    { divida: { ...base, id: 'v5', documento_referencia: 'W' }, devedor: { ...dev, cpf_cnpj: '123', nao_contatar: true }, documentos: [1] },
  ], { hoje: '2026-11-11' });
  const by = Object.fromEntries(r.itens.map((i) => [i.divida_id, i]));
  assert.ok(by.v1.elegivel);
  assert.match(by.v2.problemas.join(), /duplicidade/);
  assert.match(by.v3.pendencias.join(), /documentação/);
  assert.match(by.v4.problemas.join(), /não vencida/);
  assert.equal(by.v5.problemas.length + by.v5.pendencias.length, 2);
  assert.equal(r.resumo.elegiveis, 1);
  assert.equal(r.resumo.valor_total_centavos, 5000);
  assert.equal(r.resumo.valor_vencido_centavos, 4000);
});

test('importação CSV com aspas, ; e datas BR', () => {
  const csv = '﻿Nome;CPF_CNPJ;Valor Original;Data Vencimento;Descrição\n"Silva; João";' + cpf(9) + ';"1.500,00";10/05/2026;"Plano ""Ouro"""\nMaria;123;abc;31/02/2026;x\n';
  const linhas = normalizarLinhasImportacao(parseCSV(csv));
  assert.equal(linhas[0].devedor.nome, 'Silva; João');
  assert.equal(linhas[0].divida.valor_original_centavos, 150000);
  assert.equal(linhas[0].divida.data_vencimento, '2026-05-10');
  assert.equal(linhas[0].divida.descricao, 'Plano "Ouro"');
  assert.equal(linhas[0].erros.length, 0);
  assert.equal(linhas[1].erros.length, 3);
});

test('bloqueio de mensagens abusivas', () => {
  assert.ok(verificarMensagem('Olá, João. Temos uma proposta para regularizar seu débito.'));
  assert.throws(() => verificarMensagem('Pague ou vamos falar com seu chefe'));
  assert.throws(() => verificarMensagem('Você pode ser preso'));
});

test('dashboard: só pagamento CONFIRMADO conta como recuperado', () => {
  const d = dashboardFinanceiro({
    hoje: '2026-11-11',
    dividas: [{ valor_original_centavos: 10000, saldo_atual_centavos: 7000, data_vencimento: '2026-01-01', modalidade_cobranca: 'HS_GERENCIADA', status_financeiro: 'PARCIALMENTE_PAGA' }],
    negociacoes: [{ status: 'AGUARDANDO_APROVACAO_CREDOR', valor_proposto_centavos: 6000 }],
    acordos: [{ status: 'ATIVO', valor_acordado_centavos: 6500 }],
    pagamentos: [{ status_confirmacao: 'CONFIRMADO', valor_centavos: 3000, valor_confirmado_centavos: 3000 }, { status_confirmacao: 'INFORMADO', valor_centavos: 2000 }, { status_confirmacao: 'REJEITADO', valor_centavos: 9000 }],
  });
  assert.equal(d.valor_recuperado_confirmado_centavos, 3000);
  assert.equal(d.valor_informado_pago_centavos, 2000);
  assert.equal(d.valor_em_negociacao_centavos, 6000);
  assert.equal(d.valor_acordos_centavos, 6500);
  assert.equal(d.saldo_pendente_centavos, 7000);
  assert.equal(d.taxa_recuperacao_bps, 3000);
});

test('confirmação pura: bloqueia duplicidade e excesso', () => {
  const div = { saldo_atual_centavos: 1000 };
  assert.throws(() => calcularConfirmacao({ pagamento: { status_confirmacao: 'CONFIRMADO', valor_centavos: 100 }, divida: div }), /já confirmado/);
  assert.throws(() => calcularConfirmacao({ pagamento: { status_confirmacao: 'INFORMADO', valor_centavos: 2000 }, divida: div }), /excede/);
  const r = calcularConfirmacao({ pagamento: { status_confirmacao: 'INFORMADO', valor_centavos: 1000 }, divida: div });
  assert.equal(r.quitada, true);
  assert.ok(detectarDuplicidade({ divida_id: 'a', valor_centavos: 1, data_informada: '2026-01-01' }, [{ divida_id: 'a', valor_centavos: 1, data_informada: '2026-01-01', status_confirmacao: 'INFORMADO' }]));
  assert.ok(!detectarDuplicidade({ divida_id: 'a', valor_centavos: 1, data_informada: '2026-01-01' }, [{ divida_id: 'a', valor_centavos: 1, data_informada: '2026-01-01', status_confirmacao: 'REJEITADO' }]));
});

test('CSV exportado neutraliza fórmulas', () => {
  const out = toCSV([{ a: '=HYPERLINK("x")' }], [{ titulo: 'A', campo: 'a' }]);
  assert.match(out, /'=HYPERLINK/);
});
