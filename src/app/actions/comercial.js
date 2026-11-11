import { assertCentavos } from '../../core/money.js';
import { parseDataISO } from '../../core/dates.js';
import { isHS, can } from '../../core/permissions.js';
import { verificarMensagem } from '../../core/compliance.js';
import {
  AccessError, ValidationError, requirePerm, getById, find, criar, alterar, empresaAlvo, paginar, filtrosPermitidos, exigir, notificar, carregarCaso,
} from '../context.js';

const MODALIDADES_CONTRATO = ['PACOTE_CASOS', 'CARTEIRA_ESPECIFICA', 'CARTEIRA_COMPLETA', 'PERSONALIZADA'];

export const PLANOS_PADRAO = [
  { nome: 'HS ESSENCIAL', preco_mensal_centavos: 4990, limite_devedores: 200, limite_usuarios: 2, funcionalidades: ['devedores', 'dividas', 'pagamentos', 'dashboard_basico'], status: 'ATIVO', ordem: 1 },
  { nome: 'HS PROFISSIONAL', preco_mensal_centavos: 7990, limite_devedores: 1000, limite_usuarios: 5, funcionalidades: ['devedores', 'dividas', 'pagamentos', 'dashboard_basico', 'carteiras', 'importacao', 'negociacao', 'relatorios'], status: 'ATIVO', ordem: 2 },
  { nome: 'HS EMPRESARIAL', preco_mensal_centavos: 12990, limite_devedores: 5000, limite_usuarios: 15, funcionalidades: ['devedores', 'dividas', 'pagamentos', 'dashboard_basico', 'carteiras', 'importacao', 'negociacao', 'relatorios', 'exportacao', 'api_futura'], status: 'ATIVO', ordem: 3 },
];

export const actions = {
  listarPlanos: {
    perm: null,
    async run(ctx) {
      const rows = await find(ctx, 'Plano');
      return (ctx.user?.perfil === 'SUPERADMIN_HS' ? rows : rows.filter((p) => p.status === 'ATIVO')).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    },
  },

  salvarPlano: {
    perm: 'plano.gerenciar',
    async run(ctx, input) {
      exigir(input.nome?.trim(), 'Nome obrigatório');
      assertCentavos(input.preco_mensal_centavos, 'preço mensal');
      const dados = {
        nome: input.nome, preco_mensal_centavos: input.preco_mensal_centavos, limite_devedores: Number(input.limite_devedores) || null,
        limite_usuarios: Number(input.limite_usuarios) || null, funcionalidades: input.funcionalidades || [], status: input.status || 'ATIVO', ordem: input.ordem || 0,
      };
      if (input.id) return alterar(ctx, 'Plano', await getById(ctx, 'Plano', input.id), dados, 'ALTERAR_PLANO');
      return criar(ctx, 'Plano', dados);
    },
  },

  /** Cria os 3 planos padrão se ainda não existirem (idempotente). */
  seedPlanos: {
    perm: 'plano.gerenciar',
    async run(ctx) {
      const existentes = await find(ctx, 'Plano');
      let criados = 0;
      for (const p of PLANOS_PADRAO) if (!existentes.some((e) => e.nome === p.nome)) { await criar(ctx, 'Plano', p); criados++; }
      return { criados };
    },
  },

  salvarAssinatura: {
    perm: 'assinatura.gerenciar',
    async run(ctx, input) {
      const plano = await getById(ctx, 'Plano', input.plano_id);
      exigir(plano, 'Plano não encontrado');
      const empresa = await getById(ctx, 'Empresa', input.empresa_id);
      exigir(empresa, 'Empresa não encontrada');
      parseDataISO(input.data_inicio, 'data_inicio');
      parseDataISO(input.data_vencimento, 'data_vencimento');
      const valor = input.valor_contratado_centavos ?? plano.preco_mensal_centavos;
      assertCentavos(valor, 'valor contratado', { allowZero: true });
      const ativas = (await find(ctx, 'Assinatura', { empresa_id: empresa.id })).filter((a) => a.status === 'ATIVA' && a.id !== input.id);
      for (const a of ativas) await alterar(ctx, 'Assinatura', a, { status: 'SUBSTITUIDA' }, 'SUBSTITUIR_ASSINATURA');
      const dados = { empresa_id: empresa.id, plano_id: plano.id, data_inicio: input.data_inicio, data_vencimento: input.data_vencimento, status: input.status || 'ATIVA', valor_contratado_centavos: valor, gateway: null, gateway_assinatura_id: null };
      const r = input.id ? await alterar(ctx, 'Assinatura', await getById(ctx, 'Assinatura', input.id), dados) : await criar(ctx, 'Assinatura', dados);
      await ctx.db.EventoAssinatura.create({ empresa_id: empresa.id, assinatura_id: r.id, tipo: input.id ? 'ALTERADA' : 'CRIADA', payload: JSON.stringify(dados), origem: 'MANUAL', data_hora: ctx.now().toISOString() });
      return r;
    },
  },

  minhaAssinatura: {
    perm: 'assinatura.ler',
    async run(ctx, input = {}) {
      const empresa_id = await empresaAlvo(ctx, input);
      const ass = (await find(ctx, 'Assinatura', { empresa_id })).sort((a, b) => (a.data_inicio < b.data_inicio ? 1 : -1));
      const atual = ass.find((a) => a.status === 'ATIVA') || null;
      return { atual, plano: atual ? await getById(ctx, 'Plano', atual.plano_id) : null, historico: ass, gateway: 'NAO_CONFIGURADO' };
    },
  },

  /** Proposta/edição de contrato de cobrança gerenciada (pela HS). */
  salvarContrato: {
    perm: 'contrato.gerenciar',
    async run(ctx, input) {
      exigir(MODALIDADES_CONTRATO.includes(input.modalidade), 'Modalidade de contrato inválida');
      const empresa = await getById(ctx, 'Empresa', input.empresa_id);
      exigir(empresa, 'Empresa não encontrada');
      assertCentavos(input.valor_contratado_centavos, 'valor contratado', { allowZero: true });
      parseDataISO(input.data_inicio, 'data_inicio');
      if (input.data_fim) parseDataISO(input.data_fim, 'data_fim');
      if (input.modalidade === 'PACOTE_CASOS') exigir(Number(input.quantidade_casos_contratada) > 0, 'Informe a quantidade de casos do pacote');
      const dados = {
        empresa_id: empresa.id, modalidade: input.modalidade, tipo_carteira: input.modalidade === 'CARTEIRA_COMPLETA' ? 'TODOS_ELEGIVEIS' : 'CARTEIRA_SELECIONADA',
        quantidade_casos_contratada: Number(input.quantidade_casos_contratada) || null, valor_contratado_centavos: input.valor_contratado_centavos,
        forma_cobranca_servico: input.forma_cobranca_servico || 'MENSAL', data_inicio: input.data_inicio, data_fim: input.data_fim || null,
        escopo: input.escopo || '', limites: input.limites || '', documento: input.documento || null, status: 'PROPOSTO', aceite: false,
        responsavel_autorizacao: null,
      };
      if (input.id) {
        const c = await getById(ctx, 'ContratoServico', input.id);
        exigir(c && ['SOLICITADO', 'PROPOSTO'].includes(c.status), 'Contrato já aceito não pode ser alterado; crie um aditivo');
        const r = await alterar(ctx, 'ContratoServico', c, dados, 'PROPOR_CONTRATO');
        await notificar(ctx, empresa.id, { perfis: ['ADMIN_EMPRESA'], tipo: 'CONTRATO_PROPOSTO', titulo: 'Proposta de cobrança gerenciada disponível', mensagem: 'Revise e aceite em Contratos.' });
        return r;
      }
      const r = await criar(ctx, 'ContratoServico', dados, 'PROPOR_CONTRATO');
      await notificar(ctx, empresa.id, { perfis: ['ADMIN_EMPRESA'], tipo: 'CONTRATO_PROPOSTO', titulo: 'Proposta de cobrança gerenciada disponível', mensagem: 'Revise e aceite em Contratos.' });
      return r;
    },
  },

  /** Aceite do contrato pelo admin da empresa (registra responsável e data). */
  aceitarContrato: {
    perm: 'contrato.contratar',
    async run(ctx, { contrato_id, aceite }) {
      const c = await getById(ctx, 'ContratoServico', contrato_id);
      if (!c || c.empresa_id !== ctx.user.empresa_id) throw new AccessError('Contrato não encontrado', 404);
      exigir(c.status === 'PROPOSTO', 'Contrato não está aguardando aceite');
      exigir(aceite === true, 'Confirme o aceite do contrato');
      const r = await alterar(ctx, 'ContratoServico', c, { aceite: true, status: 'ATIVO', responsavel_autorizacao: ctx.user.id, data_aceite: ctx.now().toISOString() }, 'ACEITAR_CONTRATO');
      await notificar(ctx, null, { perfis: ['SUPERADMIN_HS', 'GESTOR_OPERACOES_HS'], tipo: 'CONTRATO_ACEITO', titulo: 'Contrato de cobrança aceito', mensagem: `Contrato ${c.id}` });
      return r;
    },
  },

  encerrarContrato: {
    perm: null,
    async run(ctx, { contrato_id, motivo }) {
      const c = await getById(ctx, 'ContratoServico', contrato_id);
      if (!c) throw new AccessError('Contrato não encontrado', 404);
      if (isHS(ctx.user)) requirePerm(ctx.user, 'contrato.gerenciar');
      else { requirePerm(ctx.user, 'contrato.contratar'); if (c.empresa_id !== ctx.user.empresa_id) throw new AccessError('Contrato não encontrado', 404); }
      exigir(motivo, 'Motivo obrigatório');
      exigir(c.status === 'ATIVO', 'Contrato não está ativo');
      const ativos = (await find(ctx, 'CasoCobranca', { contrato_servico_id: c.id })).filter((x) => !['RECUPERADO_INTEGRALMENTE', 'SEM_SUCESSO', 'SUSPENSO'].includes(x.status_operacional));
      for (const caso of ativos) await alterar(ctx, 'CasoCobranca', caso, { status_operacional: 'SUSPENSO', status_anterior: caso.status_operacional, motivo_status: 'Contrato encerrado' }, 'SUSPENDER_CASO');
      return { contrato: await alterar(ctx, 'ContratoServico', c, { status: 'ENCERRADO', motivo_encerramento: motivo }, 'ENCERRAR_CONTRATO'), casos_suspensos: ativos.length };
    },
  },

  listarContratos: {
    perm: null,
    async run(ctx, input = {}) {
      let rows;
      if (isHS(ctx.user)) { requirePerm(ctx.user, can(ctx.user, 'contrato.gerenciar') ? 'contrato.gerenciar' : 'prestacao.gerar'); rows = await find(ctx, 'ContratoServico', filtrosPermitidos(input.filtros, ['empresa_id', 'status', 'modalidade'])); }
      else { requirePerm(ctx.user, 'contrato.ler'); rows = await find(ctx, 'ContratoServico', { empresa_id: ctx.user.empresa_id }); }
      return paginar(rows, input);
    },
  },

  /** Modelos de mensagem: globais (HS) ou da empresa. Validados contra termos abusivos. */
  salvarModeloMensagem: {
    perm: null,
    async run(ctx, input) {
      exigir(input.nome?.trim() && input.conteudo?.trim(), 'Nome e conteúdo obrigatórios');
      verificarMensagem(input.conteudo);
      let empresa_id = null;
      if (isHS(ctx.user)) requirePerm(ctx.user, 'config.sistema');
      else { requirePerm(ctx.user, 'empresa.editar'); empresa_id = ctx.user.empresa_id; }
      const dados = { empresa_id, nome: input.nome, canal: input.canal || 'WHATSAPP', conteudo: input.conteudo, status: input.status || 'ATIVO', aprovado_meta: false };
      if (input.id) {
        const m = await getById(ctx, 'ModeloMensagem', input.id);
        if (!m || m.empresa_id !== empresa_id) throw new AccessError('Modelo não encontrado', 404);
        return alterar(ctx, 'ModeloMensagem', m, dados);
      }
      return criar(ctx, 'ModeloMensagem', dados);
    },
  },

  listarModelosMensagem: {
    perm: null,
    async run(ctx, input = {}) {
      const todos = await find(ctx, 'ModeloMensagem', { status: 'ATIVO' });
      let empresa_id = ctx.user.empresa_id;
      if (input.caso_id) {
        empresa_id = (await carregarCaso(ctx, input.caso_id)).empresa_id;
      }
      return todos.filter((m) => !m.empresa_id || m.empresa_id === empresa_id);
    },
  },

  statusIntegracoes: {
    perm: null,
    async run(ctx) {
      const cfg = (await find(ctx, 'ConfiguracaoComunicacao', {}))[0] || {};
      return {
        whatsapp_business_api: cfg.whatsapp_api_status === 'ATIVA' ? 'ATIVA' : 'INDISPONIVEL — envio manual via link wa.me',
        email_transacional: cfg.email_status === 'ATIVA' ? 'ATIVA' : 'INDISPONIVEL',
        gateway_assinatura: 'NAO_CONFIGURADO',
        assistente_ia: cfg.ia_status === 'ATIVA' ? 'ATIVA' : 'INDISPONIVEL',
      };
    },
  },
};
