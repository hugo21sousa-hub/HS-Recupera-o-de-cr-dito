// Peças visuais do site: carrossel automático, faixa em movimento, revelar ao rolar e ilustrações (SVG, sem imagens externas).
import { useEffect, useRef, useState } from 'react';

const semMovimento = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Carrossel que passa sozinho (pausa com o mouse em cima, com foco ou se a pessoa preferir menos movimento). */
export function Carrossel({ itens, intervalo = 6000, className = '', rotulo = 'Destaques', render }) {
  const [i, setI] = useState(0);
  const [pausa, setPausa] = useState(false);
  const toque = useRef(null);
  const n = itens.length;
  useEffect(() => {
    if (pausa || n < 2 || semMovimento()) return undefined;
    const t = setTimeout(() => setI((x) => (x + 1) % n), intervalo);
    return () => clearTimeout(t);
  }, [i, pausa, n, intervalo]);
  const ir = (k) => setI(((k % n) + n) % n);
  return (
    <div className={`carrossel ${className}`} role="region" aria-roledescription="carrossel" aria-label={rotulo}
      onMouseEnter={() => setPausa(true)} onMouseLeave={() => setPausa(false)} onFocus={() => setPausa(true)} onBlur={() => setPausa(false)}
      onTouchStart={(e) => { toque.current = e.touches[0].clientX; setPausa(true); }}
      onTouchEnd={(e) => { const d = e.changedTouches[0].clientX - (toque.current ?? 0); if (Math.abs(d) > 40) ir(i + (d < 0 ? 1 : -1)); setPausa(false); }}>
      <div className="carrossel-trilho" style={{ transform: `translateX(-${i * 100}%)` }}>
        {itens.map((it, k) => (
          <div key={k} className="carrossel-slide" aria-hidden={k !== i} role="group" aria-roledescription="slide" aria-label={`${k + 1} de ${n}`}>
            {render(it, k === i)}
          </div>
        ))}
      </div>
      {n > 1 && (
        <div className="carrossel-pontos">
          {itens.map((_, k) => <button key={k} type="button" className={k === i ? 'ativo' : ''} aria-label={`Ir para ${k + 1}`} aria-current={k === i} onClick={() => ir(k)}><span style={k === i && !pausa ? { animationDuration: `${intervalo}ms` } : undefined} /></button>)}
        </div>
      )}
    </div>
  );
}

/** Faixa que corre sem parar (duplicada para emendar), pausa com o mouse em cima. */
export function Faixa({ itens, className = '', velocidade = 40 }) {
  return (
    <div className={`faixa ${className}`}>
      <div className="faixa-trilho" style={{ animationDuration: `${velocidade}s` }}>
        {[0, 1].map((c) => <div key={c} className="faixa-grupo" aria-hidden={c === 1}>{itens.map((x, k) => <span key={k} className="faixa-item">{x}</span>)}</div>)}
      </div>
    </div>
  );
}

/** Aplica a animação de entrada aos elementos .revela quando aparecem na tela. */
export function useRevelar() {
  useEffect(() => {
    const els = [...document.querySelectorAll('.revela')];
    if (!('IntersectionObserver' in window) || semMovimento()) { els.forEach((e) => e.classList.add('visivel')); return undefined; }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('visivel'); io.unobserve(e.target); } }), { threshold: 0.12 });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  });
}

// ---------- Ilustrações (exemplos, sem dados reais) ----------
const AZ = '#0043ff', NAVY = '#001452', CIANO = '#31d6ff', VERDE = '#22c55e', MAG = '#ff31ff', LAR = '#ff8c00';

export function IlustraResultado() {
  const barras = [38, 52, 47, 66, 74, 92];
  return (
    <svg viewBox="0 0 420 300" className="ilustra" role="img" aria-label="Ilustração: painel com valores recuperados subindo mês a mês">
      <rect x="10" y="14" width="400" height="272" rx="18" fill="#fff" />
      <rect x="10" y="14" width="400" height="34" rx="18" fill="#eef2ff" /><rect x="10" y="34" width="400" height="14" fill="#eef2ff" />
      <circle cx="32" cy="31" r="5" fill={MAG} /><circle cx="48" cy="31" r="5" fill={LAR} /><circle cx="64" cy="31" r="5" fill={VERDE} />
      <text x="400" y="35" textAnchor="end" fontSize="11" fill="#64748b">exemplo ilustrativo</text>
      <rect x="30" y="62" width="168" height="62" rx="12" fill={AZ} />
      <text x="44" y="84" fontSize="12" fill="#cfe0ff">Recebido e confirmado</text>
      <text x="44" y="110" fontSize="22" fontWeight="800" fill="#fff">R$ 18.420</text>
      <rect x="210" y="62" width="180" height="62" rx="12" fill="#f1f5f9" />
      <text x="224" y="84" fontSize="12" fill="#64748b">Acordos em andamento</text>
      <text x="224" y="110" fontSize="22" fontWeight="800" fill={NAVY}>12</text>
      {barras.map((h, k) => <rect key={k} className="ilustra-barra" style={{ animationDelay: `${k * 0.12}s` }} x={42 + k * 58} y={262 - h * 1.3} width="34" height={h * 1.3} rx="7" fill={k === barras.length - 1 ? VERDE : AZ} opacity={k === barras.length - 1 ? 1 : 0.35 + k * 0.1} />)}
      <polyline points="59,212 117,194 175,201 233,176 291,166 349,142" fill="none" stroke={CIANO} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="349" cy="142" r="7" fill="#fff" stroke={VERDE} strokeWidth="4" />
      <rect x="30" y="138" width="150" height="28" rx="14" fill={VERDE} /><text x="105" y="157" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">+ dinheiro no caixa</text>
    </svg>
  );
}

export function IlustraDiagnostico() {
  return (
    <svg viewBox="0 0 420 300" className="ilustra" role="img" aria-label="Ilustração: planilha só com valor e vencimento virando um relatório de quanto dá para recuperar">
      <rect x="14" y="40" width="160" height="210" rx="14" fill="#fff" />
      <rect x="14" y="40" width="160" height="34" rx="14" fill="#e2e8f0" /><rect x="14" y="60" width="160" height="14" fill="#e2e8f0" />
      <text x="30" y="62" fontSize="12" fontWeight="700" fill={NAVY}>valor</text><text x="102" y="62" fontSize="12" fontWeight="700" fill={NAVY}>vencimento</text>
      {['R$ 480', 'R$ 1.200', 'R$ 350', 'R$ 2.900', 'R$ 760', 'R$ 640'].map((v, k) => (
        <g key={v}><text x="30" y={98 + k * 26} fontSize="12" fill="#334155">{v}</text><text x="102" y={98 + k * 26} fontSize="12" fill="#334155">{`${10 + k}/0${(k % 6) + 3}/26`}</text><line x1="26" x2="162" y1={106 + k * 26} y2={106 + k * 26} stroke="#eef2f7" /></g>
      ))}
      <text x="94" y="272" textAnchor="middle" fontSize="11" fill="#cfe0ff">sem nome, CPF ou telefone</text>
      <path d="M190 145 h40" stroke={CIANO} strokeWidth="5" strokeLinecap="round" className="ilustra-seta" /><path d="M222 133 l14 12 -14 12" fill="none" stroke={CIANO} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="250" y="40" width="158" height="210" rx="14" fill="#fff" />
      <text x="266" y="70" fontSize="13" fontWeight="800" fill={NAVY}>Diagnóstico</text>
      <circle cx="329" cy="140" r="46" fill="none" stroke="#e2e8f0" strokeWidth="14" />
      <circle cx="329" cy="140" r="46" fill="none" stroke={VERDE} strokeWidth="14" strokeDasharray="289" strokeDashoffset="110" strokeLinecap="round" transform="rotate(-90 329 140)" className="ilustra-anel" />
      <text x="329" y="136" textAnchor="middle" fontSize="12" fill="#64748b">dá para</text><text x="329" y="154" textAnchor="middle" fontSize="13" fontWeight="800" fill={NAVY}>recuperar</text>
      <rect x="266" y="200" width="126" height="10" rx="5" fill="#e2e8f0" /><rect x="266" y="220" width="90" height="10" rx="5" fill="#e2e8f0" />
      <rect x="300" y="18" width="108" height="26" rx="13" fill={LAR} /><text x="354" y="36" textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff">em 2 dias úteis</text>
    </svg>
  );
}

export function IlustraMensagens() {
  return (
    <svg viewBox="0 0 420 300" className="ilustra" role="img" aria-label="Ilustração: celular com conversa cordial de cobrança e acordo fechado">
      <rect x="120" y="8" width="180" height="284" rx="26" fill={NAVY} />
      <rect x="130" y="22" width="160" height="258" rx="18" fill="#ece5dd" />
      <rect x="130" y="22" width="160" height="38" rx="18" fill="#075e54" /><rect x="130" y="44" width="160" height="16" fill="#075e54" />
      <circle cx="152" cy="41" r="10" fill="#cfe0ff" /><text x="170" y="45" fontSize="12" fontWeight="700" fill="#fff">Sua Empresa</text>
      <g className="ilustra-bolha" style={{ animationDelay: '0s' }}><rect x="140" y="72" width="128" height="46" rx="10" fill="#fff" /><text x="148" y="90" fontSize="10.5" fill="#1f2937">Olá, Maria! Tudo bem?</text><text x="148" y="106" fontSize="10.5" fill="#1f2937">Podemos conversar?</text></g>
      <g className="ilustra-bolha" style={{ animationDelay: '.5s' }}><rect x="156" y="128" width="126" height="30" rx="10" fill="#dcf8c6" /><text x="164" y="147" fontSize="10.5" fill="#1f2937">Claro! Posso parcelar?</text></g>
      <g className="ilustra-bolha" style={{ animationDelay: '1s' }}><rect x="140" y="168" width="132" height="46" rx="10" fill="#fff" /><text x="148" y="186" fontSize="10.5" fill="#1f2937">Pode sim: entrada +</text><text x="148" y="202" fontSize="10.5" fill="#1f2937">3x sem juros. 😊</text></g>
      <g className="ilustra-bolha" style={{ animationDelay: '1.5s' }}><rect x="172" y="224" width="110" height="30" rx="10" fill="#dcf8c6" /><text x="180" y="243" fontSize="10.5" fill="#1f2937">Fechado, obrigada!</text></g>
      <rect x="10" y="60" width="104" height="30" rx="15" fill="#fff" /><text x="62" y="80" textAnchor="middle" fontSize="11" fontWeight="700" fill={AZ}>tom cordial</text>
      <rect x="10" y="104" width="104" height="30" rx="15" fill="#fff" /><text x="62" y="124" textAnchor="middle" fontSize="11" fontWeight="700" fill={AZ}>sem ameaças</text>
      <rect x="306" y="150" width="106" height="30" rx="15" fill={VERDE} /><text x="359" y="170" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">acordo fechado</text>
      <rect x="306" y="194" width="106" height="30" rx="15" fill="#fff" /><text x="359" y="214" textAnchor="middle" fontSize="11" fontWeight="700" fill={AZ}>paga na sua conta</text>
    </svg>
  );
}

export function IlustraEquipe() {
  const itens = ['Carteira recebida', 'Contato cordial', 'Proposta no limite', 'Pagamento confirmado'];
  return (
    <svg viewBox="0 0 420 300" className="ilustra" role="img" aria-label="Ilustração: operador responsável pela carteira acompanhando cada etapa até o pagamento">
      <rect x="14" y="30" width="150" height="240" rx="18" fill="#fff" />
      <circle cx="89" cy="100" r="38" fill="#e6edff" /><circle cx="89" cy="90" r="16" fill={AZ} /><path d="M61 128 a28 22 0 0 1 56 0" fill={AZ} />
      <rect x="66" y="116" width="46" height="8" rx="4" fill={NAVY} opacity=".25" />
      <text x="89" y="166" textAnchor="middle" fontSize="13" fontWeight="800" fill={NAVY}>Seu operador</text>
      <text x="89" y="184" textAnchor="middle" fontSize="11" fill="#64748b">responsável pela</text><text x="89" y="199" textAnchor="middle" fontSize="11" fill="#64748b">sua carteira</text>
      <rect x="40" y="218" width="98" height="28" rx="14" fill={VERDE} /><text x="89" y="237" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">CDC + LGPD</text>
      <rect x="182" y="30" width="226" height="240" rx="18" fill="#fff" />
      <text x="200" y="60" fontSize="13" fontWeight="800" fill={NAVY}>Acompanhamento</text>
      {itens.map((t, k) => (
        <g key={t} className="ilustra-bolha" style={{ animationDelay: `${k * 0.35}s` }}>
          <circle cx="210" cy={96 + k * 44} r="13" fill={k === itens.length - 1 ? VERDE : AZ} />
          <path d={`M204 ${96 + k * 44} l4 4 8 -8`} fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <text x="232" y={101 + k * 44} fontSize="13" fill="#1f2937">{t}</text>
          {k < itens.length - 1 && <line x1="210" x2="210" y1={110 + k * 44} y2={126 + k * 44} stroke="#cbd5e1" strokeWidth="3" />}
        </g>
      ))}
    </svg>
  );
}
