// Indicadores do negócio (superadmin): assinantes, receita recorrente, inadimplência, cancelamentos,
// testes grátis e comissão da cobrança gerenciada. Somente leitura, calculado dos registros reais.
import { find, getById } from '../context.js';
import { situacaoAcesso, DIAS_TESTE } from '../acesso.js';

const mesDe = (iso) => String(iso || '').slice(0, 7);
const PAGO = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);
const ESTORNO = new Set(['PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED']);
const CANCELAMENTO = new Set(['SUBSCRIPTION_DELETED', 'SUBSCRIPTION_INACTIVATED']);

/** Empresas que ficam fora dos números: contas internas ou de teste marcadas pelo superadmin. */
export async function empresasDeTeste(ctx) {
  return new Set((await find(ctx, 'Empresa', {})).filter((e) => e.conta_teste).map((e) => e.id));
}

/**
 * Receitas automáticas por mês (AAAA-MM): mensalidades recebidas pelo Asaas (bruto e taxa, quando o Asaas informa o líquido),
 * menos estornos, e comissão da cobrança gerenciada sobre pagamentos confirmados.
 * Ficam de fora: contas de teste e pagamentos do ambiente de testes (sandbox) do Asaas.
 */
export async function receitasPorMes(ctx) {
  const assinaturas = new Map(), taxas = new Map(), comissao = new Map();
  const teste = await empresasDeTeste(ctx);
  const ambienteEmpresa = new Map((await find(ctx, 'Empresa', {})).map((e) => [e.id, e.asaas_ambiente]));
  const vistos = new Set(), estornados = new Set();
  const eventos = (await find(ctx, 'EventoAssinatura', { origem: 'GATEWAY' })).filter((x) => !teste.has(x.empresa_id)).sort((a, b) => ((a.data_hora || '') > (b.data_hora || '') ? 1 : -1));
  // pagamentos antes dos estornos (o estorno só desconta um pagamento já contado)
  for (const ev of [...eventos.filter((x) => PAGO.has(x.tipo)), ...eventos.filter((x) => ESTORNO.has(x.tipo))]) {
    const pago = PAGO.has(ev.tipo), estorno = ESTORNO.has(ev.tipo);
    if (!pago && !estorno) continue;
    let p = {};
    try { p = JSON.parse(ev.payload || '{}'); } catch { /* ignora */ }
    if ((p.ambiente || ambienteEmpresa.get(ev.empresa_id)) === 'sandbox') continue;
    const chave = p.pagamento || ev.id;
    const m = mesDe(ev.data_hora);
    const bruto = Math.round(Number(p.valor || 0) * 100);
    if (estorno) {
      // estorno de um pagamento já contado: sai da receita no mês em que foi devolvido
      if (!vistos.has(chave) || estornados.has(chave)) continue;
      estornados.add(chave);
      assinaturas.set(m, (assinaturas.get(m) || 0) - bruto);
      continue;
    }
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    assinaturas.set(m, (assinaturas.get(m) || 0) + bruto);
    if (p.liquido != null && Number(p.liquido) > 0) taxas.set(m, (taxas.get(m) || 0) + Math.max(0, bruto - Math.round(Number(p.liquido) * 100)));
  }
  for (const pg of await find(ctx, 'Pagamento', { status_confirmacao: 'CONFIRMADO' })) {
    if (!pg.comissao_hs_centavos || teste.has(pg.empresa_id)) continue;
    const m = mesDe(pg.data_confirmacao);
    comissao.set(m, (comissao.get(m) || 0) + pg.comissao_hs_centavos);
  }
  return { assinaturas, taxas, comissao };
}

function ultimosMeses(hojeISO, n) {
  const [a, m] = hojeISO.slice(0, 7).split('-').map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(a, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

export const actions = {
  indicadoresNegocio: {
    perm: 'plano.gerenciar',
    async run(ctx) {
      const agora = ctx.now().toISOString();
      const hoje = agora.slice(0, 10);
      const mesAtual = mesDe(hoje);
      const todas = await find(ctx, 'Empresa', {});
      const empresas = todas.filter((e) => !e.conta_teste);
      const ids = new Set(empresas.map((e) => e.id));
      const assinaturas = (await find(ctx, 'Assinatura', {})).filter((a) => ids.has(a.empresa_id));
      const planos = new Map((await find(ctx, 'Plano', {})).map((p) => [p.id, p]));
      const nomeEmpresa = (e) => e?.nome_fantasia || e?.razao_social || '—';

      // Situação de cada empresa (mesmas regras do controle de acesso)
      const porModo = { ATIVO: 0, TOLERANCIA: 0, TESTE: 0, SOMENTE_LEITURA: 0 };
      const inadimplentes = [], testesAcabando = [], semPlano = [];
      let mrr = 0, mrrEmRisco = 0;
      const porPlano = new Map();
      for (const e of empresas) {
        if (e.status === 'CANCELADA') continue;
        const s = await situacaoAcesso(ctx, e.id);
        porModo[s.modo] = (porModo[s.modo] || 0) + 1;
        const ass = assinaturas.find((a) => a.empresa_id === e.id && a.status === 'ATIVA') || assinaturas.find((a) => a.empresa_id === e.id && a.status === 'INADIMPLENTE');
        if (s.modo === 'ATIVO' || s.modo === 'TOLERANCIA') {
          const valor = ass?.valor_contratado_centavos || 0;
          if (s.modo === 'ATIVO') mrr += valor; else mrrEmRisco += valor;
          const p = planos.get(ass?.plano_id);
          const k = p?.nome || 'Sem plano';
          const atual = porPlano.get(k) || { plano: k, empresas: 0, receita_centavos: 0, ordem: p?.ordem ?? 99 };
          atual.empresas++; atual.receita_centavos += valor;
          porPlano.set(k, atual);
        }
        if (s.modo === 'TOLERANCIA' || (s.modo === 'SOMENTE_LEITURA' && s.motivo === 'ATRASO')) {
          inadimplentes.push({ empresa_id: e.id, empresa: nomeEmpresa(e), plano: s.plano?.nome || null, valor_centavos: ass?.valor_contratado_centavos || 0, atraso_desde: s.atraso_desde || null, situacao: s.modo === 'TOLERANCIA' ? 'Em tolerância' : 'Somente leitura', fatura_url: s.fatura_url || null });
          if (s.modo === 'SOMENTE_LEITURA') mrrEmRisco += ass?.valor_contratado_centavos || 0;
        }
        if (s.modo === 'TESTE' && s.dias_restantes <= 3) testesAcabando.push({ empresa_id: e.id, empresa: nomeEmpresa(e), email: e.email, teste_ate: s.teste_ate, dias_restantes: s.dias_restantes });
        if (s.modo === 'SOMENTE_LEITURA' && s.motivo === 'TESTE_ENCERRADO') semPlano.push({ empresa_id: e.id, empresa: nomeEmpresa(e), email: e.email, teste_ate: s.teste_ate, com_contrato: s.com_contrato });
      }

      // Receita recebida (assinaturas pagas pelo Asaas, sem repetir pagamento) e comissão da cobrança gerenciada
      const { assinaturas: recebidoPorMes, comissao: comissaoPorMes } = await receitasPorMes(ctx);

      // Cancelamentos: assinaturas pagas que foram canceladas (por mês)
      // Data real do cancelamento: o aviso de cancelamento do Asaas; sem ele, a última alteração da assinatura
      const canceladaEm = new Map();
      for (const ev of await find(ctx, 'EventoAssinatura', {})) if (CANCELAMENTO.has(ev.tipo) && ev.assinatura_id && !canceladaEm.has(ev.assinatura_id)) canceladaEm.set(ev.assinatura_id, ev.data_hora);
      const cancelamentos = assinaturas.filter((a) => a.status === 'CANCELADA' && (a.ultimo_pagamento_em || a.gateway !== 'ASAAS')).map((a) => ({ ...a, cancelada_em: canceladaEm.get(a.id) || a.updated_date }));
      const canceladasMes = cancelamentos.filter((a) => mesDe(a.cancelada_em) === mesAtual);
      const empresasCanceladasMes = empresas.filter((e) => e.status === 'CANCELADA' && mesDe(e.updated_date) === mesAtual);
      const totalCancelMes = new Set([...canceladasMes.map((a) => a.empresa_id), ...empresasCanceladasMes.map((e) => e.id)]).size;
      const pagantes = porModo.ATIVO + porModo.TOLERANCIA;
      const churn = pagantes + totalCancelMes ? Math.round((totalCancelMes / (pagantes + totalCancelMes)) * 10000) : 0;

      // Conversão do teste grátis: empresas cujo teste terminou nos últimos 60 dias
      const limite60 = new Date(Date.parse(hoje) - 60 * 864e5).toISOString().slice(0, 10);
      let testesEncerrados = 0, convertidos = 0;
      for (const e of empresas) {
        const inicio = (e.data_cadastro || e.created_date || '').slice(0, 10);
        if (!inicio) continue;
        const fimTeste = new Date(Date.parse(inicio) + (DIAS_TESTE - 1) * 864e5).toISOString().slice(0, 10);
        if (fimTeste >= hoje || fimTeste < limite60) continue;
        testesEncerrados++;
        if (assinaturas.some((a) => a.empresa_id === e.id && (a.ultimo_pagamento_em || (a.gateway !== 'ASAAS' && ['ATIVA', 'INADIMPLENTE', 'CANCELADA', 'SUBSTITUIDA'].includes(a.status))))) convertidos++;
      }

      const meses = ultimosMeses(hoje, 6).map((m) => ({ mes: m, assinaturas_centavos: recebidoPorMes.get(m) || 0, comissao_centavos: comissaoPorMes.get(m) || 0 }));
      const ultimosCancelamentos = [];
      for (const a of cancelamentos.sort((x, y) => ((x.cancelada_em || '') < (y.cancelada_em || '') ? 1 : -1)).slice(0, 10)) {
        ultimosCancelamentos.push({ empresa: nomeEmpresa(await getById(ctx, 'Empresa', a.empresa_id)), plano: planos.get(a.plano_id)?.nome || '—', valor_centavos: a.valor_contratado_centavos || 0, em: a.cancelada_em });
      }
      return {
        gerado_em: agora,
        contas_teste: todas.length - empresas.length,
        assinantes_ativos: pagantes,
        em_dia: porModo.ATIVO,
        em_tolerancia: porModo.TOLERANCIA,
        em_teste: porModo.TESTE,
        somente_leitura: porModo.SOMENTE_LEITURA,
        mrr_centavos: mrr,
        mrr_em_risco_centavos: mrrEmRisco,
        ticket_medio_centavos: porModo.ATIVO ? Math.round(mrr / porModo.ATIVO) : 0,
        recebido_mes_centavos: recebidoPorMes.get(mesAtual) || 0,
        comissao_mes_centavos: comissaoPorMes.get(mesAtual) || 0,
        cancelamentos_mes: totalCancelMes,
        churn_bps: churn,
        conversao_teste: { encerrados: testesEncerrados, convertidos, taxa_bps: testesEncerrados ? Math.round((convertidos / testesEncerrados) * 10000) : 0 },
        por_plano: [...porPlano.values()].sort((a, b) => a.ordem - b.ordem).map(({ ordem, ...r }) => r),
        meses,
        inadimplentes: inadimplentes.sort((a, b) => ((a.atraso_desde || '') > (b.atraso_desde || '') ? 1 : -1)),
        testes_acabando: testesAcabando.sort((a, b) => a.dias_restantes - b.dias_restantes),
        teste_encerrado_sem_plano: semPlano.slice(0, 50),
        ultimos_cancelamentos: ultimosCancelamentos,
      };
    },
  },
};
