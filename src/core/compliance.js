import { ValidationError } from './money.js';

// Salvaguardas de cobrança não abusiva (CDC art. 42 e 71; LGPD).
// Não substitui revisão jurídica: é uma barreira mínima no sistema.
const TERMOS_PROIBIDOS = [
  /\bpris[aã]o\b/i, /\bpreso\b/i, /\bpol[ií]cia\b/i, /\bdelegacia\b/i, /processo criminal/i, /\bcadeia\b/i,
  /\bexpor\b/i, /\bexposi[cç][aã]o\b/i, /seu chefe/i, /seus? vizinhos?/i, /sua fam[ií]lia/i, /\bvergonha\b/i,
  /\bcaloteir[oa]\b/i, /\bvagabund[oa]\b/i, /\bladr[aã]o\b/i, /vamos (at[eé]|na) sua casa/i, /\bpenhora(r)? (seus|tudo)\b/i,
];

export function verificarMensagem(texto) {
  const achados = TERMOS_PROIBIDOS.filter((r) => r.test(texto || '')).map((r) => r.source);
  if (achados.length) {
    throw new ValidationError('Mensagem bloqueada: contém termos de ameaça, constrangimento ou exposição. Reescreva de forma respeitosa e objetiva.', { termos: achados });
  }
  return true;
}

export const LIMITE_CONTATOS_DIA = 3;

export function dentroDoHorario(horario = '08:00-20:00', agora = new Date(), tzOffsetMin = -180) {
  const [ini, fim] = horario.split('-');
  const local = new Date(agora.getTime() + tzOffsetMin * 60000);
  const hm = local.toISOString().slice(11, 16);
  const diaSemana = local.getUTCDay();
  if (diaSemana === 0) return false; // domingo
  return hm >= ini && hm <= fim;
}

export function preencherModelo(modelo, vars) {
  return String(modelo || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] ?? ''));
}
