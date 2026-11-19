// Indicadores do negócio (superadmin).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Cabecalho, useApi, Carregando, ErroCarga, Vazio, Stat, Badge } from '../ui.jsx';
import { brl, data, dataHora, pct } from '../format.js';

const nomeMes = (m) => { const [a, mm] = m.split('-'); return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(mm) - 1]}/${a.slice(2)}`; };

const NOME_ORIGEM = { direto: 'Direto (digitou o endereço ou link sem origem)', instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', google: 'Google', bing: 'Bing', whatsapp: 'WhatsApp', email: 'E-mail', x: 'X (Twitter)', youtube: 'YouTube', tiktok: 'TikTok' };
const NOME_CONVERSAO = { DIAGNOSTICO: 'Pedidos de diagnóstico', CADASTRO: 'Contas criadas', WHATSAPP: 'Cliques no WhatsApp', DEMONSTRACAO: 'Abriram a demonstração' };
const diaCurto = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);

/** Barras de pessoas por dia, com dica ao passar o mouse e a tabela ao lado. */
function GraficoVisitas({ serie }) {
  const [foco, setFoco] = useState(null);
  const [tabela, setTabela] = useState(false);
  const max = Math.max(1, ...serie.map((d) => d.visitantes));
  const passo = max <= 5 ? 1 : Math.ceil(max / 4 / 5) * 5;
  const topo = Math.max(passo, Math.ceil(max / passo) * passo);
  const W = 720, H = 180, esq = 34, base = H - 22, alt = base - 10;
  const larg = (W - esq) / serie.length;
  const barra = Math.max(2, Math.min(18, larg - 2));
  const marcas = []; for (let v = 0; v <= topo; v += passo) marcas.push(v);
  const cadaRotulo = Math.ceil(serie.length / 10);
  const f = foco !== null ? serie[foco] : null;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row between"><strong className="small">Pessoas por dia</strong><button className="btn sm" onClick={() => setTabela(!tabela)}>{tabela ? 'Ver gráfico' : 'Ver tabela'}</button></div>
      {tabela ? (
        <div style={{ maxHeight: 240, overflow: 'auto' }}><table className="small"><thead><tr><th>Dia</th><th className="num">Pessoas</th><th className="num">Páginas vistas</th><th className="num">Conversões</th></tr></thead><tbody>
          {[...serie].reverse().map((d) => <tr key={d.dia}><td>{data(d.dia)}</td><td className="num">{d.visitantes}</td><td className="num">{d.visualizacoes}</td><td className="num">{d.conversoes}</td></tr>)}
        </tbody></table></div>
      ) : (
        <div style={{ position: 'relative' }}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Pessoas que visitaram o site por dia" onMouseLeave={() => setFoco(null)} style={{ display: 'block' }}>
            {marcas.map((v) => { const y = base - (v / topo) * alt; return <g key={v}><line x1={esq} x2={W} y1={y} y2={y} stroke="var(--borda)" strokeWidth="1" /><text x={esq - 6} y={y + 4} textAnchor="end" fontSize="11" fill="var(--texto-3)">{v}</text></g>; })}
            {serie.map((d, i) => {
              const h = (d.visitantes / topo) * alt;
              const x = esq + i * larg + (larg - barra) / 2;
              const rr = Math.min(4, barra / 2, h);
              return (
                <g key={d.dia} onMouseEnter={() => setFoco(i)}>
                  <rect x={esq + i * larg} y={10} width={larg} height={base - 10} fill="transparent" />
                  {h > 0 && <path d={`M${x},${base} V${base - h + rr} Q${x},${base - h} ${x + rr},${base - h} H${x + barra - rr} Q${x + barra},${base - h} ${x + barra},${base - h + rr} V${base} Z`} fill="var(--azul)" opacity={foco === null || foco === i ? 1 : 0.45} />}
                  {i % cadaRotulo === 0 && <text x={esq + i * larg + larg / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--texto-3)">{diaCurto(d.dia)}</text>}
                </g>
              );
            })}
          </svg>
          {f && (
            <div className="card small" style={{ position: 'absolute', top: 0, left: `${Math.min(70, Math.max(0, ((esq + foco * larg) / W) * 100 - 10))}%`, padding: '6px 10px', pointerEvents: 'none', boxShadow: 'var(--sombra)' }}>
              <strong>{data(f.dia)}</strong><div>{f.visitantes} pessoa(s) · {f.visualizacoes} página(s)</div>{f.conversoes > 0 && <div>{f.conversoes} conversão(ões)</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Visitas do site: contadas sem cookies, de forma anônima. */
function VisitasSite() {
  const [dias, setDias] = useState(30);
  const { data: v, carregando, erro, recarregar } = useApi('visitasSite', { dias }, [dias]);
  const variacao = v && v.visitantes_anterior ? Math.round(((v.visitantes - v.visitantes_anterior) / v.visitantes_anterior) * 100) : null;
  return (
    <div className="card stack">
      <div className="row between">
        <h2 style={{ margin: 0 }}>Visitas do site</h2>
        <div className="row" style={{ gap: 4 }}>{[7, 30, 90, 365].map((n) => <button key={n} className={`btn sm${dias === n ? ' prim' : ''}`} onClick={() => setDias(n)}>{n === 365 ? '12 meses' : `${n} dias`}</button>)}</div>
      </div>
      {erro ? <ErroCarga erro={erro} onRetry={recarregar} /> : !v ? <Carregando linhas={4} /> : (
        <>
          <div className="grid g4">
            <Stat rotulo="Pessoas que visitaram" valor={v.visitantes} ajuda={variacao === null ? 'Contadas por dia, sem cookies' : `${variacao >= 0 ? '+' : ''}${variacao}% em relação aos ${v.dias} dias anteriores`} />
            <Stat rotulo="Páginas vistas" valor={v.visualizacoes} ajuda={v.visitantes ? `${(v.visualizacoes / v.visitantes).toFixed(1).replace('.', ',')} por pessoa` : '—'} />
            <Stat rotulo="Viraram contato" valor={v.total_conversoes} ajuda={`Diagnóstico, conta, WhatsApp ou demonstração`} tom={v.total_conversoes ? 'ok' : undefined} />
            <Stat rotulo="Taxa de conversão" valor={pct(v.taxa_conversao_bps)} ajuda={`${v.por_dispositivo.CELULAR} pelo celular · ${v.por_dispositivo.COMPUTADOR} pelo computador`} />
          </div>
          {carregando && <span className="small muted">Atualizando…</span>}
          <GraficoVisitas serie={v.serie} />
          <div className="grid g2">
            <div className="stack" style={{ gap: 6 }}>
              <strong className="small">De onde vieram</strong>
              {v.por_origem.length ? <table className="small"><thead><tr><th>Origem</th><th className="num">Pessoas</th><th className="num">Viraram contato</th></tr></thead><tbody>
                {v.por_origem.map((o) => <tr key={o.chave}><td>{NOME_ORIGEM[o.chave] || o.chave}</td><td className="num">{o.visitantes}</td><td className="num">{o.conversoes}</td></tr>)}
              </tbody></table> : <span className="small muted">Ainda sem visitas no período.</span>}
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <strong className="small">O que fizeram</strong>
              <table className="small"><tbody>
                {Object.entries(NOME_CONVERSAO).map(([k, t]) => <tr key={k}><td>{t}</td><td className="num">{v.conversoes[k] || 0}</td></tr>)}
              </tbody></table>
              <strong className="small" style={{ marginTop: 6 }}>Páginas mais vistas</strong>
              {v.por_pagina.length ? <table className="small"><tbody>{v.por_pagina.slice(0, 6).map((p) => <tr key={p.chave}><td>{p.rotulo}</td><td className="num">{p.valor}</td></tr>)}</tbody></table> : <span className="small muted">—</span>}
            </div>
          </div>
          {v.por_campanha.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <strong className="small">Campanhas (links com utm_campaign)</strong>
              <table className="small"><thead><tr><th>Campanha</th><th className="num">Pessoas</th><th className="num">Viraram contato</th></tr></thead><tbody>{v.por_campanha.map((c) => <tr key={c.chave}><td>{c.chave}</td><td className="num">{c.visitantes}</td><td className="num">{c.conversoes}</td></tr>)}</tbody></table>
            </div>
          )}
          <p className="small muted" style={{ margin: 0 }}>
            Contagem anônima e sem cookies: não guardamos IP nem identificamos ninguém, e robôs são ignorados. Para saber qual post trouxe a visita, use links com etiqueta, por exemplo na bio do Instagram: <span style={{ userSelect: 'all' }}>acorly.com.br/?utm_source=instagram&amp;utm_campaign=bio</span>. Acessos de quem está logado no sistema não contam.
          </p>
        </>
      )}
    </div>
  );
}

export function IndicadoresNegocio() {
  const { data: d, carregando, erro, recarregar } = useApi('indicadoresNegocio', {});
  if (erro) return <ErroCarga erro={erro} onRetry={recarregar} />;
  if (carregando && !d) return <Carregando linhas={8} />;
  return (
    <div className="stack">
      <Cabecalho titulo="Indicadores do negócio" sub={`Assinaturas da plataforma e comissão da cobrança gerenciada, calculadas dos registros reais. Atualizado em ${dataHora(d.gerado_em)}.`}>
        <button className="btn" onClick={recarregar}>Atualizar</button>
      </Cabecalho>

      <VisitasSite />

      <div className="grid g4">
        <Stat rotulo="Receita recorrente (MRR)" valor={brl(d.mrr_centavos)} ajuda={`${d.em_dia} assinante(s) em dia · ticket médio ${brl(d.ticket_medio_centavos)}`} tom="ok" />
        <Stat rotulo="Assinantes ativos" valor={d.assinantes_ativos} ajuda={d.em_tolerancia ? `${d.em_tolerancia} em tolerância de atraso` : 'Todos em dia'} />
        <Stat rotulo="Inadimplência" valor={brl(d.mrr_em_risco_centavos)} ajuda={`${d.inadimplentes.length} empresa(s) com mensalidade em atraso`} tom={d.inadimplentes.length ? 'critico' : undefined} />
        <Stat rotulo="Cancelamentos no mês" valor={d.cancelamentos_mes} ajuda={`Churn do mês: ${pct(d.churn_bps)}`} tom={d.cancelamentos_mes ? 'alerta' : undefined} />
        <Stat rotulo="Recebido em assinaturas (mês)" valor={brl(d.recebido_mes_centavos)} ajuda="Pagamentos confirmados pelo Asaas" />
        <Stat rotulo="Comissão da cobrança (mês)" valor={brl(d.comissao_mes_centavos)} ajuda="Sobre pagamentos confirmados pelos credores" />
        <Stat rotulo="Em teste grátis" valor={d.em_teste} ajuda={d.testes_acabando.length ? `${d.testes_acabando.length} terminando em até 3 dias` : 'Nenhum terminando nos próximos dias'} />
        <Stat rotulo="Conversão do teste" valor={d.conversao_teste.encerrados ? pct(d.conversao_teste.taxa_bps) : '—'} ajuda={`${d.conversao_teste.convertidos} de ${d.conversao_teste.encerrados} testes encerrados nos últimos 60 dias`} />
      </div>

      <div className="grid g2">
        <div className="card">
          <h2>Assinantes por plano</h2>
          {d.por_plano.length ? <table><thead><tr><th>Plano</th><th className="num">Empresas</th><th className="num">Receita mensal</th></tr></thead><tbody>
            {d.por_plano.map((p) => <tr key={p.plano}><td>{p.plano}</td><td className="num">{p.empresas}</td><td className="num">{brl(p.receita_centavos)}</td></tr>)}
          </tbody></table> : <Vazio titulo="Nenhum assinante ainda" />}
        </div>
        <div className="card">
          <h2>Últimos 6 meses</h2>
          <table><thead><tr><th>Mês</th><th className="num">Assinaturas recebidas</th><th className="num">Comissão</th><th className="num">Total</th></tr></thead><tbody>
            {[...d.meses].reverse().map((m) => <tr key={m.mes}><td>{nomeMes(m.mes)}</td><td className="num">{brl(m.assinaturas_centavos)}</td><td className="num">{brl(m.comissao_centavos)}</td><td className="num"><strong>{brl(m.assinaturas_centavos + m.comissao_centavos)}</strong></td></tr>)}
          </tbody></table>
        </div>
      </div>

      <div className="card">
        <h2>Mensalidades em atraso</h2>
        {d.inadimplentes.length ? <table><thead><tr><th>Empresa</th><th>Plano</th><th className="num">Mensalidade</th><th>Em atraso desde</th><th>Situação</th><th></th></tr></thead><tbody>
          {d.inadimplentes.map((i) => <tr key={i.empresa_id}><td>{i.empresa}</td><td>{i.plano || '—'}</td><td className="num">{brl(i.valor_centavos)}</td><td>{data(i.atraso_desde)}</td><td><Badge status={i.situacao === 'Em tolerância' ? 'PENDENTE' : 'REJEITADO'}>{i.situacao}</Badge></td><td className="right">{i.fatura_url && <a className="btn sm" href={i.fatura_url} target="_blank" rel="noreferrer">Fatura</a>}</td></tr>)}
        </tbody></table> : <Vazio titulo="Nenhuma mensalidade em atraso" />}
      </div>

      <div className="grid g2">
        <div className="card">
          <h2>Testes grátis terminando</h2>
          {d.testes_acabando.length ? <table><thead><tr><th>Empresa</th><th>Contato</th><th>Termina em</th></tr></thead><tbody>
            {d.testes_acabando.map((e) => <tr key={e.empresa_id}><td>{e.empresa}</td><td className="small">{e.email}</td><td>{data(e.teste_ate)} {e.dias_restantes === 1 && <Badge status="PENDENTE">hoje</Badge>}</td></tr>)}
          </tbody></table> : <Vazio titulo="Nenhum teste terminando nos próximos 3 dias" />}
        </div>
        <div className="card">
          <h2>Teste encerrado sem assinatura</h2>
          <p className="small muted" style={{ marginTop: 0 }}>Boas oportunidades para um contato comercial.</p>
          {d.teste_encerrado_sem_plano.length ? <table><thead><tr><th>Empresa</th><th>Contato</th><th>Teste até</th></tr></thead><tbody>
            {d.teste_encerrado_sem_plano.map((e) => <tr key={e.empresa_id}><td>{e.empresa}{e.com_contrato && <div className="small muted">tem contrato de cobrança</div>}</td><td className="small">{e.email}</td><td>{data(e.teste_ate)}</td></tr>)}
          </tbody></table> : <Vazio titulo="Nenhuma empresa nesta situação" />}
        </div>
      </div>

      <div className="card">
        <h2>Cancelamentos recentes</h2>
        {d.ultimos_cancelamentos.length ? <table><thead><tr><th>Empresa</th><th>Plano</th><th className="num">Mensalidade</th><th>Quando</th></tr></thead><tbody>
          {d.ultimos_cancelamentos.map((c, i) => <tr key={i}><td>{c.empresa}</td><td>{c.plano}</td><td className="num">{brl(c.valor_centavos)}</td><td>{dataHora(c.em)}</td></tr>)}
        </tbody></table> : <Vazio titulo="Nenhum cancelamento" />}
        <p className="small muted">Detalhes de cada empresa em <Link to="/hs/empresas">Empresas</Link> e <Link to="/hs/planos">Planos e assinaturas</Link>.</p>
      </div>
    </div>
  );
}
