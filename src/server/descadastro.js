// Link "não quero mais receber e-mails" dos e-mails de cobrança: token assinado (HMAC) com o id do devedor.
import { createHmac, timingSafeEqual } from 'node:crypto';

export function criarDescadastro({ segredo, urlBase }) {
  const assinar = (id) => createHmac('sha256', segredo).update(`descadastro:${id}`).digest('base64url').slice(0, 32);
  return {
    link: (devedor_id) => `${urlBase}/descadastrar/${encodeURIComponent(devedor_id)}.${assinar(devedor_id)}`,
    /** Devolve o id do devedor se o token for válido; senão, null. */
    validar(token) {
      const m = /^([A-Za-z0-9_-]{1,80})\.([A-Za-z0-9_-]{32})$/.exec(String(token || ''));
      if (!m) return null;
      const esperado = Buffer.from(assinar(m[1]));
      const recebido = Buffer.from(m[2]);
      return esperado.length === recebido.length && timingSafeEqual(esperado, recebido) ? m[1] : null;
    },
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function paginaDescadastro({ titulo, texto, botao = null }) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title>
<style>body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#f5f7fa;color:#1f2937;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
.c{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;max-width:440px;width:100%}h1{font-size:20px;margin:0 0 12px}p{line-height:1.5;margin:0 0 16px}
button{background:#1d5fa7;color:#fff;border:0;border-radius:8px;padding:12px 18px;font-size:15px;font-weight:bold;cursor:pointer;width:100%}</style></head>
<body><div class="c"><h1>${esc(titulo)}</h1><p>${esc(texto)}</p>${botao ? `<form method="post"><button type="submit">${esc(botao)}</button></form>` : ''}</div></body></html>`;
}
