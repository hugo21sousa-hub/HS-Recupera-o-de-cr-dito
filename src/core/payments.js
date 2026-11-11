import { ValidationError, assertCentavos } from './money.js';
import { parseDataISO } from './dates.js';

export const STATUS_PAGAMENTO = ['INFORMADO', 'EM_CONFIRMACAO', 'CONFIRMADO', 'REJEITADO'];

/** Impede registro duplicado do mesmo pagamento informado (ignora os rejeitados). */
export function detectarDuplicidade(novo, existentes) {
  const ativos = existentes.filter((p) => p.status_confirmacao !== 'REJEITADO');
  if (novo.identificador_transacao) {
    const porId = ativos.find((p) => p.identificador_transacao === novo.identificador_transacao);
    if (porId) return porId;
  }
  return ativos.find((p) =>
    p.divida_id === novo.divida_id &&
    (p.parcela_id || null) === (novo.parcela_id || null) &&
    p.valor_centavos === novo.valor_centavos &&
    p.data_informada === novo.data_informada);
}

export function validarPagamentoInformado({ valor_centavos, data_informada }, divida) {
  assertCentavos(valor_centavos, 'valor do pagamento');
  parseDataISO(data_informada, 'data do pagamento');
  if (data_informada > new Date().toISOString().slice(0, 10)) throw new ValidationError('Data do pagamento não pode ser futura');
  if (divida.saldo_atual_centavos <= 0) throw new ValidationError('Dívida já quitada');
}

/**
 * Calcula os efeitos da confirmação. Função pura: quem chama persiste.
 * valor_confirmado pode ser menor que o informado (ex.: crédito parcial identificado).
 */
export function calcularConfirmacao({ pagamento, divida, parcela, valor_confirmado_centavos }) {
  if (pagamento.status_confirmacao === 'CONFIRMADO') throw new ValidationError('Pagamento já confirmado (duplicidade bloqueada)');
  if (pagamento.status_confirmacao === 'REJEITADO') throw new ValidationError('Pagamento rejeitado não pode ser confirmado');
  const valor = valor_confirmado_centavos ?? pagamento.valor_centavos;
  assertCentavos(valor, 'valor confirmado');
  if (valor > divida.saldo_atual_centavos) throw new ValidationError('Valor confirmado excede o saldo da dívida');
  const novoSaldoDivida = divida.saldo_atual_centavos - valor;
  const efeitos = {
    pagamento: { status_confirmacao: 'CONFIRMADO', valor_confirmado_centavos: valor },
    divida: {
      saldo_atual_centavos: novoSaldoDivida,
      status_financeiro: novoSaldoDivida === 0 ? 'QUITADA' : 'PARCIALMENTE_PAGA',
    },
    parcela: null,
    quitada: novoSaldoDivida === 0,
  };
  if (parcela) {
    if (valor > parcela.saldo_centavos) throw new ValidationError('Valor confirmado excede o saldo da parcela');
    const s = parcela.saldo_centavos - valor;
    efeitos.parcela = { saldo_centavos: s, status: s === 0 ? 'PAGA' : 'PARCIALMENTE_PAGA' };
  }
  return efeitos;
}

export function statusCasoAposConfirmacao(quitada) {
  return quitada ? 'RECUPERADO_INTEGRALMENTE' : 'PARCIALMENTE_RECUPERADO';
}
