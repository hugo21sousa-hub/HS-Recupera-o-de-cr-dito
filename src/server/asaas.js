// Gateway de pagamento da ASSINATURA da plataforma (Asaas). Nunca é usado para valores de dívidas.
// Ativa somente com ASAAS_API_KEY; webhook protegido por ASAAS_WEBHOOK_TOKEN.
export function configAsaas(env = process.env) {
  if (!env.ASAAS_API_KEY) return null;
  return {
    chave: env.ASAAS_API_KEY,
    base: env.ASAAS_BASE_URL || (env.ASAAS_AMBIENTE === 'producao' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3'),
    webhookToken: env.ASAAS_WEBHOOK_TOKEN || '',
    ambiente: env.ASAAS_BASE_URL ? 'personalizado' : (env.ASAAS_AMBIENTE === 'producao' ? 'producao' : 'sandbox'),
  };
}

export function criarAsaas({ config, fetchImpl = fetch } = {}) {
  async function req(metodo, caminho, corpo) {
    let r;
    try {
      r = await fetchImpl(config.base + caminho, {
        method: metodo, signal: AbortSignal.timeout(15000),
        headers: { access_token: config.chave, 'Content-Type': 'application/json', 'User-Agent': 'hs-recuperacao-credito' },
        body: corpo ? JSON.stringify(corpo) : undefined,
      });
    } catch (err) {
      console.error('[asaas]', err.message);
      throw Object.assign(new Error('Não foi possível conectar ao sistema de pagamentos agora. Tente novamente em instantes.'), { status: 502 });
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(`Asaas: ${j.errors?.map((x) => x.description).join('; ') || r.status}`);
      e.status = 502;
      throw e;
    }
    return j;
  }
  const reais = (c) => Number((c / 100).toFixed(2));
  return {
    disponivel: !!config,
    ambiente: config?.ambiente || null,
    criarCliente: ({ nome, cpfCnpj, email, telefone, referencia }) => req('POST', '/customers', { name: nome, cpfCnpj, email, mobilePhone: telefone, externalReference: referencia, notificationDisabled: false }),
    criarAssinatura: ({ cliente, valorCentavos, vencimento, descricao, referencia }) => req('POST', '/subscriptions', { customer: cliente, billingType: 'UNDEFINED', value: reais(valorCentavos), nextDueDate: vencimento, cycle: 'MONTHLY', description: descricao, externalReference: referencia }),
    cobrancasDaAssinatura: (id) => req('GET', `/subscriptions/${encodeURIComponent(id)}/payments`),
    cancelarAssinatura: (id) => req('DELETE', `/subscriptions/${encodeURIComponent(id)}`),
    /**
     * Avisos automáticos do Asaas ao cliente: fatura criada, lembrete antes do vencimento, vencimento,
     * atraso e pagamento recebido, só por e-mail (SMS, ligação e WhatsApp desligados para não gerar custo).
     */
    async configurarNotificacoes(clienteId) {
      const lista = (await req('GET', `/customers/${encodeURIComponent(clienteId)}/notifications`)).data || [];
      const desejados = new Set(['PAYMENT_CREATED', 'PAYMENT_DUEDATE_WARNING', 'PAYMENT_OVERDUE', 'PAYMENT_RECEIVED']);
      const notifications = lista.map((n) => ({
        id: n.id, enabled: desejados.has(n.event) ? true : n.enabled,
        emailEnabledForCustomer: desejados.has(n.event) ? true : n.emailEnabledForCustomer,
        smsEnabledForCustomer: false, phoneCallEnabledForCustomer: false, whatsappEnabledForCustomer: false,
        emailEnabledForProvider: n.emailEnabledForProvider, smsEnabledForProvider: false,
        ...(n.scheduleOffset !== undefined ? { scheduleOffset: n.scheduleOffset } : {}),
      }));
      if (notifications.length) await req('POST', '/notifications/batch', { customer: clienteId, notifications });
      return notifications.length;
    },
    webhookValido: (token) => !!config?.webhookToken && token === config.webhookToken,
  };
}
