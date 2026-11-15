// E-mail comercial (prospecção): texto simples com marcações leves vira um e-mail com a marca Acorly.
// Marcações: "## Título", "- item", "**negrito**", "[[botao:Texto|https://...]]", "[[link:Texto|https://...]]".
// Variáveis: {{nome}}, {{empresa}}, {{segmento}}, {{remetente}}, {{whatsapp}}.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const urlOk = (u) => /^https:\/\/[^\s"'<>]{3,500}$/.test(u);

export function preencher(texto, vars) {
  return String(texto || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] ?? '')).replace(/[ \t]+\n/g, '\n');
}

function inline(t) {
  return esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/** Converte o corpo (já preenchido) em HTML e texto puro. */
export function renderizarEmailComercial({ corpo, urlBase = '', rodape = '', sair = null }) {
  const html = [], texto = [];
  let lista = null, paragrafo = null;
  const fechaParagrafo = () => { if (paragrafo) { html.push(`<p style="font-size:15px;line-height:1.6;margin:0 0 14px">${paragrafo.join('<br>')}</p>`); paragrafo = null; } };
  const fechaLista = () => { fechaParagrafo(); if (lista) { html.push(`<ul style="margin:0 0 16px;padding-left:20px">${lista.join('')}</ul>`); lista = null; } };
  for (const bruta of String(corpo).split('\n')) {
    const l = bruta.trim();
    const botao = /^\[\[(botao|link):(.+?)\|(.+?)\]\]$/.exec(l);
    if (!l) { fechaLista(); texto.push(''); continue; }
    if (l.startsWith('## ')) {
      fechaLista();
      html.push(`<h2 style="font-size:17px;color:#0b2545;margin:22px 0 10px">${inline(l.slice(3))}</h2>`);
      texto.push(l.slice(3).toUpperCase());
    } else if (l.startsWith('- ')) {
      fechaParagrafo();
      (lista ??= []).push(`<li style="font-size:15px;line-height:1.55;margin:0 0 6px">${inline(l.slice(2))}</li>`);
      texto.push(`• ${l.slice(2).replace(/\*\*/g, '')}`);
    } else if (botao && urlOk(botao[3].trim())) {
      fechaLista();
      const [, tipo, rotulo, url] = botao;
      html.push(tipo === 'botao'
        ? `<p style="margin:18px 0"><a href="${esc(url.trim())}" style="background:#1d5fa7;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">${esc(rotulo.trim())}</a></p>`
        : `<p style="margin:0 0 14px"><a href="${esc(url.trim())}" style="color:#1d5fa7;font-weight:bold">${esc(rotulo.trim())} →</a></p>`);
      texto.push(`${rotulo.trim()}: ${url.trim()}`);
    } else {
      if (lista) fechaLista();
      (paragrafo ??= []).push(inline(l));
      texto.push(l.replace(/\*\*/g, ''));
    }
  }
  fechaLista();
  const logo = urlBase ? `<img src="${esc(urlBase)}/email-logo.png" alt="Acorly" height="32" style="display:block;height:32px;border:0">` : '<span style="font-size:20px;font-weight:bold">Acorly</span>';
  const corpoHtml = `<!doctype html><html><body style="margin:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
<tr><td style="background:linear-gradient(135deg,#0b2545,#1d5fa7);background-color:#0b2545;color:#fff;padding:20px 28px">${logo}</td></tr>
<tr><td style="padding:26px 28px">${html.join('\n')}</td></tr>
<tr><td style="padding:14px 28px;font-size:11px;color:#6b7280;border-top:1px solid #e2e8f0">${esc(rodape)}${sair ? `<br><a href="${esc(sair)}" style="color:#6b7280">Não quero mais receber e-mails comerciais da Acorly</a>` : ''}</td></tr>
</table></td></tr></table></body></html>`;
  const textoPuro = `${texto.join('\n').replace(/\n{3,}/g, '\n\n')}\n\n--\n${rodape}${sair ? `\nPara não receber mais: ${sair}` : ''}`;
  return { html: corpoHtml, texto: textoPuro };
}
