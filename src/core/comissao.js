// Comissão da HS na cobrança gerenciada: percentual por faixa de atraso da dívida,
// cobrado SOMENTE sobre valores efetivamente recebidos e confirmados pelo credor.
import { ValidationError, aplicarPercentual } from './money.js';

/** Faixas: [{ ate_dias: número | null (sem limite), bps }], em ordem crescente. 1% = 100 bps. */
export const TABELA_PADRAO = [
  { ate_dias: 90, bps: 1000 },
  { ate_dias: 180, bps: 1500 },
  { ate_dias: 365, bps: 2000 },
  { ate_dias: null, bps: 2500 },
];

export function validarFaixas(faixas) {
  if (!Array.isArray(faixas) || faixas.length < 1 || faixas.length > 12) throw new ValidationError('Informe de 1 a 12 faixas de comissão');
  let anterior = -1;
  faixas.forEach((f, i) => {
    const ultima = i === faixas.length - 1;
    if (!Number.isSafeInteger(f.bps) || f.bps < 0 || f.bps > 10000) throw new ValidationError('Percentual de comissão deve ficar entre 0% e 100%');
    if (ultima) {
      if (f.ate_dias !== null && f.ate_dias !== undefined) throw new ValidationError('A última faixa deve valer para qualquer atraso acima da anterior (sem limite)');
    } else {
      if (!Number.isSafeInteger(f.ate_dias) || f.ate_dias <= anterior) throw new ValidationError('Os limites de dias das faixas devem ser crescentes');
      anterior = f.ate_dias;
    }
  });
  return faixas.map((f, i) => ({ ate_dias: i === faixas.length - 1 ? null : f.ate_dias, bps: f.bps }));
}

/** Rótulo da faixa, ex.: "91 a 180 dias", "acima de 365 dias". */
export function rotuloFaixa(faixas, i) {
  const de = i === 0 ? 0 : faixas[i - 1].ate_dias + 1;
  const ate = faixas[i].ate_dias;
  if (ate === null) return i === 0 ? 'qualquer atraso' : `acima de ${de - 1} dias`;
  return i === 0 ? `até ${ate} dias` : `${de} a ${ate} dias`;
}

export function faixaPara(diasAtraso, faixas = TABELA_PADRAO) {
  const d = Math.max(0, diasAtraso | 0);
  const i = faixas.findIndex((f) => f.ate_dias === null || d <= f.ate_dias);
  const idx = i < 0 ? faixas.length - 1 : i;
  return { bps: faixas[idx].bps, faixa: rotuloFaixa(faixas, idx), indice: idx };
}

export const calcularComissao = (valorCentavos, bps) => aplicarPercentual(valorCentavos, bps);
