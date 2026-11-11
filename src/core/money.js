// Valores monetários SEMPRE em centavos inteiros (Number inteiro seguro).
// Nunca usar float para somar/subtrair dinheiro.

export class ValidationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ValidationError';
    this.status = 422;
    this.details = details;
  }
}

export function assertCentavos(v, campo = 'valor', { allowZero = false } = {}) {
  if (!Number.isSafeInteger(v)) throw new ValidationError(`${campo} deve ser inteiro em centavos`);
  if (v < 0 || (!allowZero && v === 0)) throw new ValidationError(`${campo} deve ser ${allowZero ? 'maior ou igual a' : 'maior que'} zero`);
  return v;
}

/** Converte "1.234,56" | "1234.56" | 1234.56 | "R$ 10" em centavos, sem float. */
export function parseReais(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new ValidationError('Valor inválido');
    input = input.toFixed(2);
  }
  let s = String(input ?? '').trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (!s) throw new ValidationError('Valor vazio');
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  // Formato brasileiro: vírgula decimal
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new ValidationError(`Valor inválido: ${input}`);
  const [int, dec = ''] = s.split('.');
  const cents = Number(int) * 100 + Number(dec.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new ValidationError('Valor fora do limite');
  return neg ? -cents : cents;
}

export function formatBRL(cents) {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const int = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const dec = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}R$ ${int},${dec}`;
}

/** Percentual em pontos-base (1% = 100 bps). Arredondamento half-up para centavo. */
export function aplicarPercentual(cents, bps) {
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 10000) throw new ValidationError('Percentual inválido (0 a 10000 bps)');
  return Math.floor((cents * bps + 5000) / 10000);
}

/** Divide um total em n parcelas; diferença de arredondamento vai para a última parcela. */
export function dividirEmParcelas(total, n) {
  if (!Number.isSafeInteger(n) || n < 1 || n > 360) throw new ValidationError('Quantidade de parcelas inválida');
  assertCentavos(total, 'total', { allowZero: true });
  const base = Math.floor(total / n);
  const parcelas = Array(n).fill(base);
  parcelas[n - 1] += total - base * n;
  return parcelas;
}

export function soma(valores) {
  return valores.reduce((a, b) => a + (b || 0), 0);
}

/** Taxa em bps (inteiro) para evitar float em relatórios: 2550 = 25,50% */
export function taxaBps(parte, total) {
  if (!total) return 0;
  return Math.floor((parte * 10000) / total);
}
