// DRE mensal da HS em PDF (com a marca Acorly) e CSV para o contador.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { brl, dataHora, pct } from './format.js';

const margem = (bps, receita) => (!receita ? '—' : bps < -10000 ? 'abaixo de -100%' : pct(bps));
const NOMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const nomeMes = (m) => `${NOMES[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;
export const mesAbrev = (m) => `${NOMES[Number(m.slice(5, 7)) - 1].slice(0, 3)}/${m.slice(2, 4)}`;

export function montarPDFDRE(d) {
  const doc = new jsPDF();
  const azul = [0, 67, 255];
  doc.setFillColor(0, 20, 82); doc.rect(0, 0, 210, 28, 'F');
  doc.setTextColor(255); doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.text('Acorly', 14, 13);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.text('HS Recuperação de Crédito · CNPJ 37.573.934/0001-22', 14, 21);
  doc.setTextColor(0, 20, 82); doc.setFontSize(14); doc.setFont('helvetica', 'bold');
  doc.text(`DRE gerencial — ${nomeMes(d.mes)}`, 14, 40);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(107, 114, 128);
  doc.text(`${d.fechado ? `Mês fechado em ${dataHora(d.fechamento?.fechado_em)}` : 'Mês em aberto (valores podem mudar)'} · Regime de competência · Gerado em ${dataHora(new Date().toISOString())}`, 14, 46);
  autoTable(doc, {
    startY: 52, head: [['Descrição', 'Valor']], headStyles: { fillColor: azul }, styles: { fontSize: 10 }, columnStyles: { 1: { halign: 'right', cellWidth: 45 } },
    body: d.linhas.map((l) => [`${l.nivel ? '    ' : ''}${l.rotulo}${l.nota ? ` (${l.nota})` : ''}`, brl(l.valor_centavos)]),
    didParseCell: (c) => {
      const l = d.linhas[c.row.index];
      if (c.section !== 'body' || !l) return;
      if (l.total) c.cell.styles.fontStyle = 'bold';
      if (l.destaque || l.final) c.cell.styles.fillColor = [230, 237, 255];
      if (l.final) c.cell.styles.textColor = l.valor_centavos >= 0 ? [21, 128, 61] : [185, 28, 28];
    },
  });
  let y = doc.lastAutoTable.finalY + 8;
  doc.setFontSize(10); doc.setTextColor(31, 41, 55);
  doc.text(`Margem líquida: ${margem(d.margem_bps, d.receita_bruta_centavos)}   ·   Acumulado no ano: receita ${brl(d.acumulado_ano.receita_bruta_centavos)}, lucro ${brl(d.acumulado_ano.lucro_centavos)}`, 14, y);
  autoTable(doc, {
    startY: y + 6, head: [['Mês', 'Receita bruta', 'Lucro líquido', 'Margem']], headStyles: { fillColor: azul }, styles: { fontSize: 9 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    body: d.historico.map((h) => [mesAbrev(h.mes) + (h.fechado ? ' (fechado)' : ''), brl(h.receita_bruta_centavos), brl(h.lucro_centavos), margem(h.margem_bps, h.receita_bruta_centavos)]),
  });
  y = doc.lastAutoTable.finalY + 8;
  doc.setFontSize(8); doc.setTextColor(107, 114, 128);
  doc.text(doc.splitTextToSize('Demonstrativo gerencial para acompanhamento do negócio. Não substitui as demonstrações contábeis oficiais. Mensalidades e comissões vêm dos registros do sistema; demais valores, dos lançamentos do financeiro.', 182), 14, y);
  return doc;
}

export function csvDRE(d) {
  const linhas = [['Descricao', 'Valor (R$)'], ...d.linhas.map((l) => [`${l.nivel ? '  ' : ''}${l.rotulo}`, (l.valor_centavos / 100).toFixed(2).replace('.', ',')])];
  return '\uFEFF' + linhas.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
}
