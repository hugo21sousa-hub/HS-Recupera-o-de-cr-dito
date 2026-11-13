// Indicadores do negócio (superadmin): assinantes, receita recorrente, inadimplência, cancelamentos,
// testes grátis e comissão da cobrança gerenciada. Somente leitura, calculado dos registros reais.
import { find, getById } from '../context.js';
import { situacaoAcesso } from '../acesso.js';

const mesDe = (iso) => String(iso || '').slice(0, 7);
const PAGO = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);

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
      const empresas = await find(ctx, 'Empresa', {});
      const assinaturas = await find(ctx, 'Assinatura', {});
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

      // Receita recebida (assinaturas pagas pelo Asaas), sem contar o mesmo pagamento duas vezes
      const eventos = (await find(ctx, 'EventoAssinatura', { origem: 'GATEWAY' })).filter((x) => PAGO.has(x.tipo));
      const vistos = new Set();
      const recebidoPorMes = new Map();
      for (const ev of eventos) {
        let p = {};
        try { p = JSON.parse(ev.payload || '{}'); } catch { /* ignora */ }
        const chave = p.pagamento || ev.id;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        const m = mesDe(ev.data_hora);
        recebidoPorMes.set(m, (recebidoPorMes.get(m) || 0) + Math.round(Number(p.valor || 0) * 100));
      }
      // Comissão da cobrança gerenciada (pagamentos confirmados)
      const comissaoPorMes = new Map();
      for (const pg of await find(ctx, 'Pagamento', { status_confirmacao: 'CONFIRMADO' })) {
        if (!pg.comissao_hs_centavos) continue;
        const m = mesDe(pg.data_confirmacao);
        comissaoPorMes.set(m, (comissaoPorMes.get(m) || 0) + pg.comissao_hs_centavos);
      }

      // Cancelamentos: assinaturas pagas que foram canceladas (por mês)
      const cancelamentos = assinaturas.filter((a) => a.status === 'CANCELADA' && (a.ultimo_pagamento_em || a.gateway !== 'ASAAS'));
      const canceladasMes = cancelamentos.filter((a) => mesDe(a.updated_date) === mesAtual);
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
        const fimTeste = new Date(Date.parse(inicio) + 6 * 864e5).toISOString().slice(0, 10);
        if (fimTeste >= hoje || fimTeste < limite60) continue;
        testesEncerrados++;
        if (assinaturas.some((a) => a.empresa_id === e.id && (a.ultimo_pagamento_em || (a.gateway !== 'ASAAS' && ['ATIVA', 'INADIMPLENTE', 'CANCELADA', 'SUBSTITUIDA'].includes(a.status))))) convertidos++;
      }

      const meses = ultimosMeses(hoje, 6).map((m) => ({ mes: m, assinaturas_centavos: recebidoPorMes.get(m) || 0, comissao_centavos: comissaoPorMes.get(m) || 0 }));
      const ultimosCancelamentos = [];
      for (const a of cancelamentos.sort((x, y) => ((x.updated_date || '') < (y.updated_date || '') ? 1 : -1)).slice(0, 10)) {
        ultimosCancelamentos.push({ empresa: nomeEmpresa(await getById(ctx, 'Empresa', a.empresa_id)), plano: planos.get(a.plano_id)?.nome || '—', valor_centavos: a.valor_contratado_centavos || 0, em: a.updated_date });
      }
      return {
        gerado_em: agora,
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
