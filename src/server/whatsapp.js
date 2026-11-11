// WhatsApp Business Platform (Cloud API oficial da Meta).
// Ativa somente com WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID; sem isso, o envio segue manual.
import { createHmac, timingSafeEqual } from 'node:crypto';

export function configWhatsApp(env = process.env) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) return null;
  return {
    token: env.WHATSAPP_TOKEN, phoneId: env.WHATSAPP_PHONE_NUMBER_ID, versao: env.WHATSAPP_API_VERSION || 'v21.0',
    base: env.WHATSAPP_GRAPH_URL || 'https://graph.facebook.com',
    verifyToken: env.WHATSAPP_VERIFY_TOKEN || '', appSecret: env.WHATSAPP_APP_SECRET || '',
  };
}

export function criarWhatsApp({ config, fetchImpl = fetch } = {}) {
  async function postar(corpo) {
    let r;
    try {
      r = await fetchImpl(`${config.base || 'https://graph.facebook.com'}/${config.versao}/${config.phoneId}/messages`, {
        method: 'POST', signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
      });
    } catch (err) {
      console.error('[whatsapp]', err.message);
      throw Object.assign(new Error('Não foi possível conectar ao WhatsApp Business agora. Nada foi registrado; tente de novo ou use o envio manual.'), { status: 502 });
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.messages?.[0]?.id) {
      const e = new Error(`WhatsApp recusou o envio: ${j.error?.message || r.status}`);
      e.status = 502;
      throw e;
    }
    return j.messages[0].id;
  }
  return {
    disponivel: !!config,
    enviarTexto: (para, texto) => postar({ messaging_product: 'whatsapp', recipient_type: 'individual', to: para, type: 'text', text: { preview_url: false, body: texto } }),
    enviarModelo: (para, nome, idioma, parametros) => postar({
      messaging_product: 'whatsapp', to: para, type: 'template',
      template: { name: nome, language: { code: idioma || 'pt_BR' }, components: parametros.length ? [{ type: 'body', parameters: parametros.map((t) => ({ type: 'text', text: String(t) })) }] : [] },
    }),
    /** Verificação do webhook (GET hub.challenge). */
    desafio(params) {
      if (!config || params.get('hub.mode') !== 'subscribe' || !config.verifyToken) return null;
      return params.get('hub.verify_token') === config.verifyToken ? params.get('hub.challenge') : null;
    },
    /** Assinatura X-Hub-Signature-256 do corpo bruto com o App Secret. */
    assinaturaValida(corpoBruto, cabecalho) {
      if (!config?.appSecret || !cabecalho?.startsWith('sha256=')) return false;
      const esperado = Buffer.from('sha256=' + createHmac('sha256', config.appSecret).update(corpoBruto).digest('hex'));
      const recebido = Buffer.from(cabecalho);
      return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
    },
  };
}
