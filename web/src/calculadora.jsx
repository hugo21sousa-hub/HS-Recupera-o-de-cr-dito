// Calculadora de inadimplência (site): mostra quanto está parado e simula quanto volta ao caixa.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { calcularInadimplencia, FAIXAS_ATRASO } from '../../src/core/calculadora.js';
import { brl } from './format.js';

const semMovimento = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Número que "rola" até o valor novo (sem animação para quem prefere menos movimento). */
function ValorAnimado({ centavos }) {
  const [mostrado, setMostrado] = useState(centavos);
  const atual = useRef(centavos);
  useEffect(() => {
    if (semMovimento()) { atual.current = centavos; setMostrado(centavos); return undefined; }
    const de = atual.current, ate = centavos, t0 = performance.now(), dur = 500;
    let id;
    const passo = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - (1 - k) ** 3;
      const v = Math.round(de + (ate - de) * e);
      atual.current = v; setMostrado(v);
      if (k < 1) id = requestAnimationFrame(passo);
    };
    id = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(id);
  }, [centavos]);
  return <>{brl(Math.round(mostrado / 100) * 100).replace(/,00$/, '')}</>;
}

const paraCentavos = (texto) => Math.round(Number(String(texto).replace(/[^\d,]/g, '').replace(',', '.')) * 100) || 0;

export function Calculadora() {
  const [alunos, setAlunos] = useState('300');
  const [mensalidade, setMensalidade] = useState('850');
  const [atraso, setAtraso] = useState(10);
  const [faixa, setFaixa] = useState('ate180');
  const [recupera, setRecupera] = useState(30);
  const r = calcularInadimplencia({ alunos, mensalidadeCentavos: paraCentavos(mensalidade), percentualAtraso: atraso, faixa, percentualRecuperado: recupera });
  const linkDiagnostico = `/diagnostico?devedores=${r.inadimplentes}&valor=${Math.round(r.parado_centavos / 100)}`;
  return (
    <div className="calc">
      <form className="calc-entradas" onSubmit={(e) => e.preventDefault()} aria-label="Dados da sua escola">
        <div className="campo"><label htmlFor="calc-alunos">Alunos (ou clientes) ativos</label><input id="calc-alunos" inputMode="numeric" value={alunos} onChange={(e) => setAlunos(e.target.value.replace(/\D/g, '').slice(0, 6))} /></div>
        <div className="campo"><label htmlFor="calc-mens">Mensalidade média</label><div className="calc-prefixo"><span>R$</span><input id="calc-mens" inputMode="decimal" value={mensalidade} onChange={(e) => setMensalidade(e.target.value.replace(/[^\d,]/g, '').slice(0, 9))} /></div></div>
        <div className="campo">
          <label htmlFor="calc-atraso">Em atraso hoje: <strong>{atraso}%</strong> <span className="muted">({r.inadimplentes} {r.inadimplentes === 1 ? 'família' : 'famílias'})</span></label>
          <input id="calc-atraso" type="range" min="1" max="40" step="1" value={atraso} onChange={(e) => setAtraso(Number(e.target.value))} className="calc-range" style={{ '--p': `${((atraso - 1) / 39) * 100}%` }} />
        </div>
        <div className="campo">
          <span className="calc-rotulo">Há quanto tempo, em média?</span>
          <div className="calc-opcoes" role="radiogroup" aria-label="Tempo médio de atraso">
            {FAIXAS_ATRASO.map((f) => <button key={f.id} type="button" role="radio" aria-checked={faixa === f.id} className={faixa === f.id ? 'ativo' : ''} onClick={() => setFaixa(f.id)}>{f.rotulo}</button>)}
          </div>
        </div>
      </form>
      <div className="calc-resultado" aria-live="polite">
        <span className="calc-rotulo-claro">Dinheiro parado em mensalidades atrasadas</span>
        <strong className="calc-grande"><ValorAnimado centavos={r.parado_centavos} /></strong>
        <span className="calc-sub">São <strong>{brl(r.por_mes_centavos).replace(/,00$/, "")}</strong> que deixam de entrar a cada mês.</span>
        <div className="calc-sim">
          <label htmlFor="calc-rec">Simule: se <strong>{recupera}%</strong> voltar ao caixa</label>
          <input id="calc-rec" type="range" min="10" max="80" step="5" value={recupera} onChange={(e) => setRecupera(Number(e.target.value))} className="calc-range calc-range-claro" style={{ '--p': `${((recupera - 10) / 70) * 100}%` }} />
          <div className="calc-linhas">
            <div><span>Volta para a sua escola</span><strong><ValorAnimado centavos={r.recuperado_centavos} /></strong></div>
            <div><span>Comissão no Piloto Sem Risco (10%)</span><span>− {brl(r.comissao_piloto_centavos)}</span></div>
            <div className="calc-total"><span>Fica com você</span><strong><ValorAnimado centavos={r.liquido_piloto_centavos} /></strong></div>
          </div>
        </div>
        <Link className="btn site-btn-grande site-btn-branco calc-cta" to={linkDiagnostico}>Quero o diagnóstico com os números reais</Link>
        <span className="calc-nota">Conta feita só com os números que você informou. O percentual que volta é uma simulação, não uma promessa: o diagnóstico grátis e anônimo mostra o número real da sua carteira.</span>
      </div>
    </div>
  );
}
