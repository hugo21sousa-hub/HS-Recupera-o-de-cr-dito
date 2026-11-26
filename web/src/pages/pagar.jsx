// Página pública de pagamento de uma parcela: Pix (QR Code e copia e cola) gerado com a chave do credor.
// Funciona como um "boleto Pix": pode ser impressa ou salva em PDF. Não mostra dados pessoais do devedor.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { brl, data } from '../format.js';

export function PagarPix() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [erro, setErro] = useState(null);
  const [qr, setQr] = useState('');
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    fetch(`/api/publico/pagar/${encodeURIComponent(token)}`, { credentials: 'omit' })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok || !j.ok) throw new Error(j.error || 'Link de pagamento inválido.'); setD(j.data); })
      .catch((e) => setErro(e.message));
  }, [token]);
  useEffect(() => {
    if (d?.pix_copia_cola) QRCode.toDataURL(d.pix_copia_cola, { margin: 1, width: 260, errorCorrectionLevel: 'M', color: { dark: '#001452', light: '#ffffff' } }).then(setQr).catch(() => setQr(''));
  }, [d]);
  const copiar = async () => {
    try { await navigator.clipboard.writeText(d.pix_copia_cola); setCopiado(true); setTimeout(() => setCopiado(false), 2500); } catch { window.prompt('Copie o código Pix:', d.pix_copia_cola); }
  };
  if (erro) return <div className="pagar"><div className="pagar-cartao"><h1>Link de pagamento inválido</h1><p className="muted">Confira se o link está completo ou peça um novo a quem enviou a cobrança.</p></div></div>;
  if (!d) return <div className="pagar"><div className="pagar-cartao"><p className="muted">Carregando…</p></div></div>;
  return (
    <div className="pagar">
      <div className="pagar-cartao">
        <div className="pagar-topo">
          <div><span className="pagar-rotulo">Pagamento para</span><strong className="pagar-credor">{d.credor}</strong>{d.cnpj && <span className="small muted">{d.razao_social} · CNPJ {d.cnpj}</span>}</div>
          <span className="pagar-selo">Pix</span>
        </div>
        <div className="pagar-valores">
          <div><span className="pagar-rotulo">Referente a</span><strong>{d.descricao}</strong></div>
          <div><span className="pagar-rotulo">Vencimento</span><strong>{data(d.vencimento)}</strong></div>
          <div><span className="pagar-rotulo">Valor</span><strong className="pagar-valor">{brl(d.valor_centavos)}</strong></div>
        </div>
        {d.situacao === 'PAGA' && <div className="aviso ok">Esta parcela já consta como paga. Obrigado!</div>}
        {d.situacao === 'CANCELADA' && <div className="aviso alerta">Esta cobrança não está mais disponível. Fale com {d.credor}.</div>}
        {d.situacao === 'EXPIRADA' && <div className="aviso alerta">O prazo deste link terminou. Peça um novo a {d.credor}{d.contato ? ` (${d.contato})` : ''}.</div>}
        {d.situacao === 'ABERTA' && d.pix_copia_cola && (
          <>
            <div className="pagar-pix">
              {qr && <img src={qr} alt="QR Code do Pix" width="220" height="220" />}
              <ol className="small">
                <li>Abra o aplicativo do seu banco e escolha <strong>Pix</strong>.</li>
                <li>Leia o QR Code ou use <strong>Pix Copia e Cola</strong> com o código abaixo.</li>
                <li>Confira o valor e o recebedor (<strong>{d.credor}</strong>) e confirme.</li>
              </ol>
            </div>
            <div className="pagar-codigo"><code>{d.pix_copia_cola}</code></div>
            <div className="row pagar-acoes">
              <button className="btn prim" onClick={copiar}>{copiado ? '✓ Código copiado' : 'Copiar código Pix'}</button>
              <button className="btn" onClick={() => window.print()}>Imprimir ou salvar em PDF</button>
            </div>
          </>
        )}
        {d.situacao === 'ABERTA' && !d.pix_copia_cola && d.linha_digitavel && <div className="pagar-codigo"><span className="pagar-rotulo">Linha digitável do boleto</span><code>{d.linha_digitavel}</code></div>}
        <p className="small muted pagar-rodape">O pagamento vai direto para a conta de {d.credor}.{d.txid ? ` Identificador: ${d.txid}.` : ''} Depois de pagar, se puder, envie o comprovante a quem fez a cobrança.</p>
      </div>
      <p className="small muted pagar-marca">Cobrança organizada pela plataforma Acorly · acorly.com.br</p>
    </div>
  );
}
