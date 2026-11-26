// Pix "copia e cola" (BR Code, padrão EMV do Banco Central) gerado com a chave Pix do próprio credor.
// O dinheiro cai direto na conta dona da chave: o sistema só monta o código.
import { cpfValido, cnpjValido, somenteDigitos } from './documento.js';

/** CRC16-CCITT (polinômio 0x1021, valor inicial 0xFFFF), exigido no campo 63 do BR Code. */
export function crc16(texto) {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(texto)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const campo = (id, valor) => `${id}${String(new TextEncoder().encode(valor).length).padStart(2, '0')}${valor}`;

/** Texto em maiúsculas, sem acentos e só com caracteres aceitos pelos bancos. */
const limpo = (v, max) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .\-&]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, max).trim();

/** Identifica e normaliza a chave Pix. Devolve { tipo, chave } ou lança erro com a explicação. */
export function normalizarChavePix(valor) {
  const v = String(valor ?? '').trim();
  if (!v) throw new Error('Informe a chave Pix da empresa.');
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return { tipo: 'ALEATORIA', chave: v.toLowerCase() };
  if (v.includes('@')) {
    const e = v.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 77) throw new Error('E-mail da chave Pix inválido.');
    return { tipo: 'EMAIL', chave: e };
  }
  const d = somenteDigitos(v);
  if (d.length === 14 && cnpjValido(d)) return { tipo: 'CNPJ', chave: d };
  if (d.length === 11 && cpfValido(d) && !/^\+/.test(v)) return { tipo: 'CPF', chave: d };
  const fone = d.startsWith('55') && d.length >= 12 ? d : d.length === 10 || d.length === 11 ? `55${d}` : null;
  if (fone && fone.length >= 12 && fone.length <= 13) return { tipo: 'TELEFONE', chave: `+${fone}` };
  throw new Error('Chave Pix não reconhecida: use o CNPJ, CPF, e-mail, celular com DDD ou a chave aleatória cadastrada no seu banco.');
}

/** Identificador da cobrança (txid): só letras e números, até 25 caracteres. Aparece no extrato de muitos bancos. */
export function txidPix(base) {
  const t = String(base ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return `AC${t}`.slice(0, 25) || '***';
}

/**
 * Monta o Pix copia e cola com valor fixo.
 * @param {{chave: string, nome: string, cidade: string, valorCentavos?: number, txid?: string}} d
 */
export function brCodePix({ chave, nome, cidade, valorCentavos, txid = '***' }) {
  const { chave: k } = normalizarChavePix(chave);
  const nomeLimpo = limpo(nome, 25) || 'RECEBEDOR';
  const cidadeLimpa = limpo(cidade, 15) || 'BRASIL';
  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', k);
  let p = campo('00', '01') + campo('26', conta) + campo('52', '0000') + campo('53', '986');
  if (valorCentavos != null) {
    if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) throw new Error('Valor do Pix inválido.');
    p += campo('54', (valorCentavos / 100).toFixed(2));
  }
  p += campo('58', 'BR') + campo('59', nomeLimpo) + campo('60', cidadeLimpa) + campo('62', campo('05', String(txid).slice(0, 25) || '***'));
  p += '6304';
  return p + crc16(p);
}
