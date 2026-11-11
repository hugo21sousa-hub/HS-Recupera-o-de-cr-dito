import { ValidationError, assertCentavos, aplicarPercentual, dividirEmParcelas } from './money.js';
import { parseDataISO, addMeses } from './dates.js';

/**
 * Simulador de negociação. Entradas em centavos e bps.
 * desconto_bps aplica-se sobre o saldo atualizado (nunca altera valor original da dívida).
 */
export function simular({ saldo_centavos, desconto_bps = 0, entrada_centavos = 0, quantidade_parcelas = 0, primeira_data_vencimento }) {
  assertCentavos(saldo_centavos, 'saldo');
  assertCentavos(entrada_centavos, 'entrada', { allowZero: true });
  if (!Number.isSafeInteger(quantidade_parcelas) || quantidade_parcelas < 0) throw new ValidationError('Quantidade de parcelas inválida');
  const desconto_centavos = aplicarPercentual(saldo_centavos, desconto_bps);
  const valor_proposto_centavos = saldo_centavos - desconto_centavos;
  if (valor_proposto_centavos <= 0) throw new ValidationError('Valor proposto deve ser maior que zero');
  if (entrada_centavos > valor_proposto_centavos) throw new ValidationError('Entrada maior que o valor proposto');
  const restante = valor_proposto_centavos - entrada_centavos;
  if (restante > 0 && quantidade_parcelas === 0) throw new ValidationError('Informe parcelas para o saldo restante ou entrada igual ao total');
  if (restante === 0 && quantidade_parcelas > 0) throw new ValidationError('Não há saldo para parcelar');
  let parcelas = [];
  if (quantidade_parcelas > 0) {
    parseDataISO(primeira_data_vencimento, 'primeira_data_vencimento');
    parcelas = dividirEmParcelas(restante, quantidade_parcelas).map((valor, i) => ({
      numero: i + 1,
      valor_centavos: valor,
      vencimento: addMeses(primeira_data_vencimento, i),
    }));
  }
  return {
    saldo_centavos,
    desconto_bps,
    desconto_centavos,
    valor_proposto_centavos,
    entrada_centavos,
    quantidade_parcelas,
    valor_parcela_centavos: parcelas[0]?.valor_centavos ?? 0,
    parcelas,
  };
}

/**
 * Verifica a proposta contra a autorização do credor.
 * Retorna { dentro_alcada, violacoes[] }.
 */
export function verificarAlcada(sim, autorizacao) {
  const violacoes = [];
  if (!autorizacao || autorizacao.status !== 'ATIVA') {
    return { dentro_alcada: false, violacoes: ['Sem autorização de negociação ativa'] };
  }
  const limDesc = autorizacao.limite_desconto_bps ?? 0;
  const limParc = autorizacao.limite_parcelamento ?? 1;
  const entradaMin = autorizacao.entrada_minima_bps ?? 0;
  if (sim.desconto_bps > limDesc) violacoes.push(`Desconto ${sim.desconto_bps / 100}% acima do limite ${limDesc / 100}%`);
  const totalParcelas = sim.quantidade_parcelas + (sim.entrada_centavos > 0 ? 1 : 0);
  if (sim.quantidade_parcelas > 0 && totalParcelas > limParc) violacoes.push(`Parcelamento em ${totalParcelas}x acima do limite ${limParc}x`);
  if (sim.quantidade_parcelas > 0 && entradaMin > 0) {
    const minimo = aplicarPercentual(sim.valor_proposto_centavos, entradaMin);
    if (sim.entrada_centavos < minimo) violacoes.push(`Entrada abaixo do mínimo de ${entradaMin / 100}%`);
  }
  return { dentro_alcada: violacoes.length === 0, violacoes };
}
