import { useEffect, useState } from 'react';
import { hs } from '../api.js';
import { Cabecalho, useApi, useToast, Carregando, ErroCarga, Spinner } from '../ui.jsx';
import { pct, brl } from '../format.js';

/** Tabela somente leitura das faixas de comissão. */
export function TabelaComissao({ faixas, destaque }) {
  if (!faixas?.length) return null;
  return (
    <table>
      <thead><tr><th>Atraso da dívida ao encaminhar</th><th className="num">Comissão da HS</th></tr></thead>
      <tbody>{faixas.map((f) => (
        <tr key={f.faixa} style={destaque === f.faixa ? { background: 'var(--azul-claro)', fontWeight: 700 } : undefined}>
          <td>{f.faixa}</td><td className="num">{pct(f.bps)}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

/** Editor de faixas: limites em dias (crescentes) e percentuais; a última faixa vale para "acima de". */
export function EditorFaixas({ faixas, onChange }) {
  const linhas = faixas.map((f) => ({ ate: f.ate_dias == null ? '' : String(f.ate_dias), pct: String(f.bps / 100).replace('.', ',') }));
  const atualizar = (novas) => onChange(novas.map((l, i) => ({ ate_dias: i === novas.length - 1 ? null : Number(l.ate), bps: Math.round(Number(String(l.pct).replace(',', '.')) * 100) })));
  const set = (i, campo, v) => atualizar(linhas.map((l, j) => (j === i ? { ...l, [campo]: v } : l)));
  return (
    <div className="stack">
      <table>
        <thead><tr><th>Até quantos dias de atraso</th><th>Comissão (%)</th><th /></tr></thead>
        <tbody>{linhas.map((l, i) => {
          const ultima = i === linhas.length - 1;
          return (
            <tr key={i}>
              <td>{ultima ? <span className="muted">acima de {linhas.length > 1 ? linhas[i - 1].ate || '…' : 0} dias (sem limite)</span>
                : <input type="number" min="1" aria-label={`Limite da faixa ${i + 1}`} value={l.ate} onChange={(e) => set(i, 'ate', e.target.value)} style={{ maxWidth: 140 }} />}</td>
              <td><input inputMode="decimal" aria-label={`Percentual da faixa ${i + 1}`} value={l.pct} onChange={(e) => set(i, 'pct', e.target.value)} style={{ maxWidth: 110 }} /></td>
              <td className="right">{linhas.length > 1 && <button type="button" className="btn sm perigo" onClick={() => atualizar(linhas.filter((_, j) => j !== i).map((x, j, arr) => (j === arr.length - 1 ? { ...x, ate: '' } : x)))}>Remover</button>}</td>
            </tr>
          );
        })}</tbody>
      </table>
      <div><button type="button" className="btn sm" onClick={() => {
        const penult = linhas.length > 1 ? Number(linhas[linhas.length - 2].ate) || 0 : 0;
        const nova = [...linhas.slice(0, -1), { ate: String(penult + 90), pct: linhas[linhas.length - 1].pct }, linhas[linhas.length - 1]];
        atualizar(nova);
      }}>+ Adicionar faixa</button></div>
    </div>
  );
}

/** Página do superadmin: tabela padrão de comissão. */
export function Comissoes() {
  const toast = useToast();
  const { data, carregando, erro, recarregar } = useApi('obterTabelaComissao', {});
  const [faixas, setFaixas] = useState(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (data) setFaixas(data.padrao.map(({ ate_dias, bps }) => ({ ate_dias, bps }))); }, [data]);
  if (erro) return <ErroCarga erro={erro} onRetry={recarregar} />;
  if (carregando || !faixas) return <Carregando />;
  const salvar = async () => {
    setSalvando(true);
    try { await hs('salvarTabelaComissao', { faixas }); toast.ok('Tabela padrão salva'); recarregar(); } catch (e) { toast.erro(e); } finally { setSalvando(false); }
  };
  const exemplo = 100000;
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <Cabecalho titulo="Comissão da cobrança gerenciada" sub="Percentual da HS por faixa de atraso, cobrado somente sobre os valores recebidos e confirmados pelo credor." />
      <div className="card stack">
        <h2>Tabela padrão</h2>
        <EditorFaixas faixas={faixas} onChange={setFaixas} />
        <div className="aviso info small">A tabela padrão vale para novas propostas de contrato e aparece no site. Contratos já enviados mantêm a tabela com que foram propostos. Cada dívida fica com o percentual da faixa em que estava no dia do encaminhamento.</div>
        <p className="small muted">Exemplo: pagamento de {brl(exemplo)} recebido numa dívida da 2ª faixa gera comissão de {brl(Math.round(exemplo * (faixas[1]?.bps ?? faixas[0].bps) / 10000))}.</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn prim" disabled={salvando} onClick={salvar}>{salvando && <Spinner />}Salvar tabela</button></div>
      </div>
    </div>
  );
}
