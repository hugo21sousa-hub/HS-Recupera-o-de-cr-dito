import { ValidationError } from './money.js';

export const STATUS = [
  'AGUARDANDO_VALIDACAO', 'AGUARDANDO_AUTORIZACAO', 'PRONTO_PARA_COBRANCA', 'AGUARDANDO_OPERADOR', 'ATRIBUIDO',
  'PRIMEIRO_CONTATO_PENDENTE', 'EM_CONTATO', 'DEVEDOR_RESPONDEU', 'EM_NEGOCIACAO', 'ACORDO_AGUARDANDO_PAGAMENTO',
  'PAGAMENTO_INFORMADO', 'PAGAMENTO_EM_CONFIRMACAO', 'PARCIALMENTE_RECUPERADO', 'RECUPERADO_INTEGRALMENTE',
  'SEM_SUCESSO', 'SUSPENSO', 'CONTESTACAO',
];

export const TERMINAIS = new Set(['RECUPERADO_INTEGRALMENTE', 'SEM_SUCESSO']);

const EM_TRABALHO = ['ATRIBUIDO', 'PRIMEIRO_CONTATO_PENDENTE', 'EM_CONTATO', 'DEVEDOR_RESPONDEU', 'EM_NEGOCIACAO',
  'ACORDO_AGUARDANDO_PAGAMENTO', 'PAGAMENTO_INFORMADO', 'PAGAMENTO_EM_CONFIRMACAO', 'PARCIALMENTE_RECUPERADO', 'CONTESTACAO'];

// Transições permitidas (origem -> destinos). SUSPENSO e CONTESTACAO tratados à parte.
export const TRANSICOES = {
  AGUARDANDO_VALIDACAO: ['AGUARDANDO_AUTORIZACAO', 'PRONTO_PARA_COBRANCA'],
  AGUARDANDO_AUTORIZACAO: ['PRONTO_PARA_COBRANCA'],
  PRONTO_PARA_COBRANCA: ['AGUARDANDO_OPERADOR', 'ATRIBUIDO'],
  AGUARDANDO_OPERADOR: ['ATRIBUIDO'],
  ATRIBUIDO: ['PRIMEIRO_CONTATO_PENDENTE', 'EM_CONTATO', 'DEVEDOR_RESPONDEU', 'EM_NEGOCIACAO', 'AGUARDANDO_OPERADOR'],
  PRIMEIRO_CONTATO_PENDENTE: ['EM_CONTATO', 'DEVEDOR_RESPONDEU', 'EM_NEGOCIACAO', 'SEM_SUCESSO', 'AGUARDANDO_OPERADOR'],
  EM_CONTATO: ['DEVEDOR_RESPONDEU', 'EM_NEGOCIACAO', 'SEM_SUCESSO', 'PAGAMENTO_INFORMADO', 'AGUARDANDO_OPERADOR'],
  DEVEDOR_RESPONDEU: ['EM_CONTATO', 'EM_NEGOCIACAO', 'PAGAMENTO_INFORMADO', 'SEM_SUCESSO', 'AGUARDANDO_OPERADOR'],
  EM_NEGOCIACAO: ['EM_CONTATO', 'ACORDO_AGUARDANDO_PAGAMENTO', 'PAGAMENTO_INFORMADO', 'SEM_SUCESSO', 'AGUARDANDO_OPERADOR'],
  ACORDO_AGUARDANDO_PAGAMENTO: ['PAGAMENTO_INFORMADO', 'EM_NEGOCIACAO', 'SEM_SUCESSO'],
  PAGAMENTO_INFORMADO: ['PAGAMENTO_EM_CONFIRMACAO', 'PARCIALMENTE_RECUPERADO', 'RECUPERADO_INTEGRALMENTE', 'EM_CONTATO', 'ACORDO_AGUARDANDO_PAGAMENTO', 'EM_NEGOCIACAO'],
  PAGAMENTO_EM_CONFIRMACAO: ['PARCIALMENTE_RECUPERADO', 'RECUPERADO_INTEGRALMENTE', 'EM_CONTATO', 'ACORDO_AGUARDANDO_PAGAMENTO', 'EM_NEGOCIACAO'],
  PARCIALMENTE_RECUPERADO: ['EM_CONTATO', 'EM_NEGOCIACAO', 'ACORDO_AGUARDANDO_PAGAMENTO', 'PAGAMENTO_INFORMADO', 'RECUPERADO_INTEGRALMENTE', 'SEM_SUCESSO'],
  RECUPERADO_INTEGRALMENTE: [],
  SEM_SUCESSO: [],
  SUSPENSO: [], // reativação usa status_anterior
  CONTESTACAO: ['EM_CONTATO', 'EM_NEGOCIACAO', 'SEM_SUCESSO'],
};

for (const s of STATUS) {
  if (!TERMINAIS.has(s) && s !== 'SUSPENSO') TRANSICOES[s] = [...new Set([...(TRANSICOES[s] || []), 'SUSPENSO'])];
}
for (const s of EM_TRABALHO) {
  if (s !== 'CONTESTACAO') TRANSICOES[s] = [...new Set([...TRANSICOES[s], 'CONTESTACAO'])];
}

export function podeTransitar(de, para) {
  return (TRANSICOES[de] || []).includes(para);
}

/**
 * Valida a transição e retorna o patch a aplicar ao caso.
 * Exige motivo para SUSPENSO, SEM_SUCESSO, CONTESTACAO e reativação.
 */
export function transicao(caso, para, { motivo, agora = new Date().toISOString() } = {}) {
  const de = caso.status_operacional;
  if (de === 'SUSPENSO' && para === 'REATIVAR') {
    if (!motivo) throw new ValidationError('Motivo obrigatório para reativação');
    const destino = caso.status_anterior && caso.status_anterior !== 'SUSPENSO' ? caso.status_anterior : 'AGUARDANDO_OPERADOR';
    return { status_operacional: destino, status_anterior: null, motivo_status: motivo };
  }
  if (!STATUS.includes(para)) throw new ValidationError(`Status desconhecido: ${para}`);
  if (!podeTransitar(de, para)) throw new ValidationError(`Transição não permitida: ${de} → ${para}`);
  if (['SUSPENSO', 'SEM_SUCESSO', 'CONTESTACAO'].includes(para) && !motivo) throw new ValidationError(`Motivo obrigatório para ${para}`);
  const patch = { status_operacional: para, motivo_status: motivo || null };
  if (para === 'SUSPENSO') patch.status_anterior = de;
  if (TERMINAIS.has(para)) patch.data_encerramento = agora;
  return patch;
}

export function casoAtivo(caso) {
  return !TERMINAIS.has(caso.status_operacional);
}
