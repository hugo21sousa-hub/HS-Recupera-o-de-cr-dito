// PDF da prestação de contas (cobrança gerenciada).
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { brl, data, dataHora, rotulo, pct, mascaraDoc } from './format.js';

const NOMES_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const mesCurto = (m) => `${NOMES_MES[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;

export function montarPDFPrestacao(p) {
  const rel = JSON.parse(p.relatorio);
  const doc = new jsPDF();
  const azul = [29, 95, 167];
  const titulo = (t, y) => { doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(11, 37, 69); doc.text(t, 14, y); doc.setFont('helvetica', 'normal'); doc.setTextColor(31, 41, 55); };
  const proximo = (extra = 12) => { let y = doc.lastAutoTable.finalY + extra; if (y > 265) { doc.addPage(); y = 20; } return y; };
  doc.setFillColor(11, 37, 69); doc.rect(0, 0, 210, 28, 'F');
  doc.setTextColor(255); doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.text('Acorly', 14, 13);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.text('Prestação de contas — cobrança gerenciada · HS Recuperação de Crédito', 14, 21);
  doc.setTextColor(31, 41, 55); doc.setFontSize(11);
  doc.text(`Credor: ${rel.credor}  ·  CNPJ ${mascaraDoc(rel.cnpj)}`, 14, 38);
  doc.text(`Período: ${data(p.periodo_inicio)} a ${data(p.periodo_fim)}  ·  Gerado em ${dataHora(p.data_geracao)}`, 14, 45);

  titulo('Resumo', 56);
  autoTable(doc, {
    startY: 60, head: [['Indicador', 'Valor']], headStyles: { fillColor: azul }, styles: { fontSize: 10 }, columnStyles: { 1: { halign: 'right' } },
    body: [
      ['Valores recuperados no período (confirmados)', brl(rel.valor_recuperado_centavos)],
      ...(rel.recuperado_acumulado_centavos != null ? [['Recuperado desde o início do contrato', brl(rel.recuperado_acumulado_centavos)]] : []),
      ...(rel.a_receber_centavos != null ? [['A receber em acordos', `${brl(rel.a_receber_centavos)}${rel.a_receber_vencido_centavos ? ` (${brl(rel.a_receber_vencido_centavos)} vencido)` : ''}`], ['Saldo ainda em cobrança', brl(rel.saldo_em_cobranca_centavos)]] : []),
      ['Acordos realizados no período', rel.acordos_realizados], ['Negociações iniciadas', `${rel.negociacoes_iniciadas} (${brl(rel.valor_negociado_centavos)})`],
      ['Casos recebidos no período', rel.casos_recebidos], ['Casos trabalhados', rel.casos_trabalhados], ['Contatos realizados', rel.contatos_realizados],
      ['Respostas recebidas', rel.respostas_recebidas], ['Pagamentos informados no período', `${rel.pagamentos_informados} (${brl(rel.valor_informado_centavos)})`],
      ['Casos suspensos / sem sucesso', `${rel.casos_suspensos} / ${rel.casos_sem_sucesso}`],
      ['Comissão da HS no período (sobre valores confirmados)', brl(rel.comissao_hs_centavos || 0)],
    ],
  });
  if (rel.comissoes?.length) {
    const y = proximo(); titulo('Valores recuperados no período', y);
    autoTable(doc, {
      startY: y + 4, head: [['Confirmado em', 'Devedor', 'Valor recebido', 'Comissão', 'Valor da comissão']], headStyles: { fillColor: azul }, styles: { fontSize: 9 },
      body: rel.comissoes.map((c) => [data(c.data), c.devedor, brl(c.valor_centavos), pct(c.comissao_bps), brl(c.comissao_centavos)]),
    });
  }
  if (rel.acordos?.length) {
    const y = proximo(); titulo('Acordos', y);
    autoTable(doc, {
      startY: y + 4, head: [['Devedor', 'Aceite', 'Acordado', 'Desconto', 'Parcelas pagas', 'Pago', 'A receber', 'Próx. venc.', 'Situação']], headStyles: { fillColor: azul }, styles: { fontSize: 8 },
      body: rel.acordos.map((a) => [a.devedor, data(a.data_aceite), brl(a.valor_acordado_centavos), brl(a.desconto_centavos), `${a.parcelas_pagas}/${a.parcelas_total}`, brl(a.pago_centavos), brl(a.a_receber_centavos), a.proximo_vencimento ? data(a.proximo_vencimento) : '—', rotulo(a.status)]),
    });
  }
  if (rel.a_receber?.length) {
    const y = proximo(); titulo('A receber (parcelas dos acordos em aberto)', y);
    autoTable(doc, {
      startY: y + 4, head: [['Mês', 'Total previsto']], headStyles: { fillColor: azul }, styles: { fontSize: 9 }, columnStyles: { 1: { halign: 'right' } },
      body: rel.a_receber_por_mes.map((m) => [mesCurto(m.mes), brl(m.valor_centavos)]),
    });
    autoTable(doc, {
      startY: proximo(6), head: [['Vencimento', 'Devedor', 'Parcela', 'Valor', '']], headStyles: { fillColor: azul }, styles: { fontSize: 8 },
      body: rel.a_receber.map((x) => [data(x.vencimento), x.devedor, x.parcela, brl(x.valor_centavos), x.vencida ? 'vencida' : '']),
    });
  }
  if (rel.em_cobranca?.length) {
    const y = proximo(); titulo('Em cobrança (sem acordo)', y);
    autoTable(doc, {
      startY: y + 4, head: [['Devedor', 'Saldo', 'Dias de atraso', 'Situação']], headStyles: { fillColor: azul }, styles: { fontSize: 8 },
      body: rel.em_cobranca.map((c) => [c.devedor, brl(c.saldo_centavos), c.dias_atraso ?? '—', rotulo(c.status)]),
    });
  }
  const yNota = proximo(10);
  doc.setFontSize(8); doc.setTextColor(107, 114, 128);
  doc.text(`Valores recuperados consideram somente pagamentos confirmados pelo credor; os pagamentos são feitos diretamente à empresa credora. "A receber" e "em cobrança" mostram a posição em ${dataHora(rel.posicao_em || p.data_geracao)} e não são garantia de recebimento.`, 14, yNota, { maxWidth: 182 });
  return doc;
}

