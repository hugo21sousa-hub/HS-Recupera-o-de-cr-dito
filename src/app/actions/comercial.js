import { assertCentavos } from '../../core/money.js';
import { isHS, can } from '../../core/permissions.js';
import { verificarMensagem } from '../../core/compliance.js';
import { TABELA_PADRAO, validarFaixas, rotuloFaixa, faixaPara } from '../../core/comissao.js';
import { diasAtraso, parseDataISO } from '../../core/dates.js';
import { situacaoAcesso, resumoAcesso } from '../acesso.js';
import {
  AccessError, ValidationError, requirePerm, getById, find, criar, alterar, empresaAlvo, paginar, filtrosPermitidos, exigir, notificar, carregarCaso,
} from '../context.js';

const MODALIDADES_CONTRATO = ['PACOTE_CASOS', 'CARTEIRA_ESPECIFICA', 'CARTEIRA_COMPLETA', 'PERSONALIZADA'];

// Valores padrão anteriores: planos ainda com estes números são atualizados para os novos na inicialização.
// Planos que a HS já editou no painel ficam como estão.
export const PLANOS_PADRAO_ANTERIORES = {
  'ACORLY ESSENCIAL': { preco_mensal_centavos: 4990, limite_devedores: 200 },
  'ACORLY PROFISSIONAL': { preco_mensal_centavos: 7990, limite_devedores: 1000 },
  'ACORLY EMPRESARIAL': { preco_mensal_centavos: 12990, limite_devedores: 5000 },
};

// Nomes antigos dos planos (antes da marca Acorly): renomeados na inicialização.
export const PLANOS_NOMES_ANTERIORES = { 'HS ESSENCIAL': 'ACORLY ESSENCIAL', 'HS PROFISSIONAL': 'ACORLY PROFISSIONAL', 'HS EMPRESARIAL': 'ACORLY EMPRESARIAL', 'HS ILIMITADO': 'ACORLY ILIMITADO' };

export const PLANOS_PADRAO = [
  { nome: 'ACORLY ESSENCIAL', preco_mensal_centavos: 4990, limite_devedores: 100, limite_usuarios: 2, funcionalidades: ['devedores', 'dividas', 'pagamentos', 'dashboard_basico'], status: 'ATIVO', ordem: 1 },
  { nome: 'ACORLY PROFISSIONAL', preco_mensal_centavos: 8990, limite_devedores: 500, limite_usuarios: 5, funcionalidades: ['devedores', 'dividas', 'pagamentos', 'dashboard_basico', 'carteiras', 'importacao', 'negociacao', 'relatorios'], status: 'ATIVO', ordem: 2 },
  { nome: 'ACORLY EMPRESARIAL', preco_mensal_centavos: 15990, limite_devedores: 1000, limite_usuarios: 15, funcionalidades: ['devedores', 'dividas', 'pagamentos', 'dashboard_basico', 'carteiras', 'importacao', 'negociacao', 'relatorios', 'exportacao'], status: 'ATIVO', ordem: 3 },
  { nome: 'ACORLY ILIMITADO', preco_mensal_centavos: 25990, limite_devedores: null, limite_usuarios: null, funcionalidades: ['devedores', 'dividas', 'pagamentos', 'dashboard_basico', 'carteiras', 'importacao', 'negociacao', 'relatorios', 'exportacao'], status: 'ATIVO', ordem: 4 },
];

/** Tabela de comissão vigente: a do contrato, senão a padrão configurada pelo Acorly, senão a de fábrica. */
export async function tabelaComissao(ctx, contrato = null) {
  if (contrato?.comissao_faixas?.length) return contrato.comissao_faixas;
  const cfg = (await find(ctx, 'ConfiguracaoHS'))[0];
  return cfg?.comissao_faixas?.length ? cfg.comissao_faixas : TABELA_PADRAO;
}
export const comRotulos = (faixas) => faixas.map((f, i) => ({ ...f, faixa: rotuloFaixa(faixas, i) }));

/**
 * Comissão de um caso Acorly. Casos antigos (encaminhados antes da tabela existir) recebem a faixa
 * correspondente ao atraso na data do encaminhamento, e o valor fica gravado no caso.
 */
export async function comissaoDoCaso(ctx, caso, divida) {
  if (!caso || caso.modalidade_cobranca !== 'HS_GERENCIADA') return null;
  if (Number.isSafeInteger(caso.comissao_bps)) return { bps: caso.comissao_bps, faixa: caso.comissao_faixa, dias: caso.dias_atraso_no_envio };
  const contrato = caso.contrato_servico_id ? await getById(ctx, 'ContratoServico', caso.contrato_servico_id) : null;
  const div = divida || await getById(ctx, 'Divida', caso.divida_id);
  const dias = diasAtraso(div.data_vencimento, (caso.data_recebimento || ctx.now().toISOString()).slice(0, 10));
  const f = faixaPara(dias, await tabelaComissao(ctx, contrato));
  await ctx.db.CasoCobranca.update(caso.id, { comissao_bps: f.bps, comissao_faixa: f.faixa, dias_atraso_no_envio: dias });
  Object.assign(caso, { comissao_bps: f.bps, comissao_faixa: f.faixa, dias_atraso_no_envio: dias });
  return { bps: f.bps, faixa: f.faixa, dias };
}

/** Contrato ativo e vigente da empresa (o mais recente). */
export async function contratoAtivoDaEmpresa(ctx, empresa_id) {
  const hoje = ctx.now().toISOString().slice(0, 10);
  return (await find(ctx, 'ContratoServico', { empresa_id, status: 'ATIVO' })).filter((c) => c.aceite && (!c.data_fim || c.data_fim >= hoje)).sort((a, b) => ((a.data_inicio || '') < (b.data_inicio || '') ? 1 : -1))[0] || null;
}

/** Webhook do Asaas (ctx de sistema). Idempotente por id do evento. */
export async function processarWebhookAsaas(ctx, ev) {
  const idEvento = ev?.id || `${ev?.event}:${ev?.payment?.id}:${ev?.payment?.status}`;
  if ((await find(ctx, 'EventoWebhook', { origem: 'ASAAS', externo_id: idEvento })).length) return { duplicado: true };
  await ctx.db.EventoWebhook.create({ origem: 'ASAAS', externo_id: idEvento, recebido_em: ctx.now().toISOString() });
  const subId = ev?.payment?.subscription || ev?.subscription?.id;
  if (!subId) return { ignorado: true };
  const a = (await find(ctx, 'Assinatura', { gateway_assinatura_id: subId }))[0];
  if (!a) return { ignorado: true };
  const agora = ctx.now().toISOString();
  let patch = null;
  switch (ev.event) {
    case 'PAYMENT_CREATED': patch = { fatura_url: ev.payment?.invoiceUrl || a.fatura_url }; break;
    case 'PAYMENT_CONFIRMED': case 'PAYMENT_RECEIVED': {
      const venc = new Date((ev.payment?.dueDate || agora.slice(0, 10)) + 'T00:00:00Z');
      venc.setUTCMonth(venc.getUTCMonth() + 1);
      patch = { status: 'ATIVA', ultimo_pagamento_em: agora, data_vencimento: venc.toISOString().slice(0, 10), fatura_url: null, inadimplente_desde: null };
      for (const outra of (await find(ctx, 'Assinatura', { empresa_id: a.empresa_id })).filter((x) => x.id !== a.id && x.status === 'ATIVA')) {
        await ctx.db.Assinatura.update(outra.id, { status: 'SUBSTITUIDA' });
        if (outra.gateway_assinatura_id && ctx.asaas?.disponivel) await ctx.asaas.cancelarAssinatura(outra.gateway_assinatura_id).catch(() => {});
      }
      break;
    }
    case 'PAYMENT_OVERDUE': patch = { status: 'INADIMPLENTE', inadimplente_desde: a.status === 'INADIMPLENTE' && a.inadimplente_desde ? a.inadimplente_desde : (ev.payment?.dueDate || agora.slice(0, 10)), fatura_url: ev.payment?.invoiceUrl || a.fatura_url }; break;
    case 'PAYMENT_REFUNDED': case 'PAYMENT_CHARGEBACK_REQUESTED': patch = { status: 'INADIMPLENTE', inadimplente_desde: agora.slice(0, 10) }; break;
    case 'SUBSCRIPTION_DELETED': case 'SUBSCRIPTION_INACTIVATED': patch = { status: 'CANCELADA' }; break;
    default: break;
  }
  await ctx.db.EventoAssinatura.create({ empresa_id: a.empresa_id, assinatura_id: a.id, tipo: ev.event, payload: JSON.stringify({ pagamento: ev.payment?.id, valor: ev.payment?.value, status: ev.payment?.status }), origem: 'GATEWAY', data_hora: agora });
  if (patch) {
    await alterar(ctx, 'Assinatura', a, patch, `GATEWAY_${ev.event}`);
    if (patch.status === 'ATIVA' || patch.status === 'INADIMPLENTE') await notificar(ctx, a.empresa_id, { perfis: ['ADMIN_EMPRESA'], tipo: 'ASSINATURA', titulo: patch.status === 'ATIVA' ? 'Pagamento da assinatura confirmado' : 'Assinatura com pagamento pendente', mensagem: patch.status === 'ATIVA' ? 'Seu plano está ativo.' : 'Regularize a fatura para manter o plano.', link: '/assinatura' });
  }
  return { ok: true, status: patch?.status };
}

export const actions = {
  /** Tabela de comissão da cobrança gerenciada (da empresa: a do seu contrato ativo, se houver). */
  obterTabelaComissao: {
    perm: null,
    async run(ctx, input = {}) {
      let contrato = null;
      if (!isHS(ctx.user) && ctx.user.empresa_id) contrato = await contratoAtivoDaEmpresa(ctx, ctx.user.empresa_id);
      if (isHS(ctx.user) && input.contrato_servico_id) contrato = await getById(ctx, 'ContratoServico', input.contrato_servico_id);
      const padrao = await tabelaComissao(ctx);
      return { faixas: comRotulos(await tabelaComissao(ctx, contrato)), origem: contrato?.comissao_faixas?.length ? 'CONTRATO' : 'PADRAO', padrao: comRotulos(padrao) };
    },
  },

  salvarTabelaComissao: {
    perm: 'config.sistema',
    async run(ctx, { faixas }) {
      const validas = validarFaixas(faixas);
      const atual = (await find(ctx, 'ConfiguracaoHS'))[0];
      const dados = { comissao_faixas: validas, atualizado_por: ctx.user.id, atualizado_em: ctx.now().toISOString() };
      if (atual) await alterar(ctx, 'ConfiguracaoHS', atual, dados, 'ALTERAR_TABELA_COMISSAO');
      else await criar(ctx, 'ConfiguracaoHS', dados, 'ALTERAR_TABELA_COMISSAO');
      return { faixas: comRotulos(validas) };
    },
  },

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
      const ass = (await find(ctx, 'Assinatura', { empresa_id })).sort((a, b) => ((a.data_inicio || '') < (b.data_inicio || '') ? 1 : -1));
      const atual = ass.find((a) => a.status === 'ATIVA') || ass.find((a) => a.status === 'INADIMPLENTE') || null;
      const pendente = ass.find((a) => a.status === 'AGUARDANDO_PAGAMENTO') || null;
      const acesso = await situacaoAcesso(ctx, empresa_id);
      return { acesso: resumoAcesso(acesso), atual, plano: atual ? await getById(ctx, 'Plano', atual.plano_id) : null, pendente, plano_pendente: pendente ? await getById(ctx, 'Plano', pendente.plano_id) : null, historico: ass, gateway: ctx.asaas?.disponivel ? 'ASAAS' : 'NAO_CONFIGURADO' };
    },
  },

  /** Contratação/troca de plano com pagamento online (Asaas: Pix, boleto ou cartão). */
  assinarPlano: {
    perm: 'assinatura.gerenciar_propria',
    async run(ctx, { plano_id }) {
      if (!ctx.asaas?.disponivel) throw new ValidationError('Pagamento online da assinatura indisponível. Fale com o Acorly.');
      const empresa = await getById(ctx, 'Empresa', ctx.user.empresa_id);
      const plano = await getById(ctx, 'Plano', plano_id);
      exigir(plano && plano.status === 'ATIVO', 'Plano indisponível');
      const minhas = await find(ctx, 'Assinatura', { empresa_id: empresa.id });
      exigir(!minhas.some((a) => a.status === 'ATIVA' && a.plano_id === plano.id), 'Este já é o seu plano');
      for (const p of minhas.filter((a) => a.status === 'AGUARDANDO_PAGAMENTO')) {
        if (p.gateway_assinatura_id) await ctx.asaas.cancelarAssinatura(p.gateway_assinatura_id).catch(() => {});
        await alterar(ctx, 'Assinatura', p, { status: 'CANCELADA' }, 'CANCELAR_ASSINATURA_PENDENTE');
      }
      // O cliente criado no sandbox não existe na conta real (e vice-versa): ao trocar de ambiente, cria de novo
      const ambiente = ctx.asaas.ambiente || null;
      let cliente = (empresa.asaas_ambiente || 'sandbox') === (ambiente || 'sandbox') ? empresa.asaas_cliente_id : null;
      if (!cliente) {
        cliente = (await ctx.asaas.criarCliente({ nome: empresa.razao_social, cpfCnpj: empresa.cnpj, email: empresa.email, telefone: empresa.telefone, referencia: empresa.id })).id;
        await ctx.db.Empresa.update(empresa.id, { asaas_cliente_id: cliente, asaas_ambiente: ambiente });
      }
      const hoje = ctx.now().toISOString().slice(0, 10);
      const sub = await ctx.asaas.criarAssinatura({ cliente, valorCentavos: plano.preco_mensal_centavos, vencimento: hoje, descricao: `Assinatura ${plano.nome} — Acorly (HS Recuperação de Crédito)`, referencia: empresa.id });
      const cobr = await ctx.asaas.cobrancasDaAssinatura(sub.id).catch(() => ({ data: [] }));
      const fatura = cobr.data?.[0]?.invoiceUrl || null;
      const a = await criar(ctx, 'Assinatura', { empresa_id: empresa.id, plano_id: plano.id, data_inicio: hoje, data_vencimento: hoje, status: 'AGUARDANDO_PAGAMENTO', valor_contratado_centavos: plano.preco_mensal_centavos, gateway: 'ASAAS', gateway_assinatura_id: sub.id, fatura_url: fatura });
      await ctx.db.EventoAssinatura.create({ empresa_id: empresa.id, assinatura_id: a.id, tipo: 'SOLICITADA', payload: JSON.stringify({ plano: plano.nome, gateway_id: sub.id }), origem: 'GATEWAY', data_hora: ctx.now().toISOString() });
      return { assinatura_id: a.id, fatura_url: fatura };
    },
  },

  /** Proposta/edição de contrato de cobrança gerenciada (pelo Acorly). */
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
        // Sem tabela própria, o contrato "congela" a tabela padrão vigente na proposta
        comissao_faixas: input.comissao_faixas?.length ? validarFaixas(input.comissao_faixas) : await tabelaComissao(ctx),
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

  /** Modelos de mensagem: globais (Acorly) ou da empresa. Validados contra termos abusivos. */
  salvarModeloMensagem: {
    perm: null,
    async run(ctx, input) {
      exigir(input.nome?.trim() && input.conteudo?.trim(), 'Nome e conteúdo obrigatórios');
      verificarMensagem(input.conteudo);
      let empresa_id = null;
      if (isHS(ctx.user)) requirePerm(ctx.user, 'config.sistema');
      else { requirePerm(ctx.user, 'empresa.editar'); empresa_id = ctx.user.empresa_id; }
      const dados = { empresa_id, nome: input.nome, canal: input.canal || 'WHATSAPP', conteudo: input.conteudo, status: input.status || 'ATIVO', aprovado_meta: false };
      // Só o Acorly cadastra modelos aprovados na Meta (o número do WhatsApp Business é do Acorly)
      if (isHS(ctx.user) && input.nome_template_meta) Object.assign(dados, { aprovado_meta: true, nome_template_meta: String(input.nome_template_meta).trim(), idioma_template: input.idioma_template || 'pt_BR' });
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
      return {
        whatsapp_business_api: ctx.whatsapp?.disponivel ? 'ATIVA' : 'INDISPONIVEL',
        email_transacional: ctx.email?.disponivel ? 'ATIVA' : 'INDISPONIVEL',
        gateway_assinatura: ctx.asaas?.disponivel ? 'ATIVA' : 'INDISPONIVEL',
        assistente_ia: 'INDISPONIVEL',
      };
    },
  },
};
