import { soma, taxaBps } from './money.js';

const STATUS_NEG_ABERTA = new Set(['RASCUNHO', 'APROVADA_ALCADA', 'AGUARDANDO_APROVACAO_CREDOR', 'APROVADA_CREDOR']);

/**
 * Dashboard financeiro. "Recuperado" = SOMENTE pagamentos CONFIRMADOS.
 * Propostas, promessas e acordos nunca entram em valores recuperados.
 */
export function dashboardFinanceiro({ dividas, negociacoes, acordos, pagamentos, hoje = new Date().toISOString().slice(0, 10) }) {
  const ativas = dividas.filter((d) => d.status_financeiro !== 'CANCELADA');
  const confirmados = pagamentos.filter((p) => p.status_confirmacao === 'CONFIRMADO');
  const informados = pagamentos.filter((p) => p.status_confirmacao === 'INFORMADO' || p.status_confirmacao === 'EM_CONFIRMACAO');
  const valor_original = soma(ativas.map((d) => d.valor_original_centavos));
  const recuperado = soma(confirmados.map((p) => p.valor_confirmado_centavos ?? p.valor_centavos));
  return {
    valor_original_centavos: valor_original,
    saldo_em_atraso_centavos: soma(ativas.filter((d) => d.data_vencimento < hoje).map((d) => d.saldo_atual_centavos)),
    valor_encaminhado_hs_centavos: soma(ativas.filter((d) => d.modalidade_cobranca === 'HS_GERENCIADA').map((d) => d.saldo_atual_centavos)),
    valor_em_negociacao_centavos: soma(negociacoes.filter((n) => STATUS_NEG_ABERTA.has(n.status)).map((n) => n.valor_proposto_centavos)),
    valor_acordos_centavos: soma(acordos.filter((a) => a.status === 'ATIVO' || a.status === 'CUMPRIDO').map((a) => a.valor_acordado_centavos)),
    valor_informado_pago_centavos: soma(informados.map((p) => p.valor_centavos)),
    valor_recuperado_confirmado_centavos: recuperado,
    saldo_pendente_centavos: soma(ativas.map((d) => d.saldo_atual_centavos)),
    taxa_recuperacao_bps: taxaBps(recuperado, valor_original),
    comissao_hs_centavos: soma(confirmados.map((p) => p.comissao_hs_centavos || 0)),
    quantidade_dividas: ativas.length,
  };
}

/** Prestação de contas de um contrato/período. */
export function prestacaoContas({ casos, interacoes, negociacoes, acordos, pagamentos, inicio, fim }) {
  const noPeriodo = (iso) => iso && iso.slice(0, 10) >= inicio && iso.slice(0, 10) <= fim;
  const ints = interacoes.filter((i) => noPeriodo(i.data_hora));
  const pagsPeriodo = pagamentos.filter((p) => noPeriodo(p.created_date || p.data_informada));
  const confirmados = pagamentos.filter((p) => p.status_confirmacao === 'CONFIRMADO' && noPeriodo(p.data_confirmacao));
  const negs = negociacoes.filter((n) => noPeriodo(n.data_proposta));
  return {
    periodo_inicio: inicio,
    periodo_fim: fim,
    casos_recebidos: casos.filter((c) => noPeriodo(c.data_recebimento)).length,
    casos_trabalhados: new Set(ints.map((i) => i.caso_id)).size,
    contatos_realizados: ints.filter((i) => i.tipo_interacao !== 'NOTA_INTERNA').length,
    respostas_recebidas: ints.filter((i) => i.tipo_interacao === 'RESPOSTA_DEVEDOR' || i.resultado === 'RESPONDEU').length,
    negociacoes_iniciadas: negs.length,
    valor_negociado_centavos: soma(negs.map((n) => n.valor_proposto_centavos)),
    acordos_realizados: acordos.filter((a) => noPeriodo(a.data_aceite)).length,
    pagamentos_informados: pagsPeriodo.length,
    valor_informado_centavos: soma(pagsPeriodo.map((p) => p.valor_centavos)),
    pagamentos_confirmados: confirmados.length,
    valor_recuperado_centavos: soma(confirmados.map((p) => p.valor_confirmado_centavos ?? p.valor_centavos)),
    comissao_hs_centavos: soma(confirmados.map((p) => p.comissao_hs_centavos || 0)),
    casos_suspensos: casos.filter((c) => c.status_operacional === 'SUSPENSO').length,
    casos_sem_sucesso: casos.filter((c) => c.status_operacional === 'SEM_SUCESSO').length,
  };
}

export function toCSV(rows, colunas) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // mitiga CSV/formula injection
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = colunas.map((c) => esc(c.titulo)).join(';');
  const body = rows.map((r) => colunas.map((c) => esc(typeof c.valor === 'function' ? c.valor(r) : r[c.campo])).join(';'));
  return '﻿' + [head, ...body].join('\r\n');
}
