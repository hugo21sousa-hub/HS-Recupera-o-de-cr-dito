import { dashboardFinanceiro, prestacaoContas, toCSV } from '../../core/reports.js';
import { formatBRL, soma } from '../../core/money.js';
import { isHS } from '../../core/permissions.js';
import { diasAtraso } from '../../core/dates.js';
import { AccessError, requirePerm, getById, find, criar, empresaAlvo, exigir, auditar, notificar } from '../context.js';
import { casoAtivo } from '../../core/caseStatus.js';

const entre = (iso, de, ate) => !!iso && (!de || iso.slice(0, 10) >= de) && (!ate || iso.slice(0, 10) <= ate);

async function dadosEmpresa(ctx, empresa_id, f = {}) {
  const q = { empresa_id };
  let [dividas, negociacoes, acordos, pagamentos, casos] = await Promise.all([
    find(ctx, 'Divida', q), find(ctx, 'Negociacao', q), find(ctx, 'Acordo', q), find(ctx, 'Pagamento', q), find(ctx, 'CasoCobranca', q),
  ]);
  if (f.modalidade) dividas = dividas.filter((d) => d.modalidade_cobranca === f.modalidade);
  if (f.status) dividas = dividas.filter((d) => d.status_financeiro === f.status);
  if (f.carteira_id) {
    const ids = new Set((await find(ctx, 'CarteiraDevedor', { carteira_id: f.carteira_id })).filter((i) => i.status !== 'REMOVIDO').map((i) => i.divida_id));
    dividas = dividas.filter((d) => ids.has(d.id));
  }
  if (f.responsavel_id) {
    const ids = new Set(casos.filter((c) => c.operador_id === f.responsavel_id || c.responsavel_empresa_id === f.responsavel_id).map((c) => c.divida_id));
    dividas = dividas.filter((d) => ids.has(d.id));
  }
  const ids = new Set(dividas.map((d) => d.id));
  negociacoes = negociacoes.filter((n) => ids.has(n.divida_id) && (!f.de && !f.ate || entre(n.data_proposta, f.de, f.ate)));
  acordos = acordos.filter((a) => ids.has(a.divida_id) && (!f.de && !f.ate || entre(a.data_aceite, f.de, f.ate)));
  pagamentos = pagamentos.filter((p) => ids.has(p.divida_id) && (!f.de && !f.ate || entre(p.status_confirmacao === 'CONFIRMADO' ? p.data_confirmacao : p.data_informada, f.de, f.ate)));
  casos = casos.filter((c) => ids.has(c.divida_id));
  return { dividas, negociacoes, acordos, pagamentos, casos };
}

function serieMensal(pagamentos, meses, hojeISO) {
  const out = [];
  const [y, m] = hojeISO.split('-').map(Number);
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7);
    out.push({
      mes: d,
      recuperado_confirmado_centavos: soma(pagamentos.filter((p) => p.status_confirmacao === 'CONFIRMADO' && p.data_confirmacao?.startsWith(d)).map((p) => p.valor_confirmado_centavos ?? p.valor_centavos)),
      informado_centavos: soma(pagamentos.filter((p) => (p.data_informada || '').startsWith(d)).map((p) => p.valor_centavos)),
    });
  }
  return out;
}

const NOMES_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const nomeMes = (aaaamm) => `${NOMES_MES[Number(aaaamm.slice(5, 7)) - 1]}/${aaaamm.slice(0, 4)}`;
export function mesAnterior(agora) {
  const d = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}
const fimDoMes = (aaaamm) => new Date(Date.UTC(Number(aaaamm.slice(0, 4)), Number(aaaamm.slice(5, 7)), 0)).toISOString().slice(0, 10);
const ABERTAS = (p) => p.saldo_centavos > 0 && !['PAGA', 'CANCELADA', 'SUBSTITUIDA'].includes(p.status);

/**
 * Monta e grava a prestação de contas de um contrato: indicadores do período, pagamentos confirmados (com comissão),
 * acordos, parcelas a receber e casos ainda em cobrança (posição na data da geração).
 */
export async function gerarPrestacao(ctx, contrato, periodo_inicio, periodo_fim) {
  const casos = await find(ctx, 'CasoCobranca', { contrato_servico_id: contrato.id });
  const ids = new Set(casos.map((c) => c.id));
  const dividas = new Set(casos.map((c) => c.divida_id));
  const q = { empresa_id: contrato.empresa_id };
  const [interacoes, negociacoes, acordos, pagamentos, parcelas] = await Promise.all([find(ctx, 'Interacao', q), find(ctx, 'Negociacao', q), find(ctx, 'Acordo', q), find(ctx, 'Pagamento', q), find(ctx, 'Parcela', q)]);
  const acordosContrato = acordos.filter((a) => ids.has(a.caso_id));
  const pagsContrato = pagamentos.filter((p) => dividas.has(p.divida_id));
  const rel = prestacaoContas({
    casos: casos.filter((c) => !c.encerrado_por_retirada || c.status_operacional !== 'SEM_SUCESSO'),
    interacoes: interacoes.filter((i) => ids.has(i.caso_id)), negociacoes: negociacoes.filter((n) => ids.has(n.caso_id)),
    acordos: acordosContrato, pagamentos: pagsContrato, inicio: periodo_inicio, fim: periodo_fim,
  });
  const empresa = await getById(ctx, 'Empresa', contrato.empresa_id);
  const devedores = new Map((await find(ctx, 'Devedor', { empresa_id: contrato.empresa_id })).map((d) => [d.id, d.nome]));
  const divs = new Map((await find(ctx, 'Divida', { empresa_id: contrato.empresa_id })).map((d) => [d.id, d]));
  const nomeDev = (divida_id) => devedores.get(divs.get(divida_id)?.devedor_id) || '—';
  const agora = ctx.now().toISOString();
  const hoje = agora.slice(0, 10);

  // Recuperado: no período (com comissão) e acumulado desde o início do contrato
  const confirmados = pagsContrato.filter((p) => p.status_confirmacao === 'CONFIRMADO' && p.data_confirmacao);
  rel.comissoes = confirmados.filter((p) => p.data_confirmacao.slice(0, 10) >= periodo_inicio && p.data_confirmacao.slice(0, 10) <= periodo_fim)
    .sort((a, b) => (a.data_confirmacao > b.data_confirmacao ? 1 : -1))
    .map((p) => ({ data: p.data_confirmacao.slice(0, 10), devedor: nomeDev(p.divida_id), valor_centavos: p.valor_confirmado_centavos ?? p.valor_centavos, comissao_bps: p.comissao_bps || 0, comissao_centavos: p.comissao_hs_centavos || 0 }));
  rel.recuperado_acumulado_centavos = soma(confirmados.filter((p) => p.data_confirmacao.slice(0, 10) <= periodo_fim).map((p) => p.valor_confirmado_centavos ?? p.valor_centavos));

  // Acordos (todos os do contrato até o fim do período)
  rel.acordos = acordosContrato.filter((a) => (a.data_aceite || a.created_date || '').slice(0, 10) <= periodo_fim)
    .sort((a, b) => ((a.data_aceite || '') > (b.data_aceite || '') ? 1 : -1))
    .map((a) => {
      const ps = parcelas.filter((p) => p.acordo_id === a.id);
      const abertas = ps.filter(ABERTAS);
      const proxima = abertas.map((p) => p.vencimento).sort()[0] || null;
      return {
        devedor: nomeDev(a.divida_id), data_aceite: a.data_aceite || null, valor_acordado_centavos: a.valor_acordado_centavos || 0, desconto_centavos: a.desconto_centavos || 0,
        parcelas_total: ps.length, parcelas_pagas: ps.filter((p) => p.status === 'PAGA').length,
        pago_centavos: soma(ps.map((p) => (p.valor_original_centavos || 0) - (p.saldo_centavos || 0))),
        a_receber_centavos: a.status === 'ATIVO' ? soma(abertas.map((p) => p.saldo_centavos)) : 0, proximo_vencimento: a.status === 'ATIVO' ? proxima : null, status: a.status,
      };
    });

  // A receber: parcelas em aberto de acordos ativos (posição na geração)
  const ativos = new Set(acordosContrato.filter((a) => a.status === 'ATIVO').map((a) => a.id));
  rel.a_receber = parcelas.filter((p) => ativos.has(p.acordo_id) && ABERTAS(p)).sort((a, b) => (a.vencimento > b.vencimento ? 1 : -1))
    .map((p) => ({ vencimento: p.vencimento, devedor: nomeDev(p.divida_id), parcela: p.numero === 0 ? 'Entrada' : `${p.numero}`, valor_centavos: p.saldo_centavos, vencida: p.vencimento < hoje }));
  const porMes = new Map();
  for (const p of rel.a_receber) porMes.set(p.vencimento.slice(0, 7), (porMes.get(p.vencimento.slice(0, 7)) || 0) + p.valor_centavos);
  rel.a_receber_por_mes = [...porMes.entries()].map(([mes, valor_centavos]) => ({ mes, valor_centavos }));
  rel.a_receber_centavos = soma(rel.a_receber.map((p) => p.valor_centavos));
  rel.a_receber_vencido_centavos = soma(rel.a_receber.filter((p) => p.vencida).map((p) => p.valor_centavos));

  // Em cobrança: casos ativos sem acordo ativo
  const comAcordo = new Set(acordosContrato.filter((a) => a.status === 'ATIVO').map((a) => a.caso_id));
  rel.em_cobranca = casos.filter((c) => casoAtivo(c) && !comAcordo.has(c.id)).map((c) => {
    const d = divs.get(c.divida_id);
    return { devedor: nomeDev(c.divida_id), saldo_centavos: d?.saldo_atual_centavos || 0, dias_atraso: d ? diasAtraso(d.data_vencimento, hoje) : null, status: c.status_operacional };
  }).sort((a, b) => b.saldo_centavos - a.saldo_centavos);
  rel.saldo_em_cobranca_centavos = soma(rel.em_cobranca.map((c) => c.saldo_centavos));
  rel.posicao_em = agora;

  return criar(ctx, 'PrestacaoContas', {
    empresa_id: contrato.empresa_id, contrato_servico_id: contrato.id, periodo_inicio, periodo_fim, quantidade_casos: casos.length,
    valor_cobrado_centavos: contrato.valor_contratado_centavos || 0, valor_negociado_centavos: rel.valor_negociado_centavos, valor_confirmado_centavos: rel.valor_recuperado_centavos,
    relatorio: JSON.stringify({ ...rel, credor: empresa.razao_social, cnpj: empresa.cnpj, contrato: contrato.id, gerado_por: ctx.user.nome }), data_geracao: agora,
  }, 'GERAR_PRESTACAO_CONTAS');
}

/** Aviso no sistema e e-mail (via notificação) ao administrador e ao financeiro da empresa, com o resumo. */
export async function enviarPrestacao(ctx, p) {
  const rel = JSON.parse(p.relatorio || '{}');
  const mensal = p.periodo_inicio.slice(8) === '01' && p.periodo_fim === fimDoMes(p.periodo_inicio.slice(0, 7)) && p.periodo_inicio.slice(0, 7) === p.periodo_fim.slice(0, 7);
  const periodo = mensal ? nomeMes(p.periodo_inicio.slice(0, 7)) : `${p.periodo_inicio.split('-').reverse().join('/')} a ${p.periodo_fim.split('-').reverse().join('/')}`;
  const linhas = [
    `Recuperado no período: ${formatBRL(rel.valor_recuperado_centavos || 0)} (${rel.pagamentos_confirmados || 0} pagamento(s) confirmado(s)).`,
    `Recuperado desde o início do contrato: ${formatBRL(rel.recuperado_acumulado_centavos || 0)}.`,
    `Acordos realizados no período: ${rel.acordos_realizados || 0}.`,
    `A receber em acordos: ${formatBRL(rel.a_receber_centavos || 0)}${rel.a_receber_vencido_centavos ? ` (${formatBRL(rel.a_receber_vencido_centavos)} já vencido)` : ''}.`,
    `Saldo ainda em cobrança: ${formatBRL(rel.saldo_em_cobranca_centavos || 0)}.`,
    'Abra o relatório no Acorly para ver os detalhes e baixar o PDF.',
  ];
  const destinatarios = (await find(ctx, 'UsuarioPlataforma', { empresa_id: p.empresa_id, status: 'ATIVO' })).filter((u) => ['ADMIN_EMPRESA', 'FINANCEIRO_EMPRESA'].includes(u.perfil));
  await notificar(ctx, p.empresa_id, { perfis: ['ADMIN_EMPRESA', 'FINANCEIRO_EMPRESA'], tipo: 'PRESTACAO_CONTAS', titulo: `Prestação de contas de ${periodo}`, mensagem: linhas.join('\n'), link: '/relatorios' });
  return ctx.db.PrestacaoContas.update(p.id, { enviado_em: ctx.now().toISOString(), enviado_para: destinatarios.map((u) => u.email), enviado_por: ctx.user.id });
}

/** Gera e envia o mês para todos os contratos ativos no mês (pula os que já têm a prestação daquele mês). */
export async function prestacoesDoMes(ctx, mes) {
  const inicio = `${mes}-01`;
  const fim = fimDoMes(mes);
  let geradas = 0, ja_existiam = 0;
  const contratos = (await find(ctx, 'ContratoServico', {})).filter((c) => c.aceite && ['ATIVO', 'ENCERRADO'].includes(c.status) && (c.data_aceite || c.data_inicio || '').slice(0, 10) <= fim && !(c.status === 'ENCERRADO' && (c.updated_date || '').slice(0, 10) < inicio));
  for (const c of contratos) {
    const existentes = await find(ctx, 'PrestacaoContas', { contrato_servico_id: c.id });
    if (existentes.some((p) => p.periodo_inicio === inicio && p.periodo_fim === fim)) { ja_existiam++; continue; }
    const p = await gerarPrestacao(ctx, c, inicio, fim);
    await enviarPrestacao(ctx, p);
    geradas++;
  }
  return { mes, geradas, ja_existiam };
}

export const actions = {
  dashboardEmpresa: {
    perm: 'relatorio.empresa',
    async run(ctx, input = {}) {
      const empresa_id = await empresaAlvo(ctx, input);
      const d = await dadosEmpresa(ctx, empresa_id, input.filtros || {});
      const hoje = ctx.now().toISOString().slice(0, 10);
      return {
        financeiro: dashboardFinanceiro({ ...d, hoje }),
        operacional: {
          dividas_proprias: d.dividas.filter((x) => x.modalidade_cobranca === 'AUTOCONTRATADA').length,
          dividas_hs: d.dividas.filter((x) => x.modalidade_cobranca === 'HS_GERENCIADA').length,
          casos_por_status: d.casos.reduce((acc, c) => ({ ...acc, [c.status_operacional]: (acc[c.status_operacional] || 0) + 1 }), {}),
          pagamentos_aguardando_confirmacao: d.pagamentos.filter((p) => ['INFORMADO', 'EM_CONFIRMACAO'].includes(p.status_confirmacao)).length,
          aprovacoes_pendentes: d.negociacoes.filter((n) => n.status === 'AGUARDANDO_APROVACAO_CREDOR').length,
        },
        serie: serieMensal(d.pagamentos, 12, hoje),
      };
    },
  },

  /** Painel administrativo Acorly — somente registros reais; recuperado = confirmados. */
  dashboardHS: {
    perm: 'relatorio.hs',
    async run(ctx, input = {}) {
      const f = input.filtros || {};
      const hoje = ctx.now().toISOString().slice(0, 10);
      const [empresas, assinaturas, contratos, carteiras, usuarios] = await Promise.all([
        find(ctx, 'Empresa'), find(ctx, 'Assinatura'), find(ctx, 'ContratoServico'), find(ctx, 'Carteira', { modalidade: 'HS_GERENCIADA' }), find(ctx, 'UsuarioPlataforma', { perfil: 'OPERADOR_HS' }),
      ]);
      let casos = await find(ctx, 'CasoCobranca', { modalidade_cobranca: 'HS_GERENCIADA' });
      if (f.modalidade === 'AUTOCONTRATADA' && ctx.user.perfil === 'SUPERADMIN_HS') casos = await find(ctx, 'CasoCobranca', { modalidade_cobranca: 'AUTOCONTRATADA' });
      if (f.empresa_id) casos = casos.filter((c) => c.empresa_id === f.empresa_id);
      if (f.operador_id) casos = casos.filter((c) => c.operador_id === f.operador_id);
      if (f.gestor_id) casos = casos.filter((c) => c.gestor_id === f.gestor_id);
      if (f.status) casos = casos.filter((c) => c.status_operacional === f.status);
      if (f.de || f.ate) casos = casos.filter((c) => entre(c.data_recebimento, f.de, f.ate));
      const casoIds = new Set(casos.map((c) => c.id));
      const dividaIds = new Set(casos.map((c) => c.divida_id));
      const [pagamentosTodos, acordosTodos, interacoesTodas] = await Promise.all([find(ctx, 'Pagamento'), find(ctx, 'Acordo'), find(ctx, 'Interacao')]);
      const pagamentos = pagamentosTodos.filter((p) => dividaIds.has(p.divida_id));
      const acordos = acordosTodos.filter((a) => casoIds.has(a.caso_id));
      const interacoes = interacoesTodas.filter((i) => casoIds.has(i.caso_id));
      const mes = hoje.slice(0, 7);
      const ativos = casos.filter((c) => !['RECUPERADO_INTEGRALMENTE', 'SEM_SUCESSO'].includes(c.status_operacional));
      const resposta = {
        empresas_cadastradas: empresas.length,
        empresas_ativas: empresas.filter((e) => e.status === 'ATIVA').length,
        assinaturas_ativas: assinaturas.filter((a) => a.status === 'ATIVA').length,
        empresas_cobranca_gerenciada: new Set(contratos.filter((c) => c.status === 'ATIVO').map((c) => c.empresa_id)).size,
        carteiras_recebidas: carteiras.filter((c) => c.status !== 'RASCUNHO' && (!f.empresa_id || c.empresa_id === f.empresa_id)).length,
        dividas_em_operacao: ativos.length,
        casos_aguardando_validacao: casos.filter((c) => c.status_operacional === 'AGUARDANDO_VALIDACAO').length,
        casos_aguardando_operador: casos.filter((c) => ['PRONTO_PARA_COBRANCA', 'AGUARDANDO_OPERADOR'].includes(c.status_operacional)).length,
        casos_em_negociacao: casos.filter((c) => c.status_operacional === 'EM_NEGOCIACAO').length,
        acordos_ativos: acordos.filter((a) => a.status === 'ATIVO').length,
        valor_informado_pago_centavos: soma(pagamentos.filter((p) => ['INFORMADO', 'EM_CONFIRMACAO'].includes(p.status_confirmacao)).map((p) => p.valor_centavos)),
        valor_recuperado_confirmado_centavos: soma(pagamentos.filter((p) => p.status_confirmacao === 'CONFIRMADO' && (!(f.de || f.ate) || entre(p.data_confirmacao, f.de, f.ate))).map((p) => p.valor_confirmado_centavos ?? p.valor_centavos)),
        operadores_ativos: usuarios.filter((u) => u.status === 'ATIVO').length,
        produtividade_mensal: usuarios.map((u) => ({
          operador_id: u.id, nome: u.nome,
          interacoes: interacoes.filter((i) => i.operador_id === u.id && i.data_hora.startsWith(mes)).length,
          acordos: acordos.filter((a) => a.formalizado_por === u.id && (a.data_aceite || '').startsWith(mes)).length,
          casos_ativos: ativos.filter((c) => c.operador_id === u.id).length,
        })),
        serie: serieMensal(pagamentos, 12, hoje),
      };
      if (ctx.user.perfil !== 'SUPERADMIN_HS') { delete resposta.assinaturas_ativas; }
      return resposta;
    },
  },

  gerarPrestacaoContas: {
    perm: null,
    async run(ctx, { contrato_servico_id, periodo_inicio, periodo_fim, enviar = false }) {
      const contrato = await getById(ctx, 'ContratoServico', contrato_servico_id);
      if (!contrato) throw new AccessError('Contrato não encontrado', 404);
      if (isHS(ctx.user)) requirePerm(ctx.user, 'prestacao.gerar');
      else { requirePerm(ctx.user, 'relatorio.empresa'); if (contrato.empresa_id !== ctx.user.empresa_id) throw new AccessError('Contrato não encontrado', 404); }
      exigir(/^\d{4}-\d{2}-\d{2}$/.test(periodo_inicio || '') && /^\d{4}-\d{2}-\d{2}$/.test(periodo_fim || '') && periodo_inicio <= periodo_fim, 'Período inválido');
      const p = await gerarPrestacao(ctx, contrato, periodo_inicio, periodo_fim);
      if (enviar && isHS(ctx.user)) return enviarPrestacao(ctx, p);
      return p;
    },
  },

  /** Envia (ou reenvia) a prestação de contas por e-mail e aviso no sistema ao administrador e ao financeiro da empresa. */
  enviarPrestacaoContas: {
    perm: 'prestacao.gerar',
    async run(ctx, { prestacao_id }) {
      const p = await getById(ctx, 'PrestacaoContas', prestacao_id);
      if (!p) throw new AccessError('Prestação de contas não encontrada', 404);
      return enviarPrestacao(ctx, p);
    },
  },

  /** Gera e envia a prestação de contas de um mês para todos os contratos de cobrança gerenciada (sem duplicar). */
  gerarPrestacoesDoMes: {
    perm: 'prestacao.gerar',
    async run(ctx, { mes } = {}) {
      exigir(!mes || /^\d{4}-\d{2}$/.test(mes), 'Mês inválido (use AAAA-MM)');
      return prestacoesDoMes(ctx, mes || mesAnterior(ctx.now()));
    },
  },

  listarPrestacoes: {
    perm: null,
    async run(ctx, input = {}) {
      if (isHS(ctx.user)) { requirePerm(ctx.user, 'prestacao.gerar'); return find(ctx, 'PrestacaoContas', input.contrato_servico_id ? { contrato_servico_id: input.contrato_servico_id } : {}); }
      requirePerm(ctx.user, 'relatorio.empresa');
      return find(ctx, 'PrestacaoContas', { empresa_id: ctx.user.empresa_id });
    },
  },

  /** Exportação CSV (planilha) respeitando escopo. */
  exportarCSV: {
    perm: 'relatorio.exportar',
    async run(ctx, input = {}) {
      const empresa_id = await empresaAlvo(ctx, input);
      const hoje = ctx.now().toISOString().slice(0, 10);
      const reais = (c) => (c == null ? '' : formatBRL(c).replace('R$ ', ''));
      let csv;
      if (input.tipo === 'dividas') {
        const devs = new Map((await find(ctx, 'Devedor', { empresa_id })).map((d) => [d.id, d]));
        const rows = await find(ctx, 'Divida', { empresa_id });
        csv = toCSV(rows, [
          { titulo: 'Devedor', valor: (r) => devs.get(r.devedor_id)?.nome }, { titulo: 'CPF/CNPJ', valor: (r) => devs.get(r.devedor_id)?.cpf_cnpj },
          { titulo: 'Documento', campo: 'documento_referencia' }, { titulo: 'Vencimento', campo: 'data_vencimento' },
          { titulo: 'Dias atraso', valor: (r) => diasAtraso(r.data_vencimento, hoje) }, { titulo: 'Valor original', valor: (r) => reais(r.valor_original_centavos) },
          { titulo: 'Saldo atual', valor: (r) => reais(r.saldo_atual_centavos) }, { titulo: 'Modalidade', campo: 'modalidade_cobranca' }, { titulo: 'Status', campo: 'status_financeiro' },
        ]);
      } else if (input.tipo === 'pagamentos') {
        const rows = await find(ctx, 'Pagamento', { empresa_id });
        const divs = new Map((await find(ctx, 'Divida', { empresa_id })).map((d) => [d.id, d]));
        const devs = new Map((await find(ctx, 'Devedor', { empresa_id })).map((d) => [d.id, d]));
        const dev = (r) => devs.get(divs.get(r.divida_id)?.devedor_id);
        csv = toCSV(rows, [
          { titulo: 'Devedor', valor: (r) => dev(r)?.nome }, { titulo: 'CPF/CNPJ', valor: (r) => dev(r)?.cpf_cnpj },
          { titulo: 'Documento da dívida', valor: (r) => divs.get(r.divida_id)?.documento_referencia }, { titulo: 'Data informada', campo: 'data_informada' },
          { titulo: 'Valor informado', valor: (r) => reais(r.valor_centavos) }, { titulo: 'Status', campo: 'status_confirmacao' },
          { titulo: 'Valor confirmado', valor: (r) => reais(r.valor_confirmado_centavos) }, { titulo: 'Comissão Acorly', valor: (r) => reais(r.comissao_hs_centavos) }, { titulo: 'Data confirmação', valor: (r) => (r.data_confirmacao || '').slice(0, 10) }, { titulo: 'Forma', campo: 'forma_pagamento' },
        ]);
      } else if (input.tipo === 'casos') {
        const rows = await find(ctx, 'CasoCobranca', { empresa_id });
        const devs = new Map((await find(ctx, 'Devedor', { empresa_id })).map((d) => [d.id, d]));
        csv = toCSV(rows, [
          { titulo: 'Devedor', valor: (r) => devs.get(r.devedor_id)?.nome }, { titulo: 'CPF/CNPJ', valor: (r) => devs.get(r.devedor_id)?.cpf_cnpj }, { titulo: 'Modalidade', campo: 'modalidade_cobranca' },
          { titulo: 'Status', campo: 'status_operacional' }, { titulo: 'Recebido em', campo: 'data_recebimento' }, { titulo: 'Última interação', campo: 'ultima_interacao' },
        ]);
      } else throw new AccessError('Tipo de exportação inválido', 422);
      await auditar(ctx, { acao: 'EXPORTAR_DADOS', entidade: input.tipo, empresa_id });
      return { nome_arquivo: `hs-${input.tipo}-${hoje}.csv`, conteudo: csv, mime: 'text/csv;charset=utf-8' };
    },
  },
};
