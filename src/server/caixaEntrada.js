// Leitura da caixa de entrada (IMAP, ex.: Hostinger) para o SDR automático saber quem respondeu.
// Só lê: não apaga, não move e não marca nada como lido (usa BODY.PEEK).
// Sem IMAP_USUARIO e IMAP_SENHA configurados, o recurso fica desligado.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

const MAX_POR_LEITURA = 60;
const DIAS_PRIMEIRA_LEITURA = 3;

export function configImap(env = process.env) {
  if (!env.IMAP_USUARIO || !env.IMAP_SENHA) return null;
  return { host: env.IMAP_HOST || 'imap.hostinger.com', port: Number(env.IMAP_PORTA) || 993, user: env.IMAP_USUARIO, pass: env.IMAP_SENHA };
}

const RESPOSTA_AUTOMATICA = /^(resposta autom|automatic reply|auto(matic)?[- ]?reply|auto:|ausente|ausência|out of office|fora do escrit|férias)/i;

/** Converte um e-mail bruto no formato usado pelo SDR (testável sem servidor IMAP). */
export async function lerMensagem(fonte, uid = null) {
  const m = await simpleParser(fonte, { skipImageLinks: true, skipTextToHtml: true });
  const h = (k) => String(m.headers.get(k) || '').toLowerCase();
  const de = String(m.from?.value?.[0]?.address || '').trim().toLowerCase();
  const assunto = String(m.subject || '').slice(0, 300);
  const tipo = String(m.headers.get('content-type')?.value || '').toLowerCase();
  const devolvida = /mailer-daemon|postmaster/i.test(de) || /multipart\/report/.test(tipo) || /^(undeliver|delivery status|falha na entrega|mail delivery failed|returned mail)/i.test(assunto);
  const automatica = !devolvida && ((h('auto-submitted') && h('auto-submitted') !== 'no') || !!m.headers.get('x-autoreply') || !!m.headers.get('x-autorespond') || /auto_reply|auto-reply/.test(h('precedence')) || RESPOSTA_AUTOMATICA.test(assunto));
  return { uid, de, assunto, texto: String(m.text || '').slice(0, 20000), data: (m.date || new Date()).toISOString(), messageId: String(m.messageId || ''), automatica, devolvida };
}

export function criarCaixaEntrada(config, { Cliente = ImapFlow } = {}) {
  if (!config) return null;
  return {
    usuario: config.user,
    /**
     * Mensagens novas desde o último UID lido. Na primeira leitura (ou se a caixa foi recriada),
     * pega só os últimos dias, para não importar o histórico inteiro.
     */
    async novas({ desdeUid = null, validade = null } = {}) {
      const c = new Cliente({ host: config.host, port: config.port, secure: true, auth: { user: config.user, pass: config.pass }, logger: false, socketTimeout: 60000 });
      await c.connect();
      try {
        const lock = await c.getMailboxLock('INBOX', { readOnly: true });
        try {
          const val = String(c.mailbox.uidValidity || '');
          const continuar = desdeUid && validade && validade === val;
          let uids;
          if (continuar) uids = (await c.search({ uid: `${Number(desdeUid) + 1}:*` }, { uid: true })) || [];
          else uids = (await c.search({ since: new Date(Date.now() - DIAS_PRIMEIRA_LEITURA * 864e5) }, { uid: true })) || [];
          uids = uids.filter((u) => !continuar || u > Number(desdeUid)).sort((a, b) => a - b).slice(0, MAX_POR_LEITURA);
          const mensagens = [];
          if (uids.length) {
            for await (const msg of c.fetch(uids.join(','), { uid: true, source: true }, { uid: true })) {
              try { mensagens.push(await lerMensagem(msg.source, msg.uid)); } catch (e) { console.error('[caixa] mensagem ilegível', msg.uid, e.message); }
            }
          }
          const ultimoUid = uids.length ? uids[uids.length - 1] : (continuar ? Number(desdeUid) : Math.max(0, Number(c.mailbox.uidNext || 1) - 1));
          return { validade: val, ultimoUid, mensagens };
        } finally { lock.release(); }
      } finally { await c.logout().catch(() => {}); }
    },
  };
}
