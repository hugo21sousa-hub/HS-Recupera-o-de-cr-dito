// Diagnóstico gratuito (leads do site): pedido público com planilha opcional, análise automática da
// carteira (quando a planilha é CSV), aviso à equipe e acompanhamento comercial.
import { parseCSV } from '../../core/csvImport.js';
import { parseReais, formatBRL } from '../../core/money.js';
import { emailValido, somenteDigitos } from '../../core/documento.js';
import { diasAtraso } from '../../core/dates.js';
import { faixaPara, calcularComissao, TABELA_PADRAO, rotuloFaixa } from '../../core/comissao.js';
import { ValidationError, AccessError, getById, find, criar, alterar, exigir, notificar, paginar, filtrosPermitidos } from '../context.js';

export const SEGMENTOS = ['ESCOLA_CURSO', 'SAUDE', 'ACADEMIA', 'CONDOMINIO', 'VAREJO', 'DISTRIBUIDORA', 'SERVICOS', 'IMOBILIARIA', 'OUTRO'];
export const STATUS_LEAD = ['NOVO', 'EM_CONTATO', 'DIAGNOSTICO_ENVIADO', 'CONVERTIDO', 'PERDIDO'];

const primeiro = (l, chaves) => { for (const k of chaves) if (l[k] !== undefined && String(l[k]).trim() !== '') return String(l[k]).trim(); return ''; };
const dataISO = (s) => {
  const v = String(s || '').trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) { const [d, m, y] = v.split('/'); return `${y}-${m}-${d}`; }
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
};

/**
 * Análise da carteira a partir de uma planilha CSV (aceita o modelo de importação e variações comuns):
 * total em aberto, quantidade, distribuição por tempo de atraso e comissão estimada se tudo for recuperado.
 */
export function analisarPlanilha(texto, { hoje, faixas = TABELA_PADRAO }) {
  const linhas = parseCSV(texto);
  exigir(linhas.length, 'Planilha vazia');
  const porFaixa = faixas.map((f, i) => ({ faixa: rotuloFaixa(faixas, i), bps: f.bps, quantidade: 0, valor_centavos: 0, comissao_centavos: 0 }));
  let validas = 0, ignoradas = 0, total = 0, somaDias = 0, avencer = 0;
  const devedores = new Set();
  for (const l of linhas.slice(0, 20000)) {
    let valor = null;
    try { valor = parseReais(primeiro(l, ['valor_original', 'valor', 'saldo', 'valor_em_aberto', 'valor_aberto', 'valor_devido', 'debito'])); } catch { valor = null; }
    const venc = dataISO(primeiro(l, ['data_vencimento', 'vencimento', 'data']));
    if (!valor || valor <= 0 || !venc) { ignoradas++; continue; }
    const dias = diasAtraso(venc, hoje);
    validas++; total += valor;
    devedores.add(somenteDigitos(primeiro(l, ['cpf_cnpj', 'cpf', 'cnpj', 'documento'])) || primeiro(l, ['nome', 'devedor', 'cliente']).toLowerCase() || `linha${validas}`);
    if (dias <= 0) { avencer += valor; continue; }
    somaDias += dias;
    const f = faixaPara(dias, faixas);
    const alvo = porFaixa[f.indice];
    alvo.quantidade++; alvo.valor_centavos += valor; alvo.comissao_centavos += calcularComissao(valor, f.bps);
  }
  const vencidas = porFaixa.reduce((a, f) => a + f.quantidade, 0);
  return {
    linhas: linhas.length, validas, ignoradas, devedores: devedores.size,
    total_centavos: total, vencido_centavos: total - avencer, a_vencer_centavos: avencer,
    atraso_medio_dias: vencidas ? Math.round(somaDias / vencidas) : 0,
    por_faixa: porFaixa, comissao_estimada_centavos: porFaixa.reduce((a, f) => a + f.comissao_centavos, 0),
  };
}

function validarPedido(d) {
  const t = (v, max) => String(v ?? '').trim().slice(0, max);
  const pedido = {
    nome: t(d.nome, 120), empresa: t(d.empresa, 160), cnpj: somenteDigitos(d.cnpj).slice(0, 14), email: t(d.email, 160).toLowerCase(),
    whatsapp: somenteDigitos(d.whatsapp).slice(0, 13), segmento: SEGMENTOS.includes(d.segmento) ? d.segmento : 'OUTRO',
    qtd_devedores: Math.max(0, Math.min(1e7, parseInt(d.qtd_devedores, 10) || 0)) || null, mensagem: t(d.mensagem, 2000),
    origem: t(d.origem, 200), cidade: t(d.cidade, 80),
  };
  exigir(pedido.nome.length >= 2, 'Informe o seu nome');
  exigir(pedido.empresa.length >= 2, 'Informe o nome da empresa');
  exigir(emailValido(pedido.email), 'Informe um e-mail válido');
  exigir(!pedido.whatsapp || pedido.whatsapp.length >= 10, 'WhatsApp inválido: informe DDD e número');
  exigir(d.aceite_privacidade === true, 'É preciso concordar com a Política de Privacidade');
  let valor = null;
  if (d.valor_aberto) { try { valor = parseReais(d.valor_aberto); } catch { throw new ValidationError('Valor em aberto inválido'); } }
  pedido.valor_aberto_centavos = valor && valor > 0 ? valor : null;
  return pedido;
}

/** Registra o pedido (ctx de sistema). `planilha`: { file_uri, nome, texto? } já salva no armazenamento. */
export async function registrarLead(ctx, dados, planilha = null) {
  const pedido = validarPedido(dados);
  const agora = ctx.now().toISOString();
  let analise = null, erro_analise = null;
  if (planilha?.texto) {
    try {
      const cfg = (await find(ctx, 'ConfiguracaoHS', {}))[0];
      analise = analisarPlanilha(planilha.texto, { hoje: agora.slice(0, 10), faixas: cfg?.comissao_faixas?.length ? cfg.comissao_faixas : TABELA_PADRAO });
    } catch (e) { erro_analise = e.message; }
  }
  const lead = await criar(ctx, 'Lead', {
    ...pedido, status: 'NOVO', arquivo_uri: planilha?.file_uri || null, arquivo_nome: planilha?.nome || null,
    analise: analise ? JSON.stringify(analise) : null, erro_analise, aceite_privacidade_em: agora, recebido_em: agora, ip: dados.__ip || null,
    responsavel_id: null, observacoes: '',
  }, 'RECEBER_LEAD');
  const resumo = analise
    ? `${analise.devedores} devedor(es), ${formatBRL(analise.vencido_centavos)} vencido. Comissão estimada: ${formatBRL(analise.comissao_estimada_centavos)}.`
    : pedido.valor_aberto_centavos ? `Informou cerca de ${formatBRL(pedido.valor_aberto_centavos)} em aberto.` : 'Sem planilha.';
  await notificar(ctx, null, { perfis: ['SUPERADMIN_HS', 'GESTOR_OPERACOES_HS'], tipo: 'LEAD', titulo: `Novo pedido de diagnóstico: ${pedido.empresa}`, mensagem: `${pedido.nome} · ${pedido.email}${pedido.whatsapp ? ` · ${pedido.whatsapp}` : ''}\n${resumo}`, link: '/hs/leads' });
  if (ctx.aposConfirmar && ctx.email?.disponivel) {
    ctx.aposConfirmar.push(() => ctx.email.enviar({
      para: pedido.email, assunto: 'Recebemos seu pedido de diagnóstico — Acorly', titulo: 'Pedido de diagnóstico recebido',
      paragrafos: [
        `Olá, ${pedido.nome.split(' ')[0]}. Recebemos o pedido de diagnóstico gratuito da carteira da ${pedido.empresa}.`,
        'Em até 2 dias úteis, a nossa equipe entra em contato com a análise: quanto da sua carteira pode ser recuperado, em quanto tempo e como funcionaria a cobrança.',
        'Enquanto isso, você pode conhecer o sistema na demonstração ou criar a sua conta com 7 dias grátis.',
      ],
      botao: { texto: 'Ver a demonstração', url: `${ctx.urlBase || ''}/demonstracao` },
    }));
  }
  return { id: lead.id, analise };
}

export const actions = {
  listarLeads: {
    perm: 'lead.gerenciar',
    async run(ctx, input = {}) {
      const rows = await find(ctx, 'Lead', filtrosPermitidos(input.filtros, ['status', 'segmento']));
      const pag = paginar(rows, { ...input, ordenarPor: 'recebido_em', camposBusca: ['empresa', 'nome', 'email', 'whatsapp', 'cidade'] });
      pag.itens = pag.itens.map((l) => ({ ...l, analise: l.analise ? JSON.parse(l.analise) : null, ip: undefined }));
      const todos = await find(ctx, 'Lead', {});
      pag.contagem = Object.fromEntries(STATUS_LEAD.map((s) => [s, todos.filter((l) => l.status === s).length]));
      return pag;
    },
  },

  atualizarLead: {
    perm: 'lead.gerenciar',
    async run(ctx, { id, status, observacoes, responsavel_id }) {
      const l = await getById(ctx, 'Lead', id);
      if (!l) throw new AccessError('Pedido não encontrado', 404);
      const patch = {};
      if (status !== undefined) { exigir(STATUS_LEAD.includes(status), 'Situação inválida'); patch.status = status; }
      if (observacoes !== undefined) patch.observacoes = String(observacoes).slice(0, 4000);
      if (responsavel_id !== undefined) patch.responsavel_id = responsavel_id || null;
      exigir(Object.keys(patch).length, 'Nada para atualizar');
      return alterar(ctx, 'Lead', l, patch, 'ATUALIZAR_LEAD');
    },
  },

  urlPlanilhaLead: {
    perm: 'lead.gerenciar',
    async run(ctx, { id }) {
      const l = await getById(ctx, 'Lead', id);
      if (!l?.arquivo_uri) throw new AccessError('Planilha não encontrada', 404);
      return { url: await ctx.files.signedUrl(l.arquivo_uri, 300) };
    },
  },
};
