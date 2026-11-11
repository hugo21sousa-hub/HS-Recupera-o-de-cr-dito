import { ValidationError } from './money.js';

/** Datas de negócio em ISO "YYYY-MM-DD" (sem fuso). */
export function parseDataISO(s, campo = 'data') {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ValidationError(`${campo} inválida (use AAAA-MM-DD)`);
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) throw new ValidationError(`${campo} inexistente`);
  if (y < 1990 || y > 2100) throw new ValidationError(`${campo} fora do intervalo aceito`);
  return s;
}

export function hojeISO(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function diasEntre(aISO, bISO) {
  return Math.round((Date.parse(bISO + 'T00:00:00Z') - Date.parse(aISO + 'T00:00:00Z')) / 86400000);
}

export function diasAtraso(vencimentoISO, hoje = hojeISO()) {
  return Math.max(0, diasEntre(vencimentoISO, hoje));
}

/** Soma meses mantendo o dia (ajusta para o último dia do mês quando necessário). */
export function addMeses(iso, meses) {
  const [y, m, d] = iso.split('-').map(Number);
  const alvo = new Date(Date.UTC(y, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}
