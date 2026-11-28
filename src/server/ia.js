// IA do atendimento comercial no WhatsApp: Claude Haiku 5.5 pela API da Anthropic.
// Sem ANTHROPIC_API_KEY configurada, o recurso fica desligado (as conversas vão direto para a equipe).
import Anthropic from '@anthropic-ai/sdk';

export const MODELO_IA = 'claude-haiku-5-5';

/** Formato da resposta da IA (saída estruturada): o texto para o cliente e as decisões. */
export const ESQUEMA_RESPOSTA = {
  type: 'object',
  additionalProperties: false,
  required: ['resposta', 'chamar_equipe', 'motivo', 'encerrar', 'qualificacao', 'resumo'],
  properties: {
    resposta: { type: 'string', description: 'Mensagem para o cliente, em português do Brasil' },
    chamar_equipe: { type: 'boolean', description: 'true quando uma pessoa da equipe precisa assumir a conversa' },
    motivo: { type: 'string', description: 'Por que chamar a equipe (vazio se não chamar)' },
    encerrar: { type: 'boolean', description: 'true quando a pessoa encerrou ou pediu para não receber mais mensagens' },
    resumo: { type: 'string', description: 'Resumo da conversa até aqui em uma ou duas frases' },
    qualificacao: {
      type: 'object',
      additionalProperties: false,
      required: ['nome', 'cargo', 'empresa', 'segmento', 'cidade', 'email', 'clientes_em_atraso', 'valor_em_atraso', 'tempo_atraso', 'interesse'],
      properties: {
        nome: { type: 'string' }, cargo: { type: 'string' }, empresa: { type: 'string' },
        segmento: { type: 'string', enum: ['', 'ESCOLA_CURSO', 'SAUDE', 'ACADEMIA', 'CONDOMINIO', 'VAREJO', 'DISTRIBUIDORA', 'SERVICOS', 'IMOBILIARIA', 'OUTRO'] },
        cidade: { type: 'string' }, email: { type: 'string' },
        clientes_em_atraso: { type: 'string', description: 'Quantidade aproximada, como a pessoa disse' },
        valor_em_atraso: { type: 'string', description: 'Valor aproximado, como a pessoa disse' },
        tempo_atraso: { type: 'string' },
        interesse: { type: 'string', enum: ['', 'BAIXO', 'MEDIO', 'ALTO'] },
      },
    },
  },
};

/**
 * Cliente da IA. `responder` recebe o prompt de sistema e a conversa (alternando user/assistant)
 * e devolve a decisão já convertida do JSON.
 */
export function criarIA(env = process.env, { Cliente = Anthropic } = {}) {
  if (!env.ANTHROPIC_API_KEY) return null;
  const client = new Cliente({ apiKey: env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 2 });
  return {
    modelo: MODELO_IA,
    async responder({ sistema, mensagens }) {
      const r = await client.messages.create({
        model: MODELO_IA,
        max_tokens: 4000,
        system: [{ type: 'text', text: sistema, cache_control: { type: 'ephemeral' } }],
        messages: mensagens,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA_RESPOSTA } },
      });
      if (r.stop_reason === 'refusal') return { recusa: true, uso: r.usage };
      const texto = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      if (r.stop_reason === 'max_tokens') throw new Error('Resposta da IA cortada (max_tokens)');
      return { ...JSON.parse(texto), uso: r.usage };
    },
  };
}
