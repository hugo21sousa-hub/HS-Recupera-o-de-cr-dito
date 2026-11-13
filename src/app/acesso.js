// Acesso da empresa conforme a assinatura: teste grátis, plano ativo, tolerância de atraso e somente leitura.
// Também libera cada recurso só nos planos que o incluem.
import { AccessError } from '../core/permissions.js';
import { find, getById } from './context.js';

export const DIAS_TESTE = 7;
export const DIAS_TOLERANCIA = 5;
export const LIMITES_TESTE = { devedores: 20, usuarios: 3 };

const DIA = 86400000;
const somaDias = (iso, d) => new Date(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') + d * DIA).toISOString().slice(0, 10);
const diasEntre = (de, ate) => Math.round((Date.parse(ate + 'T00:00:00Z') - Date.parse(de + 'T00:00:00Z')) / DIA);

export const RECURSOS = {
  carteiras: 'Carteiras', importacao: 'Importação de planilhas', negociacao: 'Negociação', relatorios: 'Relatórios', exportacao: 'Exportação',
};

// Ação → recurso do plano que ela exige (as demais fazem parte de todos os planos)
const RECURSO_DA_ACAO = {
  importarPlanilha: 'importacao',
  salvarCarteira: 'carteiras', adicionarDividasCarteira: 'carteiras', removerDividaCarteira: 'carteiras',
  simularNegociacao: 'negociacao', proporNegociacao: 'negociacao', formalizarAcordo: 'negociacao',
  gerarPrestacaoContas: 'relatorios',
  exportarCSV: 'exportacao',
};

// Ações que alteram dados (bloqueadas no modo somente leitura)
const ESCRITA = new Set([
  'salvarCarteira', 'adicionarDividasCarteira', 'removerDividaCarteira', 'previewEncaminhamento', 'encaminharParaHS', 'abrirCobrancaPropria', 'alterarModalidade',
  'salvarModeloMensagem', 'salvarDevedor', 'registrarNaoContatar', 'salvarDivida', 'cancelarDivida', 'salvarParcelas', 'importarPlanilha', 'anexarDocumento',
  'convidarUsuario', 'gerarLinkAcesso', 'salvarPoliticaRetencao',
  'simularNegociacao', 'proporNegociacao', 'cancelarNegociacao', 'formalizarAcordo', 'encerrarAcordo',
  'alterarStatusCaso', 'registrarInteracao', 'prepararWhatsApp', 'enviarWhatsApp', 'salvarTarefa', 'concluirTarefa',
  'informarPagamento', 'gerarPrestacaoContas',
]);
// Com contrato de cobrança gerenciada ativo, a empresa continua cadastrando e encaminhando dívidas ao Acorly
const LIBERADAS_COM_CONTRATO = new Set([
  'salvarDevedor', 'registrarNaoContatar', 'salvarDivida', 'cancelarDivida', 'salvarParcelas', 'importarPlanilha', 'anexarDocumento',
  'salvarCarteira', 'adicionarDividasCarteira', 'removerDividaCarteira', 'previewEncaminhamento', 'encaminharParaHS', 'convidarUsuario', 'gerarLinkAcesso',
]);

/** Situação de acesso da empresa. */
export async function situacaoAcesso(ctx, empresa_id) {
  ctx._acesso ??= {};
  if (ctx._acesso[empresa_id]) return ctx._acesso[empresa_id];
  const hoje = ctx.now().toISOString().slice(0, 10);
  const empresa = await getById(ctx, 'Empresa', empresa_id);
  const assinaturas = await find(ctx, 'Assinatura', { empresa_id });
  const ativa = assinaturas.find((a) => a.status === 'ATIVA');
  // Fatura vencida de quem já pagou alguma vez (uma primeira fatura nunca paga não tira o período de teste)
  const inadimplente = assinaturas.find((a) => a.status === 'INADIMPLENTE' && (a.ultimo_pagamento_em || a.gateway !== 'ASAAS'));
  const contratos = (await find(ctx, 'ContratoServico', { empresa_id, status: 'ATIVO' })).filter((c) => c.aceite && (!c.data_fim || c.data_fim >= hoje));
  const com_contrato = contratos.length > 0;
  const pendente = assinaturas.find((a) => a.status === 'AGUARDANDO_PAGAMENTO');
  let r;
  const ass = ativa || inadimplente;
  if (ass) {
    const plano = await getById(ctx, 'Plano', ass.plano_id);
    const atrasoDesde = ass.status === 'INADIMPLENTE' ? (ass.inadimplente_desde || ass.data_vencimento || hoje) : (ass.data_vencimento && ass.data_vencimento < hoje ? ass.data_vencimento : null);
    const base = { plano, assinatura_id: ass.id, limites: { devedores: plano?.limite_devedores || null, usuarios: plano?.limite_usuarios || null }, recursos: plano?.funcionalidades?.length ? plano.funcionalidades : Object.keys(RECURSOS), fatura_url: ass.fatura_url || pendente?.fatura_url || null };
    if (!atrasoDesde) r = { modo: 'ATIVO', ...base };
    else {
      const limite = somaDias(atrasoDesde, DIAS_TOLERANCIA);
      r = hoje <= limite
        ? { modo: 'TOLERANCIA', ...base, atraso_desde: atrasoDesde, pagar_ate: limite, bloqueio_em: somaDias(limite, 1), dias_restantes: diasEntre(hoje, limite) + 1 }
        : { modo: 'SOMENTE_LEITURA', motivo: 'ATRASO', ...base, atraso_desde: atrasoDesde };
    }
  } else {
    const inicio = (empresa?.data_cadastro || empresa?.created_date || ctx.now().toISOString()).slice(0, 10);
    const fim = somaDias(inicio, DIAS_TESTE - 1);
    r = hoje <= fim
      ? { modo: 'TESTE', plano: null, limites: { ...LIMITES_TESTE }, recursos: Object.keys(RECURSOS), teste_ate: fim, dias_restantes: diasEntre(hoje, fim) + 1, fatura_url: pendente?.fatura_url || null }
      : { modo: 'SOMENTE_LEITURA', motivo: 'TESTE_ENCERRADO', plano: null, limites: { ...LIMITES_TESTE }, recursos: [], teste_ate: fim, fatura_url: pendente?.fatura_url || null };
  }
  r.com_contrato = com_contrato;
  // Quem tem contrato de cobrança gerenciada encaminha sem o limite de devedores do plano
  if (com_contrato) r.limites = { ...r.limites, devedores: null };
  ctx._acesso[empresa_id] = r;
  return r;
}

/** Versão para as telas (sem o objeto do plano). */
export function resumoAcesso(s) {
  const { plano, ...resto } = s;
  return { ...resto, plano_nome: plano?.nome || null, dias_teste: DIAS_TESTE, dias_tolerancia: DIAS_TOLERANCIA };
}

/** Plano mais barato que inclui o recurso (para a mensagem de mudança de plano). */
async function planoComRecurso(ctx, recurso) {
  const planos = (await find(ctx, 'Plano', { status: 'ATIVO' })).filter((p) => (p.funcionalidades || []).includes(recurso));
  return planos.sort((a, b) => a.preco_mensal_centavos - b.preco_mensal_centavos)[0] || null;
}

/** Barra ações conforme a assinatura (usuários de empresa). */
export async function verificarAcessoDaAcao(ctx, empresa_id, action) {
  const recurso = RECURSO_DA_ACAO[action];
  if (!ESCRITA.has(action) && !recurso) return;
  const s = await situacaoAcesso(ctx, empresa_id);
  if (s.modo === 'SOMENTE_LEITURA') {
    if (!ESCRITA.has(action)) return; // consultas e exportação continuam liberadas: os dados são da empresa
    if (s.com_contrato && LIBERADAS_COM_CONTRATO.has(action)) return;
    const msg = s.motivo === 'ATRASO'
      ? 'Sua mensalidade está em atraso e o acesso ficou somente para consulta. Pague a fatura em Assinatura para voltar a cadastrar e editar.'
      : `Seu teste grátis de ${DIAS_TESTE} dias terminou e o acesso ficou somente para consulta. Assine um plano em Assinatura para continuar.`;
    throw Object.assign(new AccessError(msg, 403), { details: { assinatura: s.motivo } });
  }
  if (recurso && !s.recursos.includes(recurso)) {
    if (s.com_contrato && LIBERADAS_COM_CONTRATO.has(action)) return;
    const p = await planoComRecurso(ctx, recurso);
    throw Object.assign(new AccessError(`${RECURSOS[recurso]} não faz parte do seu plano${s.plano ? ` (${s.plano.nome})` : ''}.${p ? ` Disponível a partir do plano ${p.nome}.` : ''} Mude de plano em Assinatura.`, 403), { details: { recurso } });
  }
}
