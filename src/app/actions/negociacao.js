import { simular, verificarAlcada } from '../../core/negotiation.js';
import { transicao, casoAtivo, podeTransitar } from '../../core/caseStatus.js';
import { isHS, can, podeAcessarCasoHS } from '../../core/permissions.js';
import { parseDataISO } from '../../core/dates.js';
import {
  AccessError, ValidationError, requirePerm, getById, find, criar, alterar, carregarCaso, paginar, filtrosPermitidos, exigir, notificar, empresaAlvo, comNomes,
} from '../context.js';

async function levarCasoPara(ctx, caso, status, motivo, { obrigatorio = false } = {}) {
  if (caso.status_operacional === status) return caso;
  if (!podeTransitar(caso.status_operacional, status)) {
    if (obrigatorio) throw new ValidationError(`Caso em ${caso.status_operacional} não pode ir para ${status}`);
    return caso;
  }
  return alterar(ctx, 'CasoCobranca', caso, transicao(caso, status, { motivo, agora: ctx.now().toISOString() }), 'ALTERAR_STATUS_CASO');
}

export const actions = {
  /** Simulação sem persistência; já informa se está dentro da alçada. */
  simularNegociacao: {
    perm: 'negociacao.propor',
    async run(ctx, input) {
      const caso = await carregarCaso(ctx, input.caso_id);
      const div = await getById(ctx, 'Divida', caso.divida_id);
      const sim = simular({ ...input, saldo_centavos: div.saldo_atual_centavos });
      const aut = caso.autorizacao_id ? await getById(ctx, 'AutorizacaoCobranca', caso.autorizacao_id) : null;
      const alcada = isHS(ctx.user) ? verificarAlcada(sim, aut) : { dentro_alcada: can(ctx.user, 'negociacao.aprovar_empresa'), violacoes: [] };
      return { ...sim, ...alcada, limites: aut ? { limite_desconto_bps: aut.limite_desconto_bps, limite_parcelamento: aut.limite_parcelamento, entrada_minima_bps: aut.entrada_minima_bps } : null };
    },
  },

  proporNegociacao: {
    perm: 'negociacao.propor',
    async run(ctx, input) {
      const caso = await carregarCaso(ctx, input.caso_id);
      exigir(casoAtivo(caso) && !['SUSPENSO', 'CONTESTACAO', 'AGUARDANDO_VALIDACAO', 'AGUARDANDO_AUTORIZACAO'].includes(caso.status_operacional), 'Caso não permite negociação no status atual');
      if (!isHS(ctx.user)) exigir(caso.modalidade_cobranca === 'AUTOCONTRATADA', 'Em casos HS a empresa aprova propostas; quem propõe é a equipe HS');
      const abertas = (await find(ctx, 'Negociacao', { caso_id: caso.id })).filter((n) => ['AGUARDANDO_APROVACAO_CREDOR', 'APROVADA_ALCADA', 'APROVADA_CREDOR'].includes(n.status));
      exigir(!abertas.length, 'Já existe proposta em aberto para este caso; cancele-a ou formalize o acordo');
      exigir(!(await find(ctx, 'Acordo', { caso_id: caso.id })).some((a) => a.status === 'ATIVO'), 'Há um acordo ativo. Encerre-o (rompido/cancelado) antes de uma nova proposta.');
      const div = await getById(ctx, 'Divida', caso.divida_id);
      const sim = simular({ ...input, saldo_centavos: div.saldo_atual_centavos });
      let status, violacoes = [];
      if (isHS(ctx.user)) {
        const aut = await getById(ctx, 'AutorizacaoCobranca', caso.autorizacao_id);
        const r = verificarAlcada(sim, aut);
        // Alçada individual do operador (pode ser menor que a do credor)
        if (ctx.user.perfil === 'OPERADOR_HS' && Number.isSafeInteger(ctx.user.alcada_desconto_bps) && sim.desconto_bps > ctx.user.alcada_desconto_bps && r.dentro_alcada) {
          r.dentro_alcada = false; r.violacoes.push('Desconto acima da alçada individual do operador');
        }
        violacoes = r.violacoes;
        status = r.dentro_alcada && !aut.exige_aprovacao_sempre ? 'APROVADA_ALCADA' : 'AGUARDANDO_APROVACAO_CREDOR';
      } else {
        status = can(ctx.user, 'negociacao.aprovar_empresa') ? 'APROVADA_CREDOR' : 'AGUARDANDO_APROVACAO_CREDOR';
      }
      const neg = await criar(ctx, 'Negociacao', {
        empresa_id: caso.empresa_id, caso_id: caso.id, divida_id: div.id, valor_original_centavos: div.valor_original_centavos,
        saldo_base_centavos: div.saldo_atual_centavos, valor_proposto_centavos: sim.valor_proposto_centavos, desconto_bps: sim.desconto_bps,
        desconto_centavos: sim.desconto_centavos, entrada_centavos: sim.entrada_centavos, quantidade_parcelas: sim.quantidade_parcelas,
        valor_parcela_centavos: sim.valor_parcela_centavos, primeira_data_vencimento: input.primeira_data_vencimento || null,
        data_entrada: input.data_entrada || null, plano_parcelas: JSON.stringify(sim.parcelas), condicoes: input.condicoes || '',
        violacoes_alcada: violacoes, status, criado_por: ctx.user.id, data_proposta: ctx.now().toISOString(),
      }, 'PROPOR_NEGOCIACAO');
      await levarCasoPara(ctx, caso, 'EM_NEGOCIACAO');
      if (status === 'AGUARDANDO_APROVACAO_CREDOR') {
        await ctx.db.Aprovacao.create({ empresa_id: caso.empresa_id, negociacao_id: neg.id, solicitante_id: ctx.user.id, aprovador_id: null, tipo_aprovacao: violacoes.length ? 'FORA_ALCADA' : 'POLITICA_CREDOR', decisao: 'PENDENTE', justificativa: input.justificativa || violacoes.join('; '), data_decisao: null });
        await notificar(ctx, caso.empresa_id, { perfis: ['ADMIN_EMPRESA', 'FINANCEIRO_EMPRESA'], tipo: 'APROVACAO_PENDENTE', titulo: 'Proposta aguardando sua aprovação', mensagem: violacoes.join('; ') || 'Aprovação do credor necessária', link: `/negociacoes/${neg.id}` });
      }
      return neg;
    },
  },

  /** Decisão do CREDOR (ADMIN/FINANCEIRO da empresa dona do caso). HS nunca aprova fora da alçada. */
  decidirNegociacao: {
    perm: 'negociacao.aprovar_empresa',
    async run(ctx, { negociacao_id, decisao, justificativa }) {
      const neg = await getById(ctx, 'Negociacao', negociacao_id);
      if (!neg || neg.empresa_id !== ctx.user.empresa_id) throw new AccessError('Negociação não encontrada', 404);
      exigir(['APROVAR', 'REJEITAR'].includes(decisao), 'Decisão inválida');
      exigir(neg.status === 'AGUARDANDO_APROVACAO_CREDOR', 'Negociação não está aguardando aprovação');
      if (decisao === 'REJEITAR') exigir(justificativa, 'Justificativa obrigatória para rejeição');
      const apr = (await find(ctx, 'Aprovacao', { negociacao_id: neg.id })).find((a) => a.decisao === 'PENDENTE');
      const agora = ctx.now().toISOString();
      if (apr) await alterar(ctx, 'Aprovacao', apr, { aprovador_id: ctx.user.id, decisao: decisao === 'APROVAR' ? 'APROVADA' : 'REJEITADA', justificativa: justificativa || apr.justificativa, data_decisao: agora }, 'DECIDIR_APROVACAO');
      const r = await alterar(ctx, 'Negociacao', neg, { status: decisao === 'APROVAR' ? 'APROVADA_CREDOR' : 'REJEITADA', aprovado_por: ctx.user.id, data_decisao: agora }, 'DECIDIR_NEGOCIACAO');
      const caso = await getById(ctx, 'CasoCobranca', neg.caso_id);
      if (caso.operador_id) await ctx.db.Notificacao.create({ empresa_id: null, usuario_id: caso.operador_id, tipo: 'NEGOCIACAO_DECIDIDA', titulo: `Proposta ${decisao === 'APROVAR' ? 'aprovada' : 'rejeitada'} pelo credor`, mensagem: justificativa || '', lida: false, data_criacao: agora, link: `/casos/${caso.id}` });
      return r;
    },
  },

  cancelarNegociacao: {
    perm: 'negociacao.propor',
    async run(ctx, { negociacao_id, motivo }) {
      const neg = await getById(ctx, 'Negociacao', negociacao_id);
      if (!neg) throw new AccessError('Negociação não encontrada', 404);
      await carregarCaso(ctx, neg.caso_id);
      exigir(['AGUARDANDO_APROVACAO_CREDOR', 'APROVADA_ALCADA', 'APROVADA_CREDOR'].includes(neg.status), 'Negociação não pode ser cancelada');
      exigir(motivo, 'Motivo obrigatório');
      return alterar(ctx, 'Negociacao', neg, { status: 'CANCELADA', motivo_cancelamento: motivo }, 'CANCELAR_NEGOCIACAO');
    },
  },

  /** Formaliza acordo a partir de proposta aprovada; gera parcelas do acordo. */
  formalizarAcordo: {
    perm: 'negociacao.propor',
    async run(ctx, input) {
      const neg = await getById(ctx, 'Negociacao', input.negociacao_id);
      if (!neg) throw new AccessError('Negociação não encontrada', 404);
      const caso = await carregarCaso(ctx, neg.caso_id);
      exigir(['APROVADA_ALCADA', 'APROVADA_CREDOR'].includes(neg.status), 'A proposta precisa estar aprovada (alçada ou credor)');
      exigir(input.aceite_devedor === true, 'Registre o aceite do devedor');
      const div = await getById(ctx, 'Divida', caso.divida_id);
      exigir(div.saldo_atual_centavos === neg.saldo_base_centavos, 'O saldo da dívida mudou desde a proposta; refaça a simulação');
      exigir(caso.status_operacional === 'ACORDO_AGUARDANDO_PAGAMENTO' || podeTransitar(caso.status_operacional, 'ACORDO_AGUARDANDO_PAGAMENTO'), `Caso em ${caso.status_operacional} não permite formalizar acordo`);
      const agora = ctx.now().toISOString();
      const acordo = await criar(ctx, 'Acordo', {
        empresa_id: caso.empresa_id, caso_id: caso.id, divida_id: div.id, negociacao_id: neg.id, valor_acordado_centavos: neg.valor_proposto_centavos,
        desconto_centavos: neg.desconto_centavos, entrada_centavos: neg.entrada_centavos, quantidade_parcelas: neg.quantidade_parcelas,
        status: 'ATIVO', data_aceite: input.data_aceite ? parseDataISO(input.data_aceite) : agora.slice(0, 10), meio_aceite: input.meio_aceite || 'WHATSAPP',
        documento: input.documento || null, responsavel_aprovacao: neg.aprovado_por || neg.criado_por, formalizado_por: ctx.user.id,
      }, 'FORMALIZAR_ACORDO');
      const parcelas = [];
      if (neg.entrada_centavos > 0) parcelas.push({ numero: 0, valor_centavos: neg.entrada_centavos, vencimento: neg.data_entrada || agora.slice(0, 10) });
      parcelas.push(...JSON.parse(neg.plano_parcelas || '[]'));
      for (const p of parcelas) {
        await ctx.db.Parcela.create({ empresa_id: caso.empresa_id, divida_id: div.id, acordo_id: acordo.id, numero: p.numero, valor_original_centavos: p.valor_centavos, vencimento: p.vencimento, saldo_centavos: p.valor_centavos, status: 'EM_ABERTO' });
      }
      await alterar(ctx, 'Negociacao', neg, { status: 'CONVERTIDA_EM_ACORDO' }, 'CONVERTER_NEGOCIACAO');
      await alterar(ctx, 'Divida', div, { status_financeiro: 'EM_ACORDO' }, 'DIVIDA_EM_ACORDO');
      await levarCasoPara(ctx, await getById(ctx, 'CasoCobranca', caso.id), 'ACORDO_AGUARDANDO_PAGAMENTO', null, { obrigatorio: true });
      await notificar(ctx, caso.empresa_id, { perfis: ['ADMIN_EMPRESA', 'FINANCEIRO_EMPRESA'], tipo: 'ACORDO_FORMALIZADO', titulo: 'Acordo formalizado', mensagem: `Acordo de ${neg.quantidade_parcelas + (neg.entrada_centavos > 0 ? 1 : 0)} pagamento(s) registrado. O devedor pagará diretamente à empresa.`, link: `/acordos/${acordo.id}` });
      return { acordo, parcelas: parcelas.length };
    },
  },

  /** Quebra/cancelamento de acordo: restaura status da dívida; saldo só muda por pagamentos confirmados. */
  encerrarAcordo: {
    perm: null,
    async run(ctx, { acordo_id, motivo, status = 'ROMPIDO' }) {
      const acordo = await getById(ctx, 'Acordo', acordo_id);
      if (!acordo) throw new AccessError('Acordo não encontrado', 404);
      const caso = await carregarCaso(ctx, acordo.caso_id);
      if (isHS(ctx.user)) requirePerm(ctx.user, 'negociacao.propor'); else requirePerm(ctx.user, 'negociacao.aprovar_empresa');
      exigir(acordo.status === 'ATIVO', 'Acordo não está ativo');
      exigir(['ROMPIDO', 'CANCELADO'].includes(status) && motivo, 'Status e motivo obrigatórios');
      const pend = (await find(ctx, 'Pagamento', { acordo_id: acordo.id })).filter((p) => ['INFORMADO', 'EM_CONFIRMACAO'].includes(p.status_confirmacao));
      exigir(!pend.length, 'Há pagamentos aguardando confirmação neste acordo');
      await alterar(ctx, 'Acordo', acordo, { status, motivo_encerramento: motivo }, 'ENCERRAR_ACORDO');
      for (const p of (await find(ctx, 'Parcela', { acordo_id: acordo.id })).filter((x) => x.saldo_centavos > 0)) await ctx.db.Parcela.update(p.id, { status: 'CANCELADA' });
      const div = await getById(ctx, 'Divida', acordo.divida_id);
      await alterar(ctx, 'Divida', div, { status_financeiro: div.saldo_atual_centavos < div.valor_original_centavos + (div.encargos_centavos || 0) ? 'PARCIALMENTE_PAGA' : 'EM_ABERTO' }, 'DIVIDA_ACORDO_ENCERRADO');
      await levarCasoPara(ctx, caso, 'EM_NEGOCIACAO');
      return { ok: true };
    },
  },

  listarNegociacoes: {
    perm: null,
    async run(ctx, input = {}) {
      return listarPorCaso(ctx, 'Negociacao', input, ['status', 'caso_id']);
    },
  },

  listarAcordos: {
    perm: null,
    async run(ctx, input = {}) {
      return listarPorCaso(ctx, 'Acordo', input, ['status', 'caso_id']);
    },
  },

  listarAprovacoesPendentes: {
    perm: 'negociacao.aprovar_empresa',
    async run(ctx, input = {}) {
      const rows = (await find(ctx, 'Negociacao', { empresa_id: ctx.user.empresa_id, status: 'AGUARDANDO_APROVACAO_CREDOR' }));
      return comNomes(ctx, paginar(rows, { ...input, ordenarPor: 'data_proposta' }));
    },
  },
};

/** Listagem escopada: empresa vê os seus; HS vê apenas os de casos a que tem acesso. */
export async function listarPorCaso(ctx, entidade, input, permitidos) {
  let rows;
  if (!isHS(ctx.user)) {
    requirePerm(ctx.user, 'caso.ler_empresa');
    rows = await find(ctx, entidade, { empresa_id: ctx.user.empresa_id });
  } else {
    if (ctx.user.perfil === 'SUPERADMIN_HS' && input.empresa_id) rows = await find(ctx, entidade, { empresa_id: await empresaAlvo(ctx, input) });
    else {
      const todos = await find(ctx, entidade);
      const cache = new Map();
      rows = [];
      for (const r of todos) {
        if (!r.caso_id) continue;
        if (!cache.has(r.caso_id)) cache.set(r.caso_id, podeAcessarCasoHS(ctx.user, await getById(ctx, 'CasoCobranca', r.caso_id)));
        if (cache.get(r.caso_id)) rows.push(r);
      }
    }
  }
  const q = filtrosPermitidos(input.filtros, permitidos);
  rows = rows.filter((r) => Object.entries(q).every(([k, v]) => r[k] === v));
  return comNomes(ctx, paginar(rows, input));
}
