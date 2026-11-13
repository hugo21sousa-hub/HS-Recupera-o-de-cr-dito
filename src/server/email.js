// E-mail transacional via SMTP (qualquer provedor: Amazon SES, SendGrid, Brevo, Zoho, Gmail Workspace...).
// Sem SMTP_HOST configurado, o recurso fica "indisponível" e os links são copiados manualmente.
import nodemailer from 'nodemailer';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Remetente "Nome <email@dominio>" → { name, email } */
function separarRemetente(s) {
  const m = String(s || '').match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { name: m[1] || 'Acorly', email: m[2] } : { name: 'Acorly', email: String(s || '').trim() };
}

/**
 * Envio pela API HTTPS do Brevo (plano grátis: 300 e-mails/dia). Funciona onde SMTP é bloqueado
 * (ex.: Render grátis). Interface compatível com o nodemailer: sendMail({ from, to, subject, text, html }).
 */
export function transporteBrevo({ chave, fetchImpl = fetch }) {
  return {
    async sendMail({ from, to, subject, text, html }) {
      const r = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
        method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { 'api-key': chave, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: separarRemetente(from), to: [{ email: to }], subject, textContent: text, htmlContent: html }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Brevo recusou o envio (${r.status}): ${j.message || ''}`);
      return { messageId: j.messageId };
    },
  };
}

export function configSMTP(env = process.env) {
  if (!env.SMTP_HOST) return null;
  return {
    host: env.SMTP_HOST, port: Number(env.SMTP_PORT) || 587, secure: env.SMTP_SECURE === 'true' || Number(env.SMTP_PORT) === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    remetente: env.SMTP_FROM || env.SMTP_USER,
  };
}

export function criarEmail({ config, transporte, urlBase = '', env = process.env, fetchImpl } = {}) {
  const brevo = env.BREVO_API_KEY ? transporteBrevo({ chave: env.BREVO_API_KEY, fetchImpl: fetchImpl || fetch }) : null;
  const t = transporte || brevo || (config ? nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure, auth: config.auth }) : null);
  const remetente = env.EMAIL_REMETENTE || config?.remetente || 'Acorly <nao-responda@localhost>';
  const enviados = [];

  function modelo(titulo, paragrafos, botao) {
    const html = `<!doctype html><html><body style="margin:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">
<tr><td style="background:#0b2545;color:#fff;padding:16px 24px;font-weight:bold;font-size:16px">${urlBase ? `<img src="${urlBase}/email-logo.png" alt="Acorly" height="32" style="display:block;height:32px;border:0">` : 'Acorly'}</td></tr>
<tr><td style="padding:24px"><h1 style="font-size:18px;margin:0 0 12px">${esc(titulo)}</h1>
${paragrafos.map((p) => `<p style="font-size:14px;line-height:1.5;margin:0 0 12px">${esc(p)}</p>`).join('')}
${botao ? `<p style="margin:20px 0"><a href="${esc(botao.url)}" style="background:#1d5fa7;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">${esc(botao.texto)}</a></p><p style="font-size:12px;color:#6b7280;word-break:break-all">Ou copie o endereço: ${esc(botao.url)}</p>` : ''}
</td></tr><tr><td style="padding:12px 24px;font-size:11px;color:#6b7280;border-top:1px solid #e2e8f0">Acorly · HS Recuperação de Crédito. Mensagem automática, não responda este e-mail.</td></tr></table></td></tr></table></body></html>`;
    const texto = [titulo, '', ...paragrafos, ...(botao ? ['', `${botao.texto}: ${botao.url}`] : [])].join('\n');
    return { html, texto };
  }

  async function enviar({ para, assunto, titulo, paragrafos, botao }) {
    if (!t) return false;
    const { html, texto } = modelo(titulo || assunto, paragrafos, botao);
    try {
      const info = await t.sendMail({ from: remetente, to: para, subject: assunto, text: texto, html });
      enviados.push({ para, assunto, info });
      return true;
    } catch (e) {
      console.error('[email] falha ao enviar para', para, e.message);
      return false;
    }
  }

  return {
    disponivel: !!t,
    enviados,
    enviar,
    convite: (para, link, reset = false) => enviar({
      para, assunto: reset ? 'Redefinição de senha — Acorly' : 'Seu acesso ao Acorly',
      paragrafos: reset ? ['Recebemos um pedido para redefinir a sua senha.', 'O link vale por 7 dias e só pode ser usado uma vez. Se não foi você, ignore este e-mail.']
        : ['Você recebeu acesso ao Acorly, a plataforma de recuperação de crédito da HS Recuperação de Crédito.', 'Clique no botão para definir a sua senha. O link vale por 7 dias e só pode ser usado uma vez.'],
      botao: { texto: reset ? 'Redefinir senha' : 'Definir minha senha', url: link },
    }),
    /** Código de verificação do login. */
    codigoAcesso: (para, codigo) => enviar({
      para, assunto: `${codigo} é o seu código de acesso — Acorly`, titulo: 'Seu código de acesso',
      paragrafos: [`Use o código ${codigo} para concluir a entrada no sistema.`, 'Ele vale por 10 minutos e só pode ser usado uma vez.', 'Se você não tentou entrar agora, ignore este e-mail e troque a sua senha.'],
    }),
    notificacao: (para, n) => enviar({ para, assunto: `${n.titulo} — Acorly`, paragrafos: [n.mensagem || n.titulo], botao: { texto: 'Abrir na plataforma', url: `${urlBase}${n.link || '/'}` } }),
  };
}
