import { AccessError, requirePerm, getById, find, criar, alterar, auditar, carregarDaEmpresa, exigir, paginar } from '../context.js';
import { casoAtivo } from '../../core/caseStatus.js';
import { isHS } from '../../core/permissions.js';

const TIPOS = ['ACESSO', 'CORRECAO', 'ELIMINACAO', 'PORTABILIDADE', 'INFORMACAO_COMPARTILHAMENTO', 'OPOSICAO', 'REVOGACAO_CONSENTIMENTO'];

export const actions = {
  /** Registro de solicitação do titular (devedor). A empresa credora é controladora; a HS, operadora. */
  registrarSolicitacaoTitular: {
    perm: 'lgpd.atender',
    async run(ctx, input) {
      const dev = await carregarDaEmpresa(ctx, 'Devedor', input.devedor_id, input);
      exigir(TIPOS.includes(input.tipo), 'Tipo de solicitação inválido');
      const prazo = new Date(ctx.now().getTime() + 15 * 86400000).toISOString().slice(0, 10);
      return criar(ctx, 'SolicitacaoTitular', { empresa_id: dev.empresa_id, devedor_id: dev.id, tipo: input.tipo, descricao: input.descricao || '', canal_recebimento: input.canal || 'EMAIL', status: 'ABERTA', prazo_resposta: prazo, resposta: '', data_abertura: ctx.now().toISOString() });
    },
  },

  responderSolicitacaoTitular: {
    perm: 'lgpd.atender',
    async run(ctx, { solicitacao_id, resposta, status = 'CONCLUIDA' }) {
      const s = await carregarDaEmpresa(ctx, 'SolicitacaoTitular', solicitacao_id);
      exigir(resposta, 'Resposta obrigatória');
      exigir(['CONCLUIDA', 'NEGADA_FUNDAMENTADA', 'EM_ANALISE'].includes(status), 'Status inválido');
      return alterar(ctx, 'SolicitacaoTitular', s, { resposta, status, data_resposta: ctx.now().toISOString(), respondido_por: ctx.user.id });
    },
  },

  listarSolicitacoesTitular: {
    perm: 'lgpd.atender',
    async run(ctx, input = {}) {
      return paginar(await find(ctx, 'SolicitacaoTitular', { empresa_id: ctx.user.empresa_id }), input);
    },
  },

  /** Exporta todos os dados do titular mantidos pela empresa (direito de acesso/portabilidade). */
  exportarDadosTitular: {
    perm: 'lgpd.atender',
    async run(ctx, input) {
      const dev = await carregarDaEmpresa(ctx, 'Devedor', input.devedor_id, input);
      const dividas = await find(ctx, 'Divida', { devedor_id: dev.id });
      const casos = await find(ctx, 'CasoCobranca', { devedor_id: dev.id });
      const interacoes = [];
      for (const c of casos) interacoes.push(...(await find(ctx, 'Interacao', { caso_id: c.id })).filter((i) => i.tipo_interacao !== 'NOTA_INTERNA'));
      const pagamentos = [];
      for (const d of dividas) pagamentos.push(...(await find(ctx, 'Pagamento', { divida_id: d.id })));
      await auditar(ctx, { acao: 'EXPORTAR_DADOS_TITULAR', entidade: 'Devedor', registro_id: dev.id, empresa_id: dev.empresa_id });
      const { observacoes_internas, ...pessoais } = dev;
      return { gerado_em: ctx.now().toISOString(), controlador: dev.empresa_id, titular: pessoais, dividas, interacoes, pagamentos };
    },
  },

  /**
   * Anonimização (eliminação) — bloqueada enquanto houver dívida em aberto/caso ativo,
   * pois a base legal de exercício regular de direito permanece. Histórico financeiro é mantido sem identificação.
   */
  anonimizarDevedor: {
    perm: 'lgpd.atender',
    async run(ctx, input) {
      const dev = await carregarDaEmpresa(ctx, 'Devedor', input.devedor_id, input);
      exigir(input.confirmacao === true && input.motivo, 'Confirme a operação e informe o motivo');
      const dividas = await find(ctx, 'Divida', { devedor_id: dev.id });
      exigir(dividas.every((d) => ['QUITADA', 'CANCELADA'].includes(d.status_financeiro)), 'Há dívidas em aberto: a eliminação não é aplicável enquanto houver base legal para cobrança');
      const casos = await find(ctx, 'CasoCobranca', { devedor_id: dev.id });
      exigir(!casos.some(casoAtivo), 'Há casos de cobrança ativos');
      return alterar(ctx, 'Devedor', dev, {
        nome: 'TITULAR ANONIMIZADO', cpf_cnpj: `ANON-${dev.id.slice(-6)}`, telefone: '', whatsapp: '', email: '', endereco: '', observacoes: '', status: 'ANONIMIZADO', nao_contatar: true, data_anonimizacao: ctx.now().toISOString(),
      }, 'ANONIMIZAR_TITULAR');
    },
  },

  salvarPoliticaRetencao: {
    perm: 'empresa.editar',
    async run(ctx, input) {
      const atual = (await find(ctx, 'ConfiguracaoEmpresa', { empresa_id: ctx.user.empresa_id }))[0];
      const dados = { empresa_id: ctx.user.empresa_id, retencao_meses_apos_quitacao: Math.max(0, Number(input.retencao_meses_apos_quitacao) || 60), exigir_documento_hs: input.exigir_documento_hs !== false, encarregado_dpo_nome: input.encarregado_dpo_nome || '', encarregado_dpo_email: input.encarregado_dpo_email || '' };
      return atual ? alterar(ctx, 'ConfiguracaoEmpresa', atual, dados) : criar(ctx, 'ConfiguracaoEmpresa', dados);
    },
  },
};

actions.obterConfiguracoes = {
  perm: 'empresa.ler',
  async run(ctx) {
    const cfg = (await find(ctx, 'ConfiguracaoEmpresa', { empresa_id: ctx.user.empresa_id }))[0];
    return cfg || { empresa_id: ctx.user.empresa_id, retencao_meses_apos_quitacao: 60, exigir_documento_hs: true, encarregado_dpo_nome: '', encarregado_dpo_email: '' };
  },
};
