// E-mail comercial (prospecção): texto simples com marcações leves vira um e-mail com a marca Acorly.
// Marcações: "## Título", "- item", "**negrito**", "[[botao:Texto|https://...]]", "[[link:Texto|https://...]]".
// Variáveis: {{nome}}, {{empresa}}, {{segmento}}, {{remetente}}, {{whatsapp}}.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const urlOk = (u) => /^https:\/\/[^\s"'<>]{3,500}$/.test(u);

export function preencher(texto, vars) {
  return String(texto || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] ?? ''))
    // variável vazia (ex.: sem nome do contato): "Olá, , tudo bem?" → "Olá, tudo bem?"; "Olá, !" → "Olá!"
    .replace(/,\s*,/g, ',').replace(/,\s*([!?.])/g, '$1').replace(/[ \t]+([,!?.])/g, '$1')
    .replace(/[ \t]+\n/g, '\n');
}

function inline(t) {
  return esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

// Assinatura em texto dos modelos ("Abraço, / **Nome** / HS Recuperação de Crédito · Acorly / e-mail / WhatsApp").
// No HTML ela é trocada pela imagem da assinatura; no texto puro continua (quem não vê imagem ainda tem o contato).
const ASSINATURA_TEXTO = /\n*Abraço,\s*\n[^\n]*\n\s*HS Recuperação de Crédito · Acorly\s*\n\s*contato@acorly\.com\.br\s*(\n\s*WhatsApp:[^\n]*)?\s*$/;

/** Converte o corpo (já preenchido) em HTML e texto puro. */
export function renderizarEmailComercial({ corpo, urlBase = '', rodape = '', sair = null }) {
  const html = [], texto = [];
  let lista = null, paragrafo = null;
  const assinaturaTexto = urlBase ? (ASSINATURA_TEXTO.exec(String(corpo)) || [''])[0] : '';
  if (assinaturaTexto) corpo = String(corpo).slice(0, String(corpo).length - assinaturaTexto.length);
  const fechaParagrafo = () => { if (paragrafo) { html.push(`<p style="font-size:15px;line-height:1.6;margin:0 0 14px">${paragrafo.join('<br>')}</p>`); paragrafo = null; } };
  const fechaLista = () => { fechaParagrafo(); if (lista) { html.push(`<ul style="margin:0 0 16px;padding-left:20px">${lista.join('')}</ul>`); lista = null; } };
  for (const bruta of String(corpo).split('\n')) {
    const l = bruta.trim();
    const botao = /^\[\[(botao|link):(.+?)\|(.+?)\]\]$/.exec(l);
    if (!l) { fechaLista(); texto.push(''); continue; }
    if (l.startsWith('## ')) {
      fechaLista();
      html.push(`<h2 style="font-size:17px;color:#001452;margin:22px 0 10px">${inline(l.slice(3))}</h2>`);
      texto.push(l.slice(3).toUpperCase());
    } else if (l.startsWith('- ')) {
      fechaParagrafo();
      (lista ??= []).push(`<li style="font-size:15px;line-height:1.55;margin:0 0 6px">${inline(l.slice(2))}</li>`);
      texto.push(`• ${l.slice(2).replace(/\*\*/g, '')}`);
    } else if (botao && urlOk(botao[3].trim())) {
      fechaLista();
      const [, tipo, rotulo, url] = botao;
      html.push(tipo === 'botao'
        ? `<p style="margin:18px 0"><a href="${esc(url.trim())}" style="background:#0043ff;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">${esc(rotulo.trim())}</a></p>`
        : `<p style="margin:0 0 14px"><a href="${esc(url.trim())}" style="color:#0043ff;font-weight:bold">${esc(rotulo.trim())} →</a></p>`);
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
<tr><td style="background:linear-gradient(135deg,#001452,#0043ff);background-color:#001452;color:#fff;padding:20px 28px">${logo}</td></tr>
<tr><td style="height:4px;line-height:4px;font-size:0;background:#0043ff;background-image:linear-gradient(90deg,#0043ff,#31d6ff,#31ff5e,#ff31ff,#ff8c00)">&nbsp;</td></tr>
<tr><td style="padding:26px 28px">${html.join('\n')}</td></tr>
${urlBase ? `<tr><td style="padding:0 28px 22px"><a href="https://acorly.com.br" style="text-decoration:none"><img src="${esc(urlBase)}/assinatura-email.png" width="380" alt="Acorly · uma plataforma da HS Recuperação de Crédito · WhatsApp +55 (71) 92005-4062 · acorly.com.br · Rua Júlia Fetal, 5, Nazaré, Salvador-BA 40040-350" style="display:block;width:100%;max-width:380px;height:auto;border:0;border-radius:8px"></a></td></tr>` : ''}
<tr><td style="padding:14px 28px;font-size:11px;color:#6b7280;border-top:1px solid #e2e8f0">${esc(rodape)}${sair ? `<br><a href="${esc(sair)}" style="color:#6b7280">Não quero mais receber e-mails comerciais da Acorly</a>` : ''}</td></tr>
</table></td></tr></table></body></html>`;
  if (assinaturaTexto) texto.push('', ...assinaturaTexto.trim().split('\n').map((x) => x.trim().replace(/\*\*/g, '')));
  const textoPuro = `${texto.join('\n').replace(/\n{3,}/g, '\n\n')}\n\n--\n${rodape}${sair ? `\nPara não receber mais: ${sair}` : ''}`;
  return { html: corpoHtml, texto: textoPuro };
}
