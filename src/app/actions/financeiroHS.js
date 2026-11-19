// Gestão financeira da HS (superadmin): lançamentos de despesas e receitas, contas a pagar, despesas recorrentes
// (equipe, sistemas, contador…) e DRE mensal gerencial com fechamento do mês.
import { parseReais } from '../../core/money.js';
import { AccessError, getById, find, criar, alterar, exigir, notificar, auditar } from '../context.js';
import { receitasPorMes } from './negocio.js';

export const CATEGORIAS_DESPESA = {
  EQUIPE: 'Equipe (salários, pró-labore, comissões de operadores, benefícios)',
  INFRAESTRUTURA: 'Sistemas e infraestrutura (servidor, banco, e-mail, domínio, IA)',
  MARKETING: 'Marketing e vendas',
  ADMINISTRATIVO: 'Administrativo (contador, aluguel, telefone, materiais)',
  SERVICOS_TERCEIROS: 'Serviços de terceiros (jurídico, consultoria, freelancers)',
  PARCEIROS: 'Comissões de parceiros (indicação)',
  TAXAS: 'Taxas de cobrança e tarifas bancárias',
  IMPOSTOS: 'Impostos sobre o faturamento (DAS, ISS)',
  FINANCEIRAS: 'Despesas financeiras (juros, IOF, multas)',
  OUTRAS_DESPESAS: 'Outras despesas',
};
export const CATEGORIAS_RECEITA = {
  OUTRAS_RECEITAS: 'Outras receitas de serviços',
  RECEITAS_FINANCEIRAS: 'Receitas financeiras (rendimentos)',
};
const FORMAS = ['PIX', 'BOLETO', 'CARTAO', 'TRANSFERENCIA', 'DEBITO_AUTOMATICO', 'DINHEIRO', 'OUTRO'];
const reMes = /^\d{4}-(0[1-9]|1[0-2])$/;
const reDia = /^\d{4}-\d{2}-\d{2}$/;

export const hojeBR = (ctx) => new Date(ctx.now().getTime() - 3 * 3600e3).toISOString().slice(0, 10);
export const mesBR = (ctx) => hojeBR(ctx).slice(0, 7);
export function somaMes(m, n) { const [a, mm] = m.split('-').map(Number); const d = new Date(Date.UTC(a, mm - 1 + n, 1)); return d.toISOString().slice(0, 7); }
const ultimoDia = (m) => { const [a, mm] = m.split('-').map(Number); return new Date(Date.UTC(a, mm, 0)).getUTCDate(); };
const venceNo = (m, dia) => `${m}-${String(Math.min(Math.max(1, dia), ultimoDia(m))).padStart(2, '0')}`;

async function configuracao(ctx) {
  return (await find(ctx, 'ConfiguracaoHS', {}))[0] || ctx.db.ConfiguracaoHS.create({});
}
async function mesFechado(ctx, mes) {
  return (await find(ctx, 'FechamentoMes', { mes }))[0] || null;
}
async function exigirAberto(ctx, mes) {
  const f = await mesFechado(ctx, mes);
  exigir(!f, `O mês ${mes.slice(5)}/${mes.slice(0, 4)} já foi fechado. Reabra o mês para alterar os lançamentos dele.`);
}
const valorCentavos = (v) => { let c = null; try { c = parseReais(v); } catch { c = null; } exigir(c && c > 0, 'Informe o valor'); return c; };

/** Cria os lançamentos das despesas/receitas recorrentes até o mês seguinte ao atual (sem duplicar). */
export async function garantirRecorrencias(ctx) {
  const ate = somaMes(mesBR(ctx), 1);
  const existentes = new Set((await find(ctx, 'LancamentoHS', {})).filter((l) => l.recorrencia_id).map((l) => `${l.recorrencia_id}|${l.competencia}`));
  let criados = 0;
  for (const r of await find(ctx, 'RecorrenciaHS', { ativa: true })) {
    for (let m = r.inicio; m <= ate && (!r.fim || m <= r.fim); m = somaMes(m, 1)) {
      if (existentes.has(`${r.id}|${m}`)) continue;
      if (await mesFechado(ctx, m)) continue;
      await ctx.db.LancamentoHS.create({
        tipo: r.tipo, categoria: r.categoria, descricao: r.descricao, fornecedor: r.fornecedor || '', valor_centavos: r.valor_centavos, competencia: m,
        vencimento: venceNo(m, r.dia_vencimento || 10), status: 'PENDENTE', forma_pagamento: r.forma_pagamento || '', recorrencia_id: r.id,
        criado_por: r.criado_por || null, criado_em: ctx.now().toISOString(), observacao: '',
      });
      existentes.add(`${r.id}|${m}`);
      criados++;
    }
  }
  return criados;
}

function linhaLancamento(l, hoje) {
  const vencido = l.status === 'PENDENTE' && l.vencimento && l.vencimento < hoje;
  return { ...l, vencido, rotulo_categoria: CATEGORIAS_DESPESA[l.categoria] || CATEGORIAS_RECEITA[l.categoria] || l.categoria };
}

/** DRE gerencial de um mês (regime de competência). */
export async function calcularDRE(ctx, mes, auto = null) {
  const a = auto || await receitasPorMes(ctx);
  const cfg = await configuracao(ctx);
  const comissoesParceiros = (await find(ctx, 'PagamentoParceiro', {})).filter((p) => (p.pago_em || '').slice(0, 7) === mes).reduce((s, p) => s + (p.valor_centavos || 0), 0);
  const lanc = (await find(ctx, 'LancamentoHS', { competencia: mes })).filter((l) => l.status !== 'CANCELADO');
  const soma = (tipo, cat) => lanc.filter((l) => l.tipo === tipo && l.categoria === cat).reduce((s, l) => s + l.valor_centavos, 0);
  const desp = (cat) => soma('DESPESA', cat);
  const mensalidades = a.assinaturas.get(mes) || 0, comissoes = a.comissao.get(mes) || 0, outras = soma('RECEITA', 'OUTRAS_RECEITAS');
  const receitaBruta = mensalidades + comissoes + outras;
  const impostosLancados = desp('IMPOSTOS');
  const aliquota = Number(cfg.financeiro_aliquota_bps || 0);
  const impostosEstimados = !impostosLancados && aliquota > 0;
  const impostos = impostosLancados || Math.round((receitaBruta * aliquota) / 10000);
  const taxasAsaas = a.taxas.get(mes) || 0;
  const taxas = desp('TAXAS') + taxasAsaas;
  const receitaLiquida = receitaBruta - impostos - taxas;
  const custos = { INFRAESTRUTURA: desp('INFRAESTRUTURA'), PARCEIROS: desp('PARCEIROS') + comissoesParceiros };
  const custoTotal = custos.INFRAESTRUTURA + custos.PARCEIROS;
  const lucroBruto = receitaLiquida - custoTotal;
  const despesas = { EQUIPE: desp('EQUIPE'), MARKETING: desp('MARKETING'), ADMINISTRATIVO: desp('ADMINISTRATIVO'), SERVICOS_TERCEIROS: desp('SERVICOS_TERCEIROS'), OUTRAS_DESPESAS: desp('OUTRAS_DESPESAS') };
  const despesaTotal = Object.values(despesas).reduce((s, v) => s + v, 0);
  const resultadoOperacional = lucroBruto - despesaTotal;
  const financeiro = soma('RECEITA', 'RECEITAS_FINANCEIRAS') - desp('FINANCEIRAS');
  const lucro = resultadoOperacional + financeiro;
  const L = (rotulo, valor, nivel = 1, extra = {}) => ({ rotulo, valor_centavos: valor, nivel, ...extra });
  const linhas = [
    L('Receita bruta', receitaBruta, 0, { total: true }),
    L('Mensalidades da plataforma (Asaas)', mensalidades, 1, { automatico: true }),
    L('Comissões da cobrança gerenciada', comissoes, 1, { automatico: true }),
    L('Outras receitas de serviços', outras),
    L('(−) Deduções', -(impostos + taxas), 0, { total: true }),
    L(impostosEstimados ? `Impostos sobre o faturamento (estimado: ${(aliquota / 100).toFixed(2).replace('.', ',')}%)` : 'Impostos sobre o faturamento', -impostos, 1, { estimado: impostosEstimados }),
    L('Taxas de cobrança e tarifas', -taxas, 1, taxasAsaas ? { nota: `inclui ${(taxasAsaas / 100).toFixed(2).replace('.', ',')} de taxas do Asaas` } : {}),
    L('(=) Receita líquida', receitaLiquida, 0, { total: true, destaque: true }),
    L('(−) Custos dos serviços', -custoTotal, 0, { total: true }),
    L('Sistemas e infraestrutura', -custos.INFRAESTRUTURA),
    L('Comissões de parceiros', -custos.PARCEIROS, 1, comissoesParceiros ? { nota: 'inclui as comissões pagas no programa de indicação' } : {}),
    L('(=) Lucro bruto', lucroBruto, 0, { total: true, destaque: true }),
    L('(−) Despesas operacionais', -despesaTotal, 0, { total: true }),
    L('Equipe', -despesas.EQUIPE), L('Marketing e vendas', -despesas.MARKETING), L('Administrativo', -despesas.ADMINISTRATIVO),
    L('Serviços de terceiros', -despesas.SERVICOS_TERCEIROS), L('Outras despesas', -despesas.OUTRAS_DESPESAS),
    L('(=) Resultado operacional', resultadoOperacional, 0, { total: true, destaque: true }),
    L('(±) Resultado financeiro', financeiro, 0, { total: true }),
    L('(=) Lucro líquido do mês', lucro, 0, { total: true, final: true }),
  ];
  return { mes, linhas, receita_bruta_centavos: receitaBruta, receita_liquida_centavos: receitaLiquida, lucro_centavos: lucro, margem_bps: receitaBruta ? Math.round((lucro / receitaBruta) * 10000) : 0, impostos_estimados: impostosEstimados };
}

/** Avisa o superadmin, uma vez por dia, das contas que vencem hoje ou estão vencidas. */
export async function avisoContasPagar(ctx) {
  const hoje = hojeBR(ctx);
  const cfg = await configuracao(ctx);
  if (cfg.aviso_contas_em === hoje) return 0;
  await garantirRecorrencias(ctx);
  const pend = (await find(ctx, 'LancamentoHS', { status: 'PENDENTE' })).filter((l) => l.tipo === 'DESPESA' && l.vencimento && l.vencimento <= hoje);
  await ctx.db.ConfiguracaoHS.update(cfg.id, { aviso_contas_em: hoje });
  if (!pend.length) return 0;
  const total = pend.reduce((s, l) => s + l.valor_centavos, 0);
  const vencidas = pend.filter((l) => l.vencimento < hoje).length;
  await notificar(ctx, null, { perfis: ['SUPERADMIN_HS'], tipo: 'FINANCEIRO', titulo: `${pend.length} conta(s) a pagar ${vencidas ? `(${vencidas} vencida(s))` : 'vencendo hoje'}`, mensagem: `Total: R$ ${(total / 100).toFixed(2).replace('.', ',')}. ${pend.slice(0, 5).map((l) => l.descricao).join(', ')}${pend.length > 5 ? '…' : ''}`, link: '/hs/financeiro' });
  return pend.length;
}

export const actions = {
  /** Visão geral: contas a pagar (vencidas, hoje, próximos 7 dias), resultado do mês e caixa do mês. */
  painelFinanceiroHS: {
    perm: 'financeiro.hs',
    async run(ctx) {
      await garantirRecorrencias(ctx);
      const hoje = hojeBR(ctx), mes = mesBR(ctx);
      const em7 = new Date(Date.parse(`${hoje}T12:00:00Z`) + 7 * 864e5).toISOString().slice(0, 10);
      const todos = (await find(ctx, 'LancamentoHS', {})).filter((l) => l.status !== 'CANCELADO');
      const pagar = todos.filter((l) => l.tipo === 'DESPESA' && l.status === 'PENDENTE');
      const auto = await receitasPorMes(ctx);
      const dre = await calcularDRE(ctx, mes, auto);
      const pagosMes = todos.filter((l) => l.status === 'PAGO' && (l.pago_em || '').slice(0, 7) === mes);
      const parceirosMes = (await find(ctx, 'PagamentoParceiro', {})).filter((p) => (p.pago_em || '').slice(0, 7) === mes).reduce((s, p) => s + (p.valor_centavos || 0), 0);
      const entradas = (auto.assinaturas.get(mes) || 0) - (auto.taxas.get(mes) || 0) + pagosMes.filter((l) => l.tipo === 'RECEITA').reduce((s, l) => s + l.valor_centavos, 0);
      const saidas = pagosMes.filter((l) => l.tipo === 'DESPESA').reduce((s, l) => s + l.valor_centavos, 0) + parceirosMes;
      const soma = (xs) => xs.reduce((s, l) => s + l.valor_centavos, 0);
      const vencidas = pagar.filter((l) => l.vencimento < hoje), deHoje = pagar.filter((l) => l.vencimento === hoje), proximas = pagar.filter((l) => l.vencimento > hoje && l.vencimento <= em7);
      return {
        hoje, mes,
        vencidas: { qtd: vencidas.length, total_centavos: soma(vencidas) }, hoje_pagar: { qtd: deHoje.length, total_centavos: soma(deHoje) }, proximos_7: { qtd: proximas.length, total_centavos: soma(proximas) },
        a_pagar_lista: [...vencidas, ...deHoje, ...proximas].sort((a, b) => (a.vencimento > b.vencimento ? 1 : -1)).slice(0, 30).map((l) => linhaLancamento(l, hoje)),
        resultado_mes: { receita_bruta_centavos: dre.receita_bruta_centavos, lucro_centavos: dre.lucro_centavos, margem_bps: dre.margem_bps },
        caixa_mes: { entradas_centavos: entradas, saidas_centavos: saidas, saldo_centavos: entradas - saidas, nota: 'Entradas: mensalidades recebidas (líquidas de taxas) e receitas lançadas como recebidas. A comissão da cobrança gerenciada entra quando for faturada e lançada como receita recebida.' },
        despesas_por_categoria: Object.entries(CATEGORIAS_DESPESA).map(([k, rotulo]) => ({ categoria: k, rotulo, total_centavos: soma(todos.filter((l) => l.tipo === 'DESPESA' && l.competencia === mes && l.categoria === k)) + (k === 'PARCEIROS' ? parceirosMes : 0) })).filter((c) => c.total_centavos > 0).sort((a, b) => b.total_centavos - a.total_centavos),
      };
    },
  },

  listarLancamentosHS: {
    perm: 'financeiro.hs',
    async run(ctx, { mes, tipo, status, categoria, busca, filtros = {}, page = 1, pageSize = 50 } = {}) {
      await garantirRecorrencias(ctx);
      const m = mes || filtros.mes || mesBR(ctx);
      exigir(reMes.test(m), 'Mês inválido');
      const t = tipo || filtros.tipo, st = status || filtros.status, cat = categoria || filtros.categoria;
      const hoje = hojeBR(ctx);
      let rows = await find(ctx, 'LancamentoHS', { competencia: m });
      if (t) rows = rows.filter((l) => l.tipo === t);
      if (st === 'VENCIDO') rows = rows.filter((l) => l.status === 'PENDENTE' && l.vencimento < hoje);
      else if (st) rows = rows.filter((l) => l.status === st);
      else rows = rows.filter((l) => l.status !== 'CANCELADO');
      if (cat) rows = rows.filter((l) => l.categoria === cat);
      if (busca) { const q = String(busca).toLowerCase(); rows = rows.filter((l) => `${l.descricao} ${l.fornecedor} ${l.observacao}`.toLowerCase().includes(q)); }
      rows.sort((a, b) => ((a.vencimento || '') > (b.vencimento || '') ? 1 : -1));
      const ativos = rows.filter((l) => l.status !== 'CANCELADO');
      const soma = (xs) => xs.reduce((s, l) => s + l.valor_centavos, 0);
      const tam = Math.min(200, Number(pageSize) || 50), ini = (Math.max(1, Number(page) || 1) - 1) * tam;
      return {
        itens: rows.slice(ini, ini + tam).map((l) => linhaLancamento(l, hoje)), total: rows.length, mes: m, fechado: !!(await mesFechado(ctx, m)),
        totais: {
          despesas_centavos: soma(ativos.filter((l) => l.tipo === 'DESPESA')), receitas_centavos: soma(ativos.filter((l) => l.tipo === 'RECEITA')),
          pago_centavos: soma(ativos.filter((l) => l.tipo === 'DESPESA' && l.status === 'PAGO')), a_pagar_centavos: soma(ativos.filter((l) => l.tipo === 'DESPESA' && l.status === 'PENDENTE')),
        },
      };
    },
  },

  /** Cria ou edita um lançamento. Com `recorrente: true` (novo), cria também a recorrência mensal. */
  salvarLancamentoHS: {
    perm: 'financeiro.hs',
    async run(ctx, input) {
      const tipo = input.tipo === 'RECEITA' ? 'RECEITA' : 'DESPESA';
      const cats = tipo === 'RECEITA' ? CATEGORIAS_RECEITA : CATEGORIAS_DESPESA;
      exigir(cats[input.categoria], 'Escolha a categoria');
      const descricao = String(input.descricao || '').trim().slice(0, 160);
      exigir(descricao.length >= 2, 'Descreva o lançamento');
      const valor = valorCentavos(input.valor);
      exigir(reDia.test(input.vencimento || ''), 'Informe a data de vencimento');
      const competencia = reMes.test(input.competencia || '') ? input.competencia : input.vencimento.slice(0, 7);
      exigir(!input.forma_pagamento || FORMAS.includes(input.forma_pagamento), 'Forma de pagamento inválida');
      const dados = {
        tipo, categoria: input.categoria, descricao, fornecedor: String(input.fornecedor || '').trim().slice(0, 120), valor_centavos: valor, competencia,
        vencimento: input.vencimento, forma_pagamento: input.forma_pagamento || '', observacao: String(input.observacao || '').slice(0, 1000),
      };
      if (input.comprovante_uri) {
        if (ctx.files?.reivindicar) exigir(await ctx.files.reivindicar(input.comprovante_uri, ctx.authEmail), 'Arquivo do comprovante inválido. Envie de novo.');
        Object.assign(dados, { comprovante_uri: input.comprovante_uri, comprovante_nome: String(input.comprovante_nome || 'comprovante').slice(0, 150) });
      }
      await exigirAberto(ctx, competencia);
      if (input.id) {
        const l = await getById(ctx, 'LancamentoHS', input.id);
        if (!l) throw new AccessError('Lançamento não encontrado', 404);
        await exigirAberto(ctx, l.competencia);
        return alterar(ctx, 'LancamentoHS', l, dados, 'EDITAR_LANCAMENTO_HS');
      }
      let recorrencia_id = null;
      if (input.recorrente) {
        const r = await criar(ctx, 'RecorrenciaHS', {
          tipo, categoria: input.categoria, descricao, fornecedor: dados.fornecedor, valor_centavos: valor, dia_vencimento: Number(input.vencimento.slice(8, 10)),
          inicio: competencia, fim: reMes.test(input.recorrente_ate || '') ? input.recorrente_ate : null, forma_pagamento: dados.forma_pagamento, ativa: true, criado_por: ctx.user.id, criado_em: ctx.now().toISOString(),
        }, 'CRIAR_RECORRENCIA_HS');
        recorrencia_id = r.id;
      }
      const pago = input.pago_em && reDia.test(input.pago_em);
      const l = await criar(ctx, 'LancamentoHS', { ...dados, status: pago ? 'PAGO' : 'PENDENTE', pago_em: pago ? input.pago_em : null, recorrencia_id, criado_por: ctx.user.id, criado_em: ctx.now().toISOString() }, 'CRIAR_LANCAMENTO_HS');
      if (recorrencia_id) await garantirRecorrencias(ctx);
      return l;
    },
  },

  /** Marca como pago/recebido (ou desfaz). Pode ser feito mesmo em mês fechado: o DRE é por competência. */
  pagarLancamentoHS: {
    perm: 'financeiro.hs',
    async run(ctx, { id, pago_em, forma_pagamento, desfazer, comprovante_uri, comprovante_nome }) {
      const l = await getById(ctx, 'LancamentoHS', id);
      if (!l) throw new AccessError('Lançamento não encontrado', 404);
      exigir(l.status !== 'CANCELADO', 'Lançamento cancelado');
      if (desfazer) return alterar(ctx, 'LancamentoHS', l, { status: 'PENDENTE', pago_em: null }, 'DESFAZER_PAGAMENTO_HS');
      exigir(reDia.test(pago_em || ''), 'Informe a data do pagamento');
      exigir(!forma_pagamento || FORMAS.includes(forma_pagamento), 'Forma de pagamento inválida');
      const patch = { status: 'PAGO', pago_em, forma_pagamento: forma_pagamento || l.forma_pagamento || '' };
      if (comprovante_uri) {
        if (ctx.files?.reivindicar) exigir(await ctx.files.reivindicar(comprovante_uri, ctx.authEmail), 'Arquivo do comprovante inválido. Envie de novo.');
        Object.assign(patch, { comprovante_uri, comprovante_nome: String(comprovante_nome || 'comprovante').slice(0, 150) });
      }
      return alterar(ctx, 'LancamentoHS', l, patch, 'PAGAR_LANCAMENTO_HS');
    },
  },

  cancelarLancamentoHS: {
    perm: 'financeiro.hs',
    async run(ctx, { id, motivo }) {
      const l = await getById(ctx, 'LancamentoHS', id);
      if (!l) throw new AccessError('Lançamento não encontrado', 404);
      await exigirAberto(ctx, l.competencia);
      return alterar(ctx, 'LancamentoHS', l, { status: 'CANCELADO', observacao: `${l.observacao ? `${l.observacao}\n` : ''}Cancelado: ${String(motivo || '').slice(0, 300)}` }, 'CANCELAR_LANCAMENTO_HS');
    },
  },

  urlComprovanteHS: {
    perm: 'financeiro.hs',
    async run(ctx, { id }) {
      const l = await getById(ctx, 'LancamentoHS', id);
      if (!l?.comprovante_uri) throw new AccessError('Comprovante não encontrado', 404);
      return { url: await ctx.files.signedUrl(l.comprovante_uri, 300) };
    },
  },

  listarRecorrenciasHS: {
    perm: 'financeiro.hs',
    async run(ctx) {
      return (await find(ctx, 'RecorrenciaHS', {})).sort((a, b) => (a.ativa === b.ativa ? (a.descricao > b.descricao ? 1 : -1) : a.ativa ? -1 : 1))
        .map((r) => ({ ...r, rotulo_categoria: CATEGORIAS_DESPESA[r.categoria] || CATEGORIAS_RECEITA[r.categoria] || r.categoria }));
    },
  },

  /** Altera valor/dia/fim de uma recorrência (vale para os meses ainda não lançados) ou encerra. */
  salvarRecorrenciaHS: {
    perm: 'financeiro.hs',
    async run(ctx, { id, valor, dia_vencimento, fim, ativa, descricao, aplicar_pendentes }) {
      const r = await getById(ctx, 'RecorrenciaHS', id);
      if (!r) throw new AccessError('Recorrência não encontrada', 404);
      const patch = {};
      if (valor !== undefined) patch.valor_centavos = valorCentavos(valor);
      if (dia_vencimento !== undefined) { const d = Number(dia_vencimento); exigir(d >= 1 && d <= 31, 'Dia de vencimento inválido'); patch.dia_vencimento = d; }
      if (fim !== undefined) { exigir(!fim || reMes.test(fim), 'Mês final inválido'); patch.fim = fim || null; }
      if (ativa !== undefined) patch.ativa = !!ativa;
      if (descricao !== undefined) { exigir(String(descricao).trim().length >= 2, 'Descreva a recorrência'); patch.descricao = String(descricao).trim().slice(0, 160); }
      const out = await alterar(ctx, 'RecorrenciaHS', r, patch, 'EDITAR_RECORRENCIA_HS');
      // atualiza os lançamentos futuros ainda pendentes (meses abertos)
      const mes = mesBR(ctx);
      for (const l of await find(ctx, 'LancamentoHS', { recorrencia_id: r.id, status: 'PENDENTE' })) {
        if (l.competencia < mes || await mesFechado(ctx, l.competencia)) continue;
        if (patch.ativa === false || (patch.fim && l.competencia > patch.fim)) { await ctx.db.LancamentoHS.update(l.id, { status: 'CANCELADO', observacao: 'Recorrência encerrada' }); continue; }
        if (aplicar_pendentes !== false) {
          const p2 = {};
          if (patch.valor_centavos) p2.valor_centavos = patch.valor_centavos;
          if (patch.dia_vencimento) p2.vencimento = venceNo(l.competencia, patch.dia_vencimento);
          if (patch.descricao) p2.descricao = patch.descricao;
          if (Object.keys(p2).length) await ctx.db.LancamentoHS.update(l.id, p2);
        }
      }
      return out;
    },
  },

  /** DRE do mês, com os 5 meses anteriores e o acumulado do ano para comparação. */
  dreMensal: {
    perm: 'financeiro.hs',
    async run(ctx, { mes } = {}) {
      await garantirRecorrencias(ctx);
      const m = mes || mesBR(ctx);
      exigir(reMes.test(m), 'Mês inválido');
      const fech = await mesFechado(ctx, m);
      const auto = await receitasPorMes(ctx);
      const atual = fech?.snapshot ? { ...fech.snapshot, fechado: true } : await calcularDRE(ctx, m, auto);
      const historico = [];
      for (let i = 5; i >= 1; i--) {
        const mm = somaMes(m, -i);
        const f = await mesFechado(ctx, mm);
        const d = f?.snapshot || await calcularDRE(ctx, mm, auto);
        historico.push({ mes: mm, receita_bruta_centavos: d.receita_bruta_centavos, lucro_centavos: d.lucro_centavos, margem_bps: d.margem_bps, fechado: !!f });
      }
      historico.push({ mes: m, receita_bruta_centavos: atual.receita_bruta_centavos, lucro_centavos: atual.lucro_centavos, margem_bps: atual.margem_bps, fechado: !!fech });
      const ano = [];
      for (let mm = `${m.slice(0, 4)}-01`; mm <= m; mm = somaMes(mm, 1)) {
        const f = await mesFechado(ctx, mm);
        ano.push(f?.snapshot || await calcularDRE(ctx, mm, auto));
      }
      const acumulado = { receita_bruta_centavos: ano.reduce((s, d) => s + d.receita_bruta_centavos, 0), lucro_centavos: ano.reduce((s, d) => s + d.lucro_centavos, 0) };
      const cfg = await configuracao(ctx);
      return { ...atual, fechado: !!fech, fechamento: fech ? { fechado_em: fech.fechado_em, observacao: fech.observacao } : null, historico, acumulado_ano: acumulado, aliquota_bps: Number(cfg.financeiro_aliquota_bps || 0) };
    },
  },

  /** Fecha o mês: guarda o DRE como registro e trava os lançamentos daquele mês. */
  fecharMesHS: {
    perm: 'financeiro.hs',
    async run(ctx, { mes, observacao }) {
      exigir(reMes.test(mes || ''), 'Mês inválido');
      exigir(mes < mesBR(ctx), 'Só é possível fechar um mês depois que ele terminar');
      exigir(!(await mesFechado(ctx, mes)), 'Este mês já está fechado');
      const snapshot = await calcularDRE(ctx, mes);
      return criar(ctx, 'FechamentoMes', { mes, snapshot, fechado_em: ctx.now().toISOString(), fechado_por: ctx.user.id, observacao: String(observacao || '').slice(0, 500) }, 'FECHAR_MES_HS');
    },
  },

  reabrirMesHS: {
    perm: 'financeiro.hs',
    async run(ctx, { mes, motivo }) {
      const f = await mesFechado(ctx, mes);
      exigir(f, 'Este mês não está fechado');
      exigir(String(motivo || '').trim().length >= 5, 'Informe o motivo da reabertura');
      await ctx.db.FechamentoMes.delete(f.id);
      await auditar(ctx, { acao: 'REABRIR_MES_HS', entidade: 'FechamentoMes', registro_id: f.id, antes: { mes, fechado_em: f.fechado_em }, depois: { mes, motivo: String(motivo).slice(0, 300) } });
      return { mes, reaberto: true };
    },
  },

  configurarFinanceiroHS: {
    perm: 'financeiro.hs',
    async run(ctx, { aliquota }) {
      const v = Number(String(aliquota ?? '').replace(',', '.'));
      exigir(Number.isFinite(v) && v >= 0 && v <= 40, 'Alíquota inválida (0 a 40%)');
      const cfg = await configuracao(ctx);
      await ctx.db.ConfiguracaoHS.update(cfg.id, { financeiro_aliquota_bps: Math.round(v * 100) });
      return { aliquota_bps: Math.round(v * 100) };
    },
  },

  categoriasFinanceiroHS: {
    perm: 'financeiro.hs',
    async run() { return { despesa: CATEGORIAS_DESPESA, receita: CATEGORIAS_RECEITA, formas: FORMAS }; },
  },
};
