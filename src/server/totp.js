// TOTP (RFC 6238) compatível com Google Authenticator, Microsoft Authenticator, Authy etc.
import { createHmac, randomBytes, createCipheriv, createDecipheriv, createHash, timingSafeEqual } from 'node:crypto';

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(buf) {
  let bits = 0, valor = 0, out = '';
  for (const b of buf) {
    valor = (valor << 8) | b; bits += 8;
    while (bits >= 5) { out += ALFABETO[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALFABETO[(valor << (5 - bits)) & 31];
  return out;
}

export function deBase32(s) {
  const limpo = String(s).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, valor = 0;
  const out = [];
  for (const ch of limpo) {
    valor = (valor << 5) | ALFABETO.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const novoSegredo = () => base32(randomBytes(20));

export function codigo(segredo, passo) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(passo));
  const h = createHmac('sha1', deBase32(segredo)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}

/** Retorna o passo (contador) aceito, ou null. Tolerância de ±1 passo (30 s). */
export function verificar(segredo, informado, agoraMs = Date.now()) {
  const c = String(informado || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const atual = Math.floor(agoraMs / 30000);
  for (const d of [0, -1, 1]) {
    const esperado = Buffer.from(codigo(segredo, atual + d));
    if (timingSafeEqual(esperado, Buffer.from(c))) return atual + d;
  }
  return null;
}

export function otpauth(segredo, email) {
  const emissor = 'HS Recuperação de Crédito';
  return `otpauth://totp/${encodeURIComponent(`${emissor}:${email}`)}?secret=${segredo}&issuer=${encodeURIComponent(emissor)}&algorithm=SHA1&digits=6&period=30`;
}

/** Criptografia do segredo em repouso (AES-256-GCM com chave derivada do segredo do servidor). */
export function cifrador(segredoServidor) {
  const chave = createHash('sha256').update(`${segredoServidor}:totp`).digest();
  return {
    cifrar(texto) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', chave, iv);
      const dados = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
      return `${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${dados.toString('base64')}`;
    },
    decifrar(s) {
      const [iv, tag, dados] = String(s).split('.').map((x) => Buffer.from(x, 'base64'));
      const d = createDecipheriv('aes-256-gcm', chave, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(dados), d.final()]).toString('utf8');
    },
  };
}
