// Calculadora de inadimplência do site: só aritmética sobre os números que a própria empresa informa.
// Não promete taxa de recuperação: o percentual recuperado é uma simulação ajustada pelo visitante.

/** Tempo típico de atraso → meses de mensalidade em aberto por aluno inadimplente (meio da faixa). */
export const FAIXAS_ATRASO = [
  { id: 'ate90', rotulo: 'Até 3 meses', meses: 2, comissao_bps: 1000 },
  { id: 'ate180', rotulo: 'De 3 a 6 meses', meses: 4.5, comissao_bps: 1500 },
  { id: 'ate365', rotulo: 'De 6 meses a 1 ano', meses: 9, comissao_bps: 2000 },
  { id: 'mais', rotulo: 'Mais de 1 ano', meses: 15, comissao_bps: 2500 },
];

export const COMISSAO_PILOTO_BPS = 1000;

const inteiro = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));

/**
 * @param {{alunos: number, mensalidadeCentavos: number, percentualAtraso: number, faixa: string, percentualRecuperado: number}} e
 * @returns valores em centavos (inteiros)
 */
export function calcularInadimplencia(e) {
  const alunos = inteiro(e.alunos, 1_000_000);
  const mensalidade = inteiro(e.mensalidadeCentavos, 100_000_00);
  const pctAtraso = Math.max(0, Math.min(100, Number(e.percentualAtraso) || 0));
  const pctRec = Math.max(0, Math.min(100, Number(e.percentualRecuperado) || 0));
  const faixa = FAIXAS_ATRASO.find((f) => f.id === e.faixa) || FAIXAS_ATRASO[0];
  const inadimplentes = Math.round((alunos * pctAtraso) / 100);
  const parado = Math.round(inadimplentes * mensalidade * faixa.meses);
  const porMes = inadimplentes * mensalidade;
  const recuperado = Math.round((parado * pctRec) / 100);
  const comissaoPiloto = Math.round((recuperado * COMISSAO_PILOTO_BPS) / 10000);
  const comissaoTabela = Math.round((recuperado * faixa.comissao_bps) / 10000);
  return {
    inadimplentes, parado_centavos: parado, por_mes_centavos: porMes, recuperado_centavos: recuperado,
    comissao_piloto_centavos: comissaoPiloto, liquido_piloto_centavos: recuperado - comissaoPiloto,
    comissao_tabela_centavos: comissaoTabela, liquido_tabela_centavos: recuperado - comissaoTabela, faixa,
  };
}
