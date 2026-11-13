import { dashboardFinanceiro, prestacaoContas, toCSV } from '../../core/reports.js';
import { formatBRL, soma } from '../../core/money.js';
import { isHS } from '../../core/permissions.js';
import { diasAtraso } from '../../core/dates.js';
import { AccessError, requirePerm, getById, find, criar, empresaAlvo, exigir, auditar } from '../context.js';

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
    async run(ctx, { contrato_servico_id, periodo_inicio, periodo_fim }) {
      const contrato = await getById(ctx, 'ContratoServico', contrato_servico_id);
      if (!contrato) throw new AccessError('Contrato não encontrado', 404);
      if (isHS(ctx.user)) requirePerm(ctx.user, 'prestacao.gerar');
      else { requirePerm(ctx.user, 'relatorio.empresa'); if (contrato.empresa_id !== ctx.user.empresa_id) throw new AccessError('Contrato não encontrado', 404); }
      exigir(/^\d{4}-\d{2}-\d{2}$/.test(periodo_inicio || '') && /^\d{4}-\d{2}-\d{2}$/.test(periodo_fim || '') && periodo_inicio <= periodo_fim, 'Período inválido');
      const casos = await find(ctx, 'CasoCobranca', { contrato_servico_id: contrato.id });
      const ids = new Set(casos.map((c) => c.id));
      const dividas = new Set(casos.map((c) => c.divida_id));
      const q = { empresa_id: contrato.empresa_id };
      const [interacoes, negociacoes, acordos, pagamentos] = await Promise.all([find(ctx, 'Interacao', q), find(ctx, 'Negociacao', q), find(ctx, 'Acordo', q), find(ctx, 'Pagamento', q)]);
      const rel = prestacaoContas({
        casos: casos.filter((c) => !c.encerrado_por_retirada || c.status_operacional !== 'SEM_SUCESSO'),
        interacoes: interacoes.filter((i) => ids.has(i.caso_id)), negociacoes: negociacoes.filter((n) => ids.has(n.caso_id)),
        acordos: acordos.filter((a) => ids.has(a.caso_id)), pagamentos: pagamentos.filter((p) => dividas.has(p.divida_id)),
        inicio: periodo_inicio, fim: periodo_fim,
      });
      const empresa = await getById(ctx, 'Empresa', contrato.empresa_id);
      const devedores = new Map((await find(ctx, 'Devedor', { empresa_id: contrato.empresa_id })).map((d) => [d.id, d.nome]));
      const divs = new Map((await find(ctx, 'Divida', { empresa_id: contrato.empresa_id })).map((d) => [d.id, d]));
      rel.comissoes = pagamentos.filter((p) => dividas.has(p.divida_id) && p.status_confirmacao === 'CONFIRMADO' && p.data_confirmacao && p.data_confirmacao.slice(0, 10) >= periodo_inicio && p.data_confirmacao.slice(0, 10) <= periodo_fim)
        .map((p) => ({ data: p.data_confirmacao.slice(0, 10), devedor: devedores.get(divs.get(p.divida_id)?.devedor_id) || '—', valor_centavos: p.valor_confirmado_centavos ?? p.valor_centavos, comissao_bps: p.comissao_bps || 0, comissao_centavos: p.comissao_hs_centavos || 0 }));
      return criar(ctx, 'PrestacaoContas', {
        empresa_id: contrato.empresa_id, contrato_servico_id: contrato.id, periodo_inicio, periodo_fim, quantidade_casos: casos.length,
        valor_cobrado_centavos: contrato.valor_contratado_centavos || 0, valor_negociado_centavos: rel.valor_negociado_centavos, valor_confirmado_centavos: rel.valor_recuperado_centavos,
        relatorio: JSON.stringify({ ...rel, credor: empresa.razao_social, cnpj: empresa.cnpj, contrato: contrato.id, gerado_por: ctx.user.nome }), data_geracao: ctx.now().toISOString(),
      }, 'GERAR_PRESTACAO_CONTAS');
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
