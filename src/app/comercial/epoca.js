// Calendário comercial: em cada época do ano, quais segmentos sentem mais a inadimplência (prioridade da Lista do dia).
const EPOCAS = [
  { meses: [11, 12], tema: '13º salário e rematrícula', segmentos: ['ESCOLA_CURSO', 'SAUDE', 'VAREJO', 'CONDOMINIO', 'ACADEMIA'],
    dica: 'O devedor recebeu o 13º e quer começar o ano limpo: é a melhor janela do ano para recuperar. Escolas estão na rematrícula.' },
  { meses: [1], tema: 'Começo do ano: rematrícula e fim dos planos', segmentos: ['ESCOLA_CURSO', 'ACADEMIA', 'VAREJO', 'CONDOMINIO'],
    dica: 'Escolas fecham a rematrícula e academias perdem alunos dos planos de fim de ano. Crediário do Natal começa a atrasar.' },
  { meses: [2, 3, 4], tema: 'Contas do início do ano', segmentos: ['ESCOLA_CURSO', 'VAREJO', 'ACADEMIA', 'SAUDE', 'DISTRIBUIDORA'],
    dica: 'IPVA, IPTU e material escolar apertam o orçamento das famílias: a inadimplência sobe nesses meses.' },
  { meses: [5, 6], tema: 'Fechamento do semestre', segmentos: ['ESCOLA_CURSO', 'SAUDE', 'DISTRIBUIDORA', 'SERVICOS', 'CONDOMINIO'],
    dica: 'Empresas fecham o semestre e olham o caixa: é hora de mostrar quanto está parado.' },
  { meses: [7], tema: 'Férias e rematrícula do 2º semestre', segmentos: ['ESCOLA_CURSO', 'ACADEMIA', 'SAUDE', 'VAREJO'],
    dica: 'Cursos e faculdades renovam matrículas do 2º semestre; academias sentem a saída nas férias.' },
  { meses: [8, 9, 10], tema: 'Planejamento do fim de ano e assembleias', segmentos: ['CONDOMINIO', 'IMOBILIARIA', 'SAUDE', 'DISTRIBUIDORA', 'ESCOLA_CURSO'],
    dica: 'Síndicos preparam as assembleias e as empresas planejam o fim do ano. Em outubro, escolas começam a rematrícula.' },
];

/** Época do mês (1-12): tema, segmentos prioritários (em ordem) e dica de abordagem. */
export function epocaDoMes(mes) {
  const e = EPOCAS.find((x) => x.meses.includes(mes)) || EPOCAS[0];
  return { tema: e.tema, segmentos: e.segmentos, dica: e.dica, decimo_terceiro: mes === 11 || mes === 12 };
}

/** Posição do segmento na prioridade do mês (menor = mais prioritário). Contabilidade (parceiros) vem logo depois. */
export function rankSegmento(segmento, mes) {
  const i = epocaDoMes(mes).segmentos.indexOf(segmento);
  if (i >= 0) return i;
  return segmento === 'CONTABILIDADE' ? 10 : 20;
}

export const mesBrasilia = (ctx) => new Date(ctx.now().getTime() - 3 * 3600e3).getUTCMonth() + 1;
