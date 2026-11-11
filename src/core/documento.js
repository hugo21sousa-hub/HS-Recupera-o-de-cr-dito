// Validação de CPF/CNPJ com dígitos verificadores.
export const somenteDigitos = (s) => String(s ?? '').replace(/\D/g, '');

export function cpfValido(v) {
  const c = somenteDigitos(v);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (len) => {
    let s = 0;
    for (let i = 0; i < len; i++) s += Number(c[i]) * (len + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

export function cnpjValido(v) {
  const c = somenteDigitos(v);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (len) => {
    const pesos = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((acc, p, i) => acc + Number(c[i]) * p, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}

export function documentoValido(v, tipoPessoa) {
  if (tipoPessoa === 'PF') return cpfValido(v);
  if (tipoPessoa === 'PJ') return cnpjValido(v);
  return cpfValido(v) || cnpjValido(v);
}

export function telefoneBR(v) {
  const d = somenteDigitos(v);
  const local = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
  if (local.length !== 10 && local.length !== 11) return null;
  return '55' + local;
}

export function emailValido(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}
