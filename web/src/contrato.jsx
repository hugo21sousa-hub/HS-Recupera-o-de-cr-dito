// Leitura, aceite e PDF do contrato de cobrança gerenciada.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import { DEMO } from './api.js';
import { Modal, useApi, Carregando, ErroCarga, useExecutar, useToast } from './ui.jsx';
import { dataHora } from './format.js';

/** Gera o PDF do contrato (texto aceito ou minuta). */
export function baixarContratoPDF(c) {
  if (DEMO) throw new Error('O download do PDF fica desativado na demonstração.');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const M = 18, L = 210 - 2 * M, ALT = 297;
  let y = 20;
  const quebra = (h) => { if (y + h > ALT - 18) { doc.addPage(); y = 20; } };
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  for (const l of doc.splitTextToSize(c.titulo, L)) { doc.text(l, 105, y, { align: 'center' }); y += 6; }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(`Contrato nº ${c.numero}`, 105, y, { align: 'center' }); y += 9;
  for (const s of c.secoes) {
    quebra(10);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.text(s.titulo, M, y); y += 5.5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    for (const p of s.paragrafos) {
      const linhas = doc.splitTextToSize(p, p.startsWith('•') ? L - 6 : L);
      for (const l of linhas) { quebra(5); doc.text(l, p.startsWith('•') ? M + 6 : M, y); y += 4.6; }
      y += 1.6;
    }
    y += 2;
  }
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(110);
    const rodape = c.aceito ? `Aceito eletronicamente em ${dataHora(c.data_aceite)} · SHA-256 ${c.hash}` : 'Minuta para leitura. Ainda não aceita.';
    doc.text(doc.splitTextToSize(rodape, L - 20), M, ALT - 10);
    doc.text(`${i}/${paginas}`, 210 - M, ALT - 10, { align: 'right' });
    doc.setTextColor(0);
  }
  doc.save(`contrato-cobranca-${c.numero}.pdf`);
}

function TextoContrato({ c }) {
  return (
    <div className="contrato-texto">
      <h3 style={{ textAlign: 'center', margin: '0 0 2px' }}>{c.titulo}</h3>
      <p className="small muted" style={{ textAlign: 'center', marginTop: 0 }}>Contrato nº {c.numero}</p>
      {c.secoes.map((s) => (
        <section key={s.titulo}>
          <h4>{s.titulo}</h4>
          {s.paragrafos.map((p, i) => <p key={i} className={p.startsWith('•') ? 'item' : undefined}>{p}</p>)}
        </section>
      ))}
    </div>
  );
}

/**
 * Janela com o contrato. Se `aceitar` for verdadeiro e o contrato estiver aguardando aceite,
 * mostra a caixa "Li e aceito" e o botão de aceite.
 */
export function JanelaContrato({ contrato, aceitar = false, onClose, onAceito }) {
  const { data: c, carregando, erro, recarregar } = useApi('textoContrato', { contrato_id: contrato.id });
  const { executar, enviando } = useExecutar();
  const toast = useToast();
  const [li, setLi] = useState(false);
  const podeAceitar = aceitar && c && !c.aceito && contrato.status === 'PROPOSTO';
  const pdf = () => { try { baixarContratoPDF(c); } catch (e) { toast.erro(e); } };
  const aceite = async () => {
    try { await executar('aceitarContrato', { contrato_id: contrato.id, aceite: true }, 'Contrato aceito'); } catch { return; }
    onAceito?.(); onClose();
  };
  return (
    <Modal grande titulo={podeAceitar ? 'Ler e aceitar o contrato' : 'Contrato de cobrança'} onClose={onClose} rodape={c && (
      <div className="row between" style={{ width: '100%' }}>
        <button className="btn" onClick={pdf}>Baixar PDF</button>
        {podeAceitar ? (
          <div className="row">
            <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={li} onChange={(e) => setLi(e.target.checked)} disabled={c.pendencias?.length > 0} /> Li e aceito o contrato em nome da empresa</label>
            <button className="btn prim" disabled={!li || enviando || c.pendencias?.length > 0} onClick={aceite}>Aceitar contrato</button>
          </div>
        ) : <button className="btn" onClick={onClose}>Fechar</button>}
      </div>
    )}>
      {erro ? <ErroCarga erro={erro} onRetry={recarregar} /> : carregando || !c ? <Carregando /> : (
        <div className="stack">
          {c.aceito && <div className="aviso info small">Aceito eletronicamente em {dataHora(c.data_aceite)}. Este é o texto exatamente como foi aceito (código de integridade SHA-256: <code style={{ wordBreak: 'break-all' }}>{c.hash}</code>).</div>}
          {podeAceitar && c.pendencias?.length > 0 && <div className="aviso alerta">Para aceitar, complete os dados da empresa em <Link to="/configuracoes" onClick={onClose}>Configurações</Link>: {c.pendencias.join(', ')}. Eles fazem parte do contrato.</div>}
          {podeAceitar && !c.pendencias?.length && <div className="aviso info small">Leia o contrato até o fim. O aceite eletrônico vale como assinatura e fica registrado com o seu nome, e-mail, data, hora e IP.</div>}
          <TextoContrato c={c} />
        </div>
      )}
    </Modal>
  );
}
