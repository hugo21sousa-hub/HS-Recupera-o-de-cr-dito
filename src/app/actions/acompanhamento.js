// Acompanhamento comercial: cadência de follow-up (dias 3, 7 e 14 após a primeira abordagem),
// pessoa que decide e programa de indicação (parceiros, como escritórios de contabilidade).
import { emailValido, somenteDigitos } from '../../core/documento.js';
import { parseReais } from '../../core/money.js';
import { AccessError, getById, find, criar, alterar, exigir, notificar } from '../context.js';
import { epocaDoMes, mesBrasilia } from '../comercial/epoca.js';

export const DIAS_CADENCIA = [3, 7, 14];
const somaDias = (iso, d) => new Date(Date.parse(`${iso}T12:00:00Z`) + d * 864e5).toISOString().slice(0, 10);
export const hojeBrasilia = (ctx) => new Date(ctx.now().getTime() - 3 * 3600e3).toISOString().slice(0, 10);
const ENCERRADOS = ['CONVERTIDO', 'PERDIDO', 'DIAGNOSTICO_ENVIADO'];

/** O que fazer em cada follow-up (etapa 0 = dia 3, 1 = dia 7, 2 = dia 14). */
export const PASSOS_CADENCIA = [
  { dia: 3, titulo: 'Lembrete curto', descricao: 'Pergunte se viu a mensagem e ofereça o link do diagnóstico.' },
  { dia: 7, titulo: 'Algo útil', descricao: 'Mande uma dica ou o vídeo de 1 minuto, sem pressão.' },
  { dia: 14, titulo: 'Última mensagem', descricao: 'Encerre com educação e deixe a porta aberta.' },
];

export function textoFollowup(ctx, lead, etapa) {
  const nome = String(lead.decisor_nome || (lead.nome !== lead.email ? lead.nome : '') || '').trim().split(' ')[0];
  const ola = nome ? `Olá, ${nome}!` : 'Olá!';
  const quem = ctx.user?.nome ? `Aqui é ${ctx.user.nome.split(' ')[0]}, da HS Recuperação de Crédito (Acorly).` : 'Aqui é da HS Recuperação de Crédito (Acorly).';
  const treze = epocaDoMes(mesBrasilia(ctx)).decimo_terceiro;
  if (etapa === 0) return `${ola} ${quem} Conseguiu ver a minha mensagem sobre a recuperação dos valores em atraso da ${lead.empresa}? Se quiser, te mando o link do diagnóstico gratuito: você envia a lista de atrasados e em até 2 dias úteis mostramos quanto dá para recuperar.`;
  if (etapa === 1) return `${ola} ${quem} Uma dica rápida: ${treze ? 'dezembro é o mês em que mais se recupera dívida, porque o devedor recebeu o 13º e quer começar o ano limpo. Quem começa a cobrar só em janeiro perde essa janela.' : 'quanto mais antiga a dívida, menor a chance de receber. Cobrar cedo, com respeito, faz toda a diferença.'} Neste vídeo de 1 minuto mostro como funciona: https://acorly.com.br/#video`;
  return `${ola} ${quem} Vou encerrar por aqui para não incomodar. Se em algum momento quiser saber quanto da carteira da ${lead.empresa} dá para recuperar, o diagnóstico continua gratuito: https://acorly.com.br/diagnostico`;
}

/** Inicia a cadência na primeira abordagem (se ainda não houver uma). */
export async function iniciarCadencia(ctx, lead) {
  if (lead.cadencia_inicio || ENCERRADOS.includes(lead.status)) return lead;
  const hoje = hojeBrasilia(ctx);
  return ctx.db.Lead.update(lead.id, { cadencia_inicio: hoje, cadencia_etapa: 0, proximo_followup: somaDias(hoje, DIAS_CADENCIA[0]), cadencia_fim: null });
}

/** Registra um follow-up feito e agenda o próximo (ou conclui a cadência). */
export async function avancarCadencia(ctx, lead, { canal, observacao = '' } = {}) {
  const etapa = Number(lead.cadencia_etapa || 0);
  const proxima = etapa + 1;
  const hoje = hojeBrasilia(ctx);
  const nota = `${hoje}: follow-up ${proxima} (${PASSOS_CADENCIA[etapa]?.titulo || 'contato'}) por ${canal === 'EMAIL' ? 'e-mail' : canal === 'TELEFONE' ? 'telefone' : 'WhatsApp'}${observacao ? ` — ${observacao}` : ''}`;
  const patch = { cadencia_etapa: proxima, observacoes: `${lead.observacoes ? `${lead.observacoes}\n` : ''}${nota}` };
  if (proxima >= DIAS_CADENCIA.length) Object.assign(patch, { proximo_followup: null, cadencia_fim: 'Concluída sem resposta' });
  else {
    const previsto = somaDias(lead.cadencia_inicio || hoje, DIAS_CADENCIA[proxima]);
    patch.proximo_followup = previsto <= hoje ? somaDias(hoje, 2) : previsto;
  }
  return alterar(ctx, 'Lead', lead, patch, 'FOLLOWUP_LEAD');
}

export const cadenciaAtiva = (l) => !!l.proximo_followup && !ENCERRADOS.includes(l.status);
export const followupVencido = (ctx, l) => cadenciaAtiva(l) && l.proximo_followup <= hojeBrasilia(ctx);

/** Aviso diário (uma vez por dia) dos follow-ups do dia para o superadmin. */
export async function avisoFollowups(ctx) {
  const hoje = hojeBrasilia(ctx);
  const cfg = (await find(ctx, 'ConfiguracaoHS', {}))[0] || await ctx.db.ConfiguracaoHS.create({});
  if (cfg.aviso_followup_em === hoje) return 0;
  const vencidos = (await find(ctx, 'Lead', {})).filter((l) => followupVencido(ctx, l));
  await ctx.db.ConfiguracaoHS.update(cfg.id, { aviso_followup_em: hoje });
  if (!vencidos.length) return 0;
  await notificar(ctx, null, { perfis: ['SUPERADMIN_HS'], tipo: 'LEAD', titulo: `${vencidos.length} follow-up(s) para hoje`, mensagem: vencidos.slice(0, 8).map((l) => l.empresa).join(', ') + (vencidos.length > 8 ? '…' : ''), link: '/hs/leads' });
  return vencidos.length;
}

// ---------- Programa de indicação ----------
export const slugParceiro = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
export const REGRA_COMISSAO_PADRAO = '10% do valor que a HS receber do cliente indicado nos primeiros 12 meses, pago até o dia 10 do mês seguinte ao recebimento.';

export async function parceiroPorCodigo(ctx, codigo) {
  const c = slugParceiro(codigo);
  if (!c) return null;
  return (await find(ctx, 'Parceiro', { codigo: c })).find((p) => p.status === 'ATIVO') || null;
}

const linkIndicacao = (ctx, p) => `${ctx.urlBase || 'https://acorly.com.br'}/diagnostico?ref=${p.codigo}`;

function textoDivulgacao(ctx, p) {
  return `Olá! Indico a HS Recuperação de Crédito (Acorly) para recuperar valores em atraso de forma organizada e respeitosa: o devedor paga direto para a sua empresa e, na cobrança gerenciada, só se paga sobre o que for recuperado. Eles fazem um diagnóstico gratuito da sua carteira: ${linkIndicacao(ctx, p)}`;
}

export const actions = {
  /** Registra um follow-up feito por WhatsApp/telefone/e-mail externo. */
  registrarFollowupLead: {
    perm: 'lead.gerenciar',
    async run(ctx, { id, canal = 'WHATSAPP', observacao }) {
      const l = await getById(ctx, 'Lead', id);
      if (!l) throw new AccessError('Contato não encontrado', 404);
      exigir(['WHATSAPP', 'TELEFONE', 'EMAIL'].includes(canal), 'Canal inválido');
      exigir(cadenciaAtiva(l), 'Este contato não tem follow-up pendente');
      return avancarCadencia(ctx, l, { canal, observacao: String(observacao || '').slice(0, 500) });
    },
  },

  /** Para a cadência (respondeu, não tem interesse, pediu para não contatar…). */
  encerrarCadenciaLead: {
    perm: 'lead.gerenciar',
    async run(ctx, { id, motivo }) {
      const l = await getById(ctx, 'Lead', id);
      if (!l) throw new AccessError('Contato não encontrado', 404);
      const m = String(motivo || 'Encerrada manualmente').slice(0, 200);
      return alterar(ctx, 'Lead', l, { proximo_followup: null, cadencia_fim: m, observacoes: `${l.observacoes ? `${l.observacoes}\n` : ''}${hojeBrasilia(ctx)}: cadência encerrada — ${m}` }, 'ENCERRAR_CADENCIA');
    },
  },

  /** Inicia (ou reinicia) a cadência para um contato. */
  iniciarCadenciaLead: {
    perm: 'lead.gerenciar',
    async run(ctx, { id }) {
      const l = await getById(ctx, 'Lead', id);
      if (!l) throw new AccessError('Contato não encontrado', 404);
      exigir(!ENCERRADOS.includes(l.status), 'Contato já convertido, perdido ou com diagnóstico enviado');
      const hoje = hojeBrasilia(ctx);
      return ctx.db.Lead.update(l.id, { cadencia_inicio: hoje, cadencia_etapa: 0, proximo_followup: somaDias(hoje, DIAS_CADENCIA[0]), cadencia_fim: null });
    },
  },

  /** WhatsApp com a mensagem do follow-up da vez. */
  whatsappLead: {
    perm: 'lead.gerenciar',
    async run(ctx, { id }) {
      const l = await getById(ctx, 'Lead', id);
      if (!l) throw new AccessError('Contato não encontrado', 404);
      const direto = somenteDigitos(l.decisor_contato);
      const n = direto.length >= 10 && direto.length <= 13 ? direto : somenteDigitos(l.whatsapp);
      exigir(n.length >= 10, 'Este contato não tem WhatsApp');
      const texto = textoFollowup(ctx, l, Math.min(Number(l.cadencia_etapa || 0), 2));
      return { link: `https://wa.me/${n.length <= 11 ? `55${n}` : n}?text=${encodeURIComponent(texto)}`, mensagem: texto };
    },
  },

  /** Calendário comercial do mês e passos da cadência (para a tela). */
  epocaComercial: {
    perm: 'lead.gerenciar',
    async run(ctx) { return { ...epocaDoMes(mesBrasilia(ctx)), passos: PASSOS_CADENCIA }; },
  },

  listarParceiros: {
    perm: 'lead.gerenciar',
    async run(ctx) {
      const [parceiros, leads, pags] = await Promise.all([find(ctx, 'Parceiro', {}), find(ctx, 'Lead', {}), find(ctx, 'PagamentoParceiro', {})]);
      return parceiros.sort((a, b) => (a.nome > b.nome ? 1 : -1)).map((p) => {
        const ind = leads.filter((l) => l.parceiro_id === p.id);
        return {
          ...p, link: linkIndicacao(ctx, p), texto_divulgacao: textoDivulgacao(ctx, p),
          indicados: ind.length, convertidos: ind.filter((l) => l.status === 'CONVERTIDO').length,
          pago_centavos: pags.filter((x) => x.parceiro_id === p.id).reduce((a, x) => a + (x.valor_centavos || 0), 0),
        };
      });
    },
  },

  salvarParceiro: {
    perm: 'lead.gerenciar',
    async run(ctx, input) {
      const t = (v, m) => String(v ?? '').trim().slice(0, m);
      const dados = {
        nome: t(input.nome, 120), empresa: t(input.empresa, 160), email: t(input.email, 160).toLowerCase(), whatsapp: somenteDigitos(input.whatsapp).slice(0, 13),
        tipo: input.tipo === 'OUTRO' ? 'OUTRO' : 'CONTABILIDADE', regra_comissao: t(input.regra_comissao, 500) || REGRA_COMISSAO_PADRAO,
        chave_pix: t(input.chave_pix, 140), status: input.status === 'INATIVO' ? 'INATIVO' : 'ATIVO', observacoes: t(input.observacoes, 2000),
      };
      exigir(dados.nome.length >= 2, 'Informe o nome do parceiro');
      exigir(!dados.email || emailValido(dados.email), 'E-mail inválido');
      const codigo = slugParceiro(input.codigo || dados.empresa || dados.nome);
      exigir(codigo.length >= 3, 'Código do link muito curto');
      const mesmo = (await find(ctx, 'Parceiro', { codigo })).find((p) => p.id !== input.id);
      exigir(!mesmo, `O código "${codigo}" já é de outro parceiro`);
      if (input.id) {
        const p = await getById(ctx, 'Parceiro', input.id);
        if (!p) throw new AccessError('Parceiro não encontrado', 404);
        return alterar(ctx, 'Parceiro', p, { ...dados, codigo }, 'EDITAR_PARCEIRO');
      }
      return criar(ctx, 'Parceiro', { ...dados, codigo, criado_em: ctx.now().toISOString() }, 'CRIAR_PARCEIRO');
    },
  },

  indicacoesDoParceiro: {
    perm: 'lead.gerenciar',
    async run(ctx, { id }) {
      const p = await getById(ctx, 'Parceiro', id);
      if (!p) throw new AccessError('Parceiro não encontrado', 404);
      const leads = (await find(ctx, 'Lead', { parceiro_id: id })).map((l) => ({ id: l.id, empresa: l.empresa, status: l.status, recebido_em: l.recebido_em }));
      const pagamentos = (await find(ctx, 'PagamentoParceiro', { parceiro_id: id })).sort((a, b) => ((a.pago_em || '') < (b.pago_em || '') ? 1 : -1));
      return { leads, pagamentos };
    },
  },

  registrarPagamentoParceiro: {
    perm: 'lead.gerenciar',
    async run(ctx, { parceiro_id, lead_id, valor, pago_em, descricao }) {
      const p = await getById(ctx, 'Parceiro', parceiro_id);
      if (!p) throw new AccessError('Parceiro não encontrado', 404);
      let v = null;
      try { v = parseReais(valor); } catch { v = null; }
      exigir(v && v > 0, 'Informe o valor pago');
      exigir(/^\d{4}-\d{2}-\d{2}$/.test(pago_em || ''), 'Informe a data do pagamento');
      if (lead_id) exigir((await getById(ctx, 'Lead', lead_id))?.parceiro_id === p.id, 'Esse cliente não foi indicado por este parceiro');
      return criar(ctx, 'PagamentoParceiro', { parceiro_id: p.id, lead_id: lead_id || null, valor_centavos: v, pago_em, descricao: String(descricao || '').slice(0, 300), registrado_por: ctx.user.id, registrado_em: ctx.now().toISOString() }, 'PAGAR_PARCEIRO');
    },
  },
};
