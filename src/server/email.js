// E-mail transacional via SMTP (qualquer provedor: Amazon SES, SendGrid, Brevo, Zoho, Gmail Workspace...).
// Sem SMTP_HOST configurado, o recurso fica "indisponível" e os links são copiados manualmente.
import nodemailer from 'nodemailer';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function configSMTP(env = process.env) {
  if (!env.SMTP_HOST) return null;
  return {
    host: env.SMTP_HOST, port: Number(env.SMTP_PORT) || 587, secure: env.SMTP_SECURE === 'true' || Number(env.SMTP_PORT) === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    remetente: env.SMTP_FROM || env.SMTP_USER,
  };
}

export function criarEmail({ config, transporte, urlBase = '' } = {}) {
  const t = transporte || (config ? nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure, auth: config.auth }) : null);
  const remetente = config?.remetente || 'HS Recuperação de Crédito <nao-responda@localhost>';
  const enviados = [];

  function modelo(titulo, paragrafos, botao) {
    const html = `<!doctype html><html><body style="margin:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">
<tr><td style="background:#0b2545;color:#fff;padding:16px 24px;font-weight:bold;font-size:16px">HS Recuperação de Crédito</td></tr>
<tr><td style="padding:24px"><h1 style="font-size:18px;margin:0 0 12px">${esc(titulo)}</h1>
${paragrafos.map((p) => `<p style="font-size:14px;line-height:1.5;margin:0 0 12px">${esc(p)}</p>`).join('')}
${botao ? `<p style="margin:20px 0"><a href="${esc(botao.url)}" style="background:#1d5fa7;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">${esc(botao.texto)}</a></p><p style="font-size:12px;color:#6b7280;word-break:break-all">Ou copie o endereço: ${esc(botao.url)}</p>` : ''}
</td></tr><tr><td style="padding:12px 24px;font-size:11px;color:#6b7280;border-top:1px solid #e2e8f0">Mensagem automática. Não responda este e-mail.</td></tr></table></td></tr></table></body></html>`;
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
      para, assunto: reset ? 'Redefinição de senha — HS Recuperação de Crédito' : 'Seu acesso à HS Recuperação de Crédito',
      paragrafos: reset ? ['Recebemos um pedido para redefinir a sua senha.', 'O link vale por 7 dias e só pode ser usado uma vez. Se não foi você, ignore este e-mail.']
        : ['Você recebeu acesso à plataforma HS Recuperação de Crédito.', 'Clique no botão para definir a sua senha. O link vale por 7 dias e só pode ser usado uma vez.'],
      botao: { texto: reset ? 'Redefinir senha' : 'Definir minha senha', url: link },
    }),
    notificacao: (para, n) => enviar({ para, assunto: `${n.titulo} — HS Recuperação de Crédito`, paragrafos: [n.mensagem || n.titulo], botao: { texto: 'Abrir na plataforma', url: `${urlBase}${n.link || '/'}` } }),
  };
}
