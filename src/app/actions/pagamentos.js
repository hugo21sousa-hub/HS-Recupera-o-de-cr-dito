import { detectarDuplicidade, validarPagamentoInformado, calcularConfirmacao, statusCasoAposConfirmacao } from '../../core/payments.js';
import { transicao, podeTransitar, casoAtivo } from '../../core/caseStatus.js';
import { isHS } from '../../core/permissions.js';
import { calcularComissao } from '../../core/comissao.js';
import {
  AccessError, ValidationError, requirePerm, getById, find, criar, alterar, auditar, carregarCaso, carregarDaEmpresa,
  exigir, notificar, paginar, filtrosPermitidos, comNomes,
} from '../context.js';
import { listarPorCaso } from './negociacao.js';
import { comissaoDoCaso } from './comercial.js';

async function casoDaDivida(ctx, divida_id) {
  return (await find(ctx, 'CasoCobranca', { divida_id })).find(casoAtivo) || null;
}

async function moverCaso(ctx, caso, para, motivo) {
  if (!caso || caso.status_operacional === para || !podeTransitar(caso.status_operacional, para)) return caso;
  return alterar(ctx, 'CasoCobranca', caso, transicao(caso, para, { motivo, agora: ctx.now().toISOString() }), 'ALTERAR_STATUS_CASO');
}

export const actions = {
  /**
   * Registra pagamento INFORMADO (pelo devedor via operador, ou pela empresa).
   * Não altera saldo: saldo só muda na confirmação pelo credor.
   */
  informarPagamento: {
    perm: 'pagamento.informar',
    async run(ctx, input) {
      let divida, caso = null;
      if (input.caso_id) {
        caso = await carregarCaso(ctx, input.caso_id);
        divida = await getById(ctx, 'Divida', caso.divida_id);
      } else {
        exigir(!isHS(ctx.user), 'Equipe HS informa pagamentos a partir do caso');
        divida = await carregarDaEmpresa(ctx, 'Divida', input.divida_id, input);
        caso = await casoDaDivida(ctx, divida.id);
      }
      if (caso && isHS(ctx.user)) exigir(caso.status_operacional !== 'SUSPENSO', 'Caso suspenso');
      const novo = {
        divida_id: divida.id, parcela_id: input.parcela_id || null, valor_centavos: input.valor_centavos, data_informada: input.data_informada,
        identificador_transacao: input.identificador_transacao ? String(input.identificador_transacao).trim() : null,
      };
      validarPagamentoInformado(novo, divida);
      exigir(novo.valor_centavos <= divida.saldo_atual_centavos, 'Valor informado maior que o saldo da dívida');
      let acordo_id = input.acordo_id || null;
      if (novo.parcela_id) {
        const parc = await getById(ctx, 'Parcela', novo.parcela_id);
        exigir(parc && parc.divida_id === divida.id && parc.empresa_id === divida.empresa_id, 'Parcela não pertence à dívida');
        exigir(parc.saldo_centavos > 0 && !['CANCELADA', 'SUBSTITUIDA'].includes(parc.status), 'Parcela sem saldo');
        exigir(novo.valor_centavos <= parc.saldo_centavos, 'Valor maior que o saldo da parcela');
        acordo_id = parc.acordo_id || acordo_id;
      }
      if (acordo_id) {
        const ac = await getById(ctx, 'Acordo', acordo_id);
        exigir(ac && ac.divida_id === divida.id && ac.status === 'ATIVO', 'Acordo inválido ou inativo');
      }
      if (input.comprovante_file_uri && ctx.files?.reivindicar) exigir(await ctx.files.reivindicar(input.comprovante_file_uri, ctx.authEmail), 'Comprovante inválido ou já utilizado');
      const existentes = await find(ctx, 'Pagamento', { divida_id: divida.id });
      const dup = detectarDuplicidade(novo, existentes);
      if (dup) throw new ValidationError(`Pagamento duplicado: já existe registro ${dup.id} (${dup.status_confirmacao})`);
      const pag = await criar(ctx, 'Pagamento', {
        empresa_id: divida.empresa_id, divida_id: divida.id, caso_id: caso?.id || null, parcela_id: novo.parcela_id, acordo_id,
        valor_centavos: novo.valor_centavos, data_informada: novo.data_informada, forma_pagamento: input.forma_pagamento || 'PIX',
        identificador_transacao: novo.identificador_transacao, comprovante: input.comprovante_file_uri || null,
        status_confirmacao: 'INFORMADO', informado_por: ctx.user.id, informado_por_perfil: ctx.user.perfil,
        data_confirmacao: null, confirmado_por: null, valor_confirmado_centavos: null,
      }, 'INFORMAR_PAGAMENTO');
      if (caso) await moverCaso(ctx, caso, 'PAGAMENTO_INFORMADO');
      await notificar(ctx, divida.empresa_id, { perfis: ['ADMIN_EMPRESA', 'FINANCEIRO_EMPRESA'], tipo: 'PAGAMENTO_INFORMADO', titulo: 'Pagamento informado — confira o recebimento', mensagem: `Valor informado aguardando sua conferência.`, link: `/pagamentos/${pag.id}` });
      // Auto-confirmação somente se quem informa é o próprio credor e pediu expressamente
      if (input.confirmar_agora === true && !isHS(ctx.user)) return actions.confirmarPagamento.run(ctx, { pagamento_id: pag.id, evidencia: input.evidencia, observacao: 'Registrado e confirmado pelo credor' });
      return pag;
    },
  },

  /** Empresa sinaliza que está conferindo o pagamento (opcional). */
  iniciarConferencia: {
    perm: 'pagamento.confirmar',
    async run(ctx, { pagamento_id }) {
      const pag = await carregarDaEmpresa(ctx, 'Pagamento', pagamento_id);
      exigir(pag.status_confirmacao === 'INFORMADO', 'Pagamento não está como informado');
      const r = await alterar(ctx, 'Pagamento', pag, { status_confirmacao: 'EM_CONFIRMACAO' }, 'CONFERIR_PAGAMENTO');
      if (pag.caso_id) await moverCaso(ctx, await getById(ctx, 'CasoCobranca', pag.caso_id), 'PAGAMENTO_EM_CONFIRMACAO');
      return r;
    },
  },

  /**
   * Confirmação pelo CREDOR. Proteções: perfil de empresa, mesma empresa, status, valor ≤ saldo,
   * e trava otimista contra confirmação dupla concorrente.
   */
  confirmarPagamento: {
    perm: 'pagamento.confirmar',
    async run(ctx, input) {
      exigir(!isHS(ctx.user), 'Somente o credor confirma pagamentos');
      const pag = await carregarDaEmpresa(ctx, 'Pagamento', input.pagamento_id);
      const divida = await getById(ctx, 'Divida', pag.divida_id);
      const parcela = pag.parcela_id ? await getById(ctx, 'Parcela', pag.parcela_id) : null;
      const efeitos = calcularConfirmacao({ pagamento: pag, divida, parcela, valor_confirmado_centavos: input.valor_confirmado_centavos });
      const agora = ctx.now().toISOString();

      // Trava otimista: grava a confirmação e verifica se é a primeira para este pagamento
      const conf = await ctx.db.ConfirmacaoPagamento.create({ empresa_id: pag.empresa_id, pagamento_id: pag.id, confirmado_por: ctx.user.id, data_confirmacao: agora, evidencia: input.evidencia || null, observacao: input.observacao || '', valor_confirmado_centavos: efeitos.pagamento.valor_confirmado_centavos, status: 'VALIDA' });
      const confs = (await find(ctx, 'ConfirmacaoPagamento', { pagamento_id: pag.id })).filter((c) => c.status === 'VALIDA')
        .sort((a, b) => (a.created_date === b.created_date ? (a.id < b.id ? -1 : 1) : a.created_date < b.created_date ? -1 : 1));
      if (confs[0].id !== conf.id) {
        await ctx.db.ConfirmacaoPagamento.update(conf.id, { status: 'DESCARTADA_DUPLICIDADE' });
        throw new ValidationError('Pagamento já confirmado (duplicidade bloqueada)');
      }
      // Releitura do saldo imediatamente antes de gravar (reduz janela de corrida)
      const divAtual = await getById(ctx, 'Divida', divida.id);
      if (divAtual.saldo_atual_centavos !== divida.saldo_atual_centavos) {
        await ctx.db.ConfirmacaoPagamento.update(conf.id, { status: 'DESCARTADA_CONCORRENCIA' });
        throw new ValidationError('Saldo alterado durante a confirmação; tente novamente');
      }
      // Comissão da HS: só em casos de cobrança gerenciada e só sobre o valor confirmado
      const casoPag = pag.caso_id ? await getById(ctx, 'CasoCobranca', pag.caso_id) : await casoDaDivida(ctx, divida.id);
      const cm = await comissaoDoCaso(ctx, casoPag, divida);
      const comissao = cm ? { comissao_bps: cm.bps, comissao_hs_centavos: calcularComissao(efeitos.pagamento.valor_confirmado_centavos, cm.bps) } : { comissao_bps: 0, comissao_hs_centavos: 0 };
      await alterar(ctx, 'Pagamento', pag, { ...efeitos.pagamento, ...comissao, data_confirmacao: agora, confirmado_por: ctx.user.id }, 'CONFIRMAR_PAGAMENTO');
      await ctx.db.LancamentoFinanceiro.create({ empresa_id: pag.empresa_id, divida_id: divida.id, tipo: 'PAGAMENTO_CONFIRMADO', valor_centavos: -efeitos.pagamento.valor_confirmado_centavos, saldo_anterior_centavos: divida.saldo_atual_centavos, saldo_posterior_centavos: efeitos.divida.saldo_atual_centavos, referencia_id: pag.id, usuario_id: ctx.user.id, data_hora: agora });
      let divPatch = { ...efeitos.divida };
      if (parcela) await alterar(ctx, 'Parcela', parcela, efeitos.parcela, 'BAIXAR_PARCELA');

      // Acordo cumprido: baixa o desconto concedido para quitar a dívida (rastreável)
      let quitada = efeitos.quitada;
      if (pag.acordo_id) {
        const acordo = await getById(ctx, 'Acordo', pag.acordo_id);
        const parcs = await find(ctx, 'Parcela', { acordo_id: acordo.id });
        const todasPagas = parcs.every((p) => (p.id === parcela?.id ? efeitos.parcela.saldo_centavos : p.saldo_centavos) === 0);
        if (todasPagas && acordo.status === 'ATIVO') {
          await alterar(ctx, 'Acordo', acordo, { status: 'CUMPRIDO', data_cumprimento: agora }, 'ACORDO_CUMPRIDO');
          const residual = divPatch.saldo_atual_centavos;
          if (residual > 0) {
            await ctx.db.LancamentoFinanceiro.create({ empresa_id: pag.empresa_id, divida_id: divida.id, tipo: 'DESCONTO_ACORDO', valor_centavos: -residual, saldo_anterior_centavos: residual, saldo_posterior_centavos: 0, referencia_id: acordo.id, usuario_id: ctx.user.id, data_hora: agora, observacao: 'Desconto concedido no acordo cumprido' });
          }
          divPatch = { saldo_atual_centavos: 0, status_financeiro: 'QUITADA' };
          quitada = true;
        } else if (!quitada) divPatch.status_financeiro = 'EM_ACORDO';
      }
      await alterar(ctx, 'Divida', divida, divPatch, 'ATUALIZAR_SALDO');

      const caso = pag.caso_id ? await getById(ctx, 'CasoCobranca', pag.caso_id) : await casoDaDivida(ctx, divida.id);
      if (caso && casoAtivo(caso)) {
        const alvo = quitada ? 'RECUPERADO_INTEGRALMENTE' : (pag.acordo_id ? 'ACORDO_AGUARDANDO_PAGAMENTO' : statusCasoAposConfirmacao(false));
        const atual = caso;
        if (podeTransitar(atual.status_operacional, alvo)) await alterar(ctx, 'CasoCobranca', atual, transicao(atual, alvo, { agora }), 'ALTERAR_STATUS_CASO');
        else if (quitada) await alterar(ctx, 'CasoCobranca', atual, { status_operacional: 'RECUPERADO_INTEGRALMENTE', data_encerramento: agora, motivo_status: 'Quitação confirmada pelo credor' }, 'ENCERRAR_CASO_QUITACAO');
        if (caso.operador_id) await ctx.db.Notificacao.create({ empresa_id: null, usuario_id: caso.operador_id, tipo: 'PAGAMENTO_CONFIRMADO', titulo: 'Pagamento confirmado pelo credor', mensagem: quitada ? 'Dívida quitada; caso encerrado.' : 'Pagamento parcial confirmado.', lida: false, data_criacao: agora, link: `/casos/${caso.id}` });
      }
      return { pagamento_id: pag.id, valor_confirmado_centavos: efeitos.pagamento.valor_confirmado_centavos, saldo_atual_centavos: divPatch.saldo_atual_centavos, quitada, ...comissao };
    },
  },

  rejeitarPagamento: {
    perm: 'pagamento.confirmar',
    async run(ctx, { pagamento_id, motivo }) {
      exigir(!isHS(ctx.user), 'Somente o credor rejeita pagamentos');
      const pag = await carregarDaEmpresa(ctx, 'Pagamento', pagamento_id);
      exigir(['INFORMADO', 'EM_CONFIRMACAO'].includes(pag.status_confirmacao), 'Somente pagamentos pendentes podem ser rejeitados');
      exigir(motivo, 'Motivo obrigatório');
      const r = await alterar(ctx, 'Pagamento', pag, { status_confirmacao: 'REJEITADO', motivo_rejeicao: motivo, confirmado_por: ctx.user.id, data_confirmacao: ctx.now().toISOString() }, 'REJEITAR_PAGAMENTO');
      const caso = pag.caso_id ? await getById(ctx, 'CasoCobranca', pag.caso_id) : null;
      if (caso && casoAtivo(caso)) {
        const outros = (await find(ctx, 'Pagamento', { caso_id: caso.id })).filter((p) => p.id !== pag.id && ['INFORMADO', 'EM_CONFIRMACAO'].includes(p.status_confirmacao));
        if (!outros.length) {
          const acordoAtivo = (await find(ctx, 'Acordo', { caso_id: caso.id })).some((a) => a.status === 'ATIVO');
          await moverCaso(ctx, caso, acordoAtivo ? 'ACORDO_AGUARDANDO_PAGAMENTO' : 'EM_CONTATO');
        }
        if (caso.operador_id) await ctx.db.Notificacao.create({ empresa_id: null, usuario_id: caso.operador_id, tipo: 'PAGAMENTO_REJEITADO', titulo: 'Pagamento informado foi rejeitado pelo credor', mensagem: motivo, lida: false, data_criacao: ctx.now().toISOString(), link: `/casos/${caso.id}` });
      }
      return r;
    },
  },

  listarPagamentos: {
    perm: null,
    async run(ctx, input = {}) {
      if (!isHS(ctx.user)) {
        requirePerm(ctx.user, 'pagamento.ler');
        const rows = await find(ctx, 'Pagamento', { empresa_id: ctx.user.empresa_id, ...filtrosPermitidos(input.filtros, ['status_confirmacao', 'divida_id', 'acordo_id', 'caso_id']) });
        return comNomes(ctx, paginar(rows, input));
      }
      return listarPorCaso(ctx, 'Pagamento', input, ['status_confirmacao', 'divida_id', 'acordo_id', 'caso_id']);
    },
  },

  /** Link temporário do comprovante (credor dono ou HS com acesso ao caso). */
  urlComprovante: {
    perm: null,
    async run(ctx, { pagamento_id }) {
      const pag = await getById(ctx, 'Pagamento', pagamento_id);
      if (!pag) throw new AccessError('Pagamento não encontrado', 404);
      if (isHS(ctx.user)) {
        exigir(pag.caso_id, 'Sem caso vinculado');
        await carregarCaso(ctx, pag.caso_id);
      } else {
        requirePerm(ctx.user, 'pagamento.ler');
        if (pag.empresa_id !== ctx.user.empresa_id) throw new AccessError('Pagamento não encontrado', 404);
      }
      exigir(pag.comprovante, 'Pagamento sem comprovante');
      await auditar(ctx, { acao: 'ACESSO_COMPROVANTE', entidade: 'Pagamento', registro_id: pag.id, empresa_id: pag.empresa_id });
      return { url: await ctx.files.signedUrl(pag.comprovante, 300) };
    },
  },

  historicoFinanceiro: {
    perm: 'divida.ler',
    async run(ctx, input) {
      const div = await carregarDaEmpresa(ctx, 'Divida', input.divida_id, input);
      const l = await find(ctx, 'LancamentoFinanceiro', { divida_id: div.id });
      return l.sort((a, b) => (a.data_hora || '').localeCompare(b.data_hora || '') || (a.created_date || '').localeCompare(b.created_date || ''));
    },
  },
};
