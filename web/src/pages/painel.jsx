import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, Cabecalho, Stat, Carregando, ErroCarga, Badge, Vazio } from '../ui.jsx';
import { useSessao } from '../sessao.jsx';
import { brl, pct, rotulo } from '../format.js';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const SERIES = [
  { chave: 'recuperado_confirmado_centavos', nome: 'Recebido e confirmado', cor: '#15803d' },
  { chave: 'informado_centavos', nome: 'Total informado pelos devedores', cor: '#1d5fa7' },
];
const compacto = (c) => {
  const v = c / 100;
  if (v >= 1e6) return `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (v >= 1e3) return `R$ ${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
};

/** Barras agrupadas por mês (2 séries), com legenda, tooltip e alternativa em tabela. */
export function GraficoMensal({ serie }) {
  const [hover, setHover] = useState(null);
  const [tabela, setTabela] = useState(false);
  const W = 760, H = 240, m = { t: 12, r: 8, b: 28, l: 64 };
  const max = Math.max(1, ...serie.flatMap((p) => SERIES.map((s) => p[s.chave])));
  const passo = niceStep(max / 4);
  const topo = Math.ceil(max / passo) * passo;
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const bw = iw / serie.length;
  const barra = Math.min(18, (bw - 10) / 2);
  const y = (v) => m.t + ih - (v / topo) * ih;
  const ticks = Array.from({ length: Math.round(topo / passo) + 1 }, (_, i) => i * passo);
  const vazio = serie.every((p) => SERIES.every((s) => !p[s.chave]));
  return (
    <div className="card grafico" style={{ position: 'relative' }}>
      <div className="row between" style={{ marginBottom: 4 }}>
        <h2 style={{ margin: 0 }}>Pagamentos nos últimos 12 meses</h2>
        <button className="btn sm" onClick={() => setTabela(!tabela)}>{tabela ? 'Ver gráfico' : 'Ver tabela'}</button>
      </div>
      <div className="legenda">{SERIES.map((s) => <span key={s.chave} style={{ '--c': s.cor }}>{s.nome}</span>)}</div>
      {tabela ? (
        <div className="tabela-wrap"><table><thead><tr><th>Mês</th>{SERIES.map((s) => <th key={s.chave} className="num">{s.nome}</th>)}</tr></thead>
          <tbody>{serie.map((p) => <tr key={p.mes}><td>{rotMes(p.mes)}</td>{SERIES.map((s) => <td key={s.chave} className="num">{brl(p[s.chave])}</td>)}</tr>)}</tbody></table></div>
      ) : vazio ? <Vazio titulo="Ainda não há pagamentos no período" /> : (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gráfico de barras: pagamentos confirmados e informados por mês" onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth="1" />
              <text x={m.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#6b7280">{compacto(t)}</text>
            </g>
          ))}
          {serie.map((p, i) => {
            const x0 = m.l + i * bw + bw / 2 - barra - 1;
            return (
              <g key={p.mes}>
                {hover === i && <rect x={m.l + i * bw} y={m.t} width={bw} height={ih} fill="#f1f5f9" />}
                {SERIES.map((s, j) => {
                  const v = p[s.chave];
                  if (!v) return null;
                  const h = Math.max(2, (v / topo) * ih);
                  const x = x0 + j * (barra + 2);
                  const r = Math.min(4, barra / 2, h);
                  return <path key={s.chave} fill={s.cor} d={`M${x},${m.t + ih} V${m.t + ih - h + r} Q${x},${m.t + ih - h} ${x + r},${m.t + ih - h} H${x + barra - r} Q${x + barra},${m.t + ih - h} ${x + barra},${m.t + ih - h + r} V${m.t + ih} Z`} />;
                })}
                <text x={m.l + i * bw + bw / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="#6b7280">{rotMes(p.mes, true)}</text>
                <rect x={m.l + i * bw} y={m.t} width={bw} height={ih + m.b} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${rotMes(p.mes)}: confirmado ${brl(p.recuperado_confirmado_centavos)}, informado ${brl(p.informado_centavos)}`} />
              </g>
            );
          })}
          <line x1={m.l} x2={W - m.r} y1={m.t + ih} y2={m.t + ih} stroke="#cbd5e1" />
        </svg>
      )}
      {hover !== null && !tabela && (
        <div className="tooltip" style={{ left: `${((m.l + hover * bw + bw / 2) / W) * 100}%`, top: 70 }}>
          <strong>{rotMes(serie[hover].mes)}</strong>
          {SERIES.map((s) => <div key={s.chave}><span style={{ display: 'inline-block', width: 8, height: 8, background: s.cor, borderRadius: 2, marginRight: 6 }} />{s.nome}: {brl(serie[hover][s.chave])}</div>)}
        </div>
      )}
    </div>
  );
}
function niceStep(v) {
  const p = 10 ** Math.floor(Math.log10(Math.max(v, 1)));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= v) || p * 10;
}
const rotMes = (iso, curto) => { const [a, mm] = iso.split('-'); return curto ? MESES[+mm - 1] : `${MESES[+mm - 1]}/${a}`; };

function Filtros({ valores, set, campos }) {
  return (
    <div className="card row" style={{ padding: 12 }}>
      {campos.map((c) => c.tipo === 'data' ? (
        <label key={c.nome} className="row small muted">{c.rotulo}<input type="date" style={{ width: 150 }} value={valores[c.nome] || ''} onChange={(e) => set({ ...valores, [c.nome]: e.target.value || undefined })} /></label>
      ) : (
        <select key={c.nome} style={{ width: 'auto' }} value={valores[c.nome] || ''} onChange={(e) => set({ ...valores, [c.nome]: e.target.value || undefined })} aria-label={c.rotulo}>
          <option value="">{c.rotulo}: todos</option>
          {c.opcoes.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{rotulo(o)}</option> : <option key={o.valor} value={o.valor}>{o.rotulo}</option>))}
        </select>
      ))}
      {Object.values(valores).some(Boolean) && <button className="btn sm" onClick={() => set({})}>Limpar filtros</button>}
    </div>
  );
}

export function PainelEmpresa() {
  const s = useSessao();
  const [filtros, setFiltros] = useState({});
  const { data, carregando, erro, recarregar } = useApi('dashboardEmpresa', { filtros });
  const carteiras = useApi('listarCarteiras', { pageSize: 200 });
  const usuarios = useApi(s.pode('usuario.gerenciar_empresa') ? 'listarUsuarios' : null, { pageSize: 200 });
  const f = data?.financeiro;
  const o = data?.operacional;
  return (
    <div className="stack">
      <Cabecalho titulo="Dashboard" sub="Valores reais da sua carteira. Só pagamentos confirmados por você contam como recuperados.">
        {s.pode('divida.editar') && <Link className="btn prim" to="/dividas?nova=1">Nova dívida</Link>}
      </Cabecalho>
      {s.empresa?.status !== 'ATIVA' && <div className="aviso alerta">Sua empresa está como <strong>{rotulo(s.empresa?.status)}</strong>. Você já pode cadastrar e cobrar por conta própria; o encaminhamento à HS é liberado após a validação.</div>}
      <Filtros valores={filtros} set={setFiltros} campos={[
        { nome: 'de', rotulo: 'De', tipo: 'data' }, { nome: 'ate', rotulo: 'Até', tipo: 'data' },
        { nome: 'modalidade', rotulo: 'Modalidade', opcoes: ['AUTOCONTRATADA', 'HS_GERENCIADA'] },
        { nome: 'carteira_id', rotulo: 'Carteira', opcoes: (carteiras.data?.itens || []).map((c) => ({ valor: c.id, rotulo: c.nome })) },
        { nome: 'status', rotulo: 'Status', opcoes: ['EM_ABERTO', 'EM_ACORDO', 'PARCIALMENTE_PAGA', 'QUITADA'] },
        ...(usuarios.data ? [{ nome: 'responsavel_id', rotulo: 'Responsável', opcoes: usuarios.data.itens.map((u) => ({ valor: u.id, rotulo: u.nome })) }] : []),
      ]} />
      {erro ? <ErroCarga erro={erro} onRetry={recarregar} /> : carregando && !f ? <Carregando linhas={6} /> : (
        <>
          <div className="grid g4">
            <Stat rotulo="Recebido e confirmado" valor={brl(f.valor_recuperado_confirmado_centavos)} tom="ok" destaque ajuda={`Taxa de recuperação: ${pct(f.taxa_recuperacao_bps)}`} />
            <Stat rotulo="Saldo ainda pendente" valor={brl(f.saldo_pendente_centavos)} />
            <Stat rotulo="Saldo total em atraso" valor={brl(f.saldo_em_atraso_centavos)} tom="critico" />
            <Stat rotulo="Valor original das dívidas" valor={brl(f.valor_original_centavos)} ajuda={`${f.quantidade_dividas} dívidas`} />
            <Stat rotulo="Informado como pago (a conferir)" valor={brl(f.valor_informado_pago_centavos)} tom="alerta" />
            <Stat rotulo="Em negociação" valor={brl(f.valor_em_negociacao_centavos)} ajuda="Propostas não são dinheiro recuperado" />
            <Stat rotulo="Acordos formalizados" valor={brl(f.valor_acordos_centavos)} ajuda="Acordos não são dinheiro recuperado" />
            <Stat rotulo="Encaminhado à HS" valor={brl(f.valor_encaminhado_hs_centavos)} ajuda={f.comissao_hs_centavos ? `Comissão HS sobre recebidos: ${brl(f.comissao_hs_centavos)}` : undefined} />
          </div>
          <div className="grid g3">
            <Link to="/pagamentos" className="card stat"><span className="rot">Pagamentos aguardando sua conferência</span><span className="val" style={{ color: o.pagamentos_aguardando_confirmacao ? 'var(--alerta)' : undefined }}>{o.pagamentos_aguardando_confirmacao}</span></Link>
            <Link to="/negociacoes" className="card stat"><span className="rot">Propostas aguardando sua aprovação</span><span className="val" style={{ color: o.aprovacoes_pendentes ? 'var(--alerta)' : undefined }}>{o.aprovacoes_pendentes}</span></Link>
            <div className="card stat"><span className="rot">Dívidas próprias / na HS</span><span className="val">{o.dividas_proprias} / {o.dividas_hs}</span></div>
          </div>
          <GraficoMensal serie={data.serie} />
          <div className="card">
            <h2>Casos de cobrança por status</h2>
            {Object.keys(o.casos_por_status).length ? <div className="row">{Object.entries(o.casos_por_status).map(([k, v]) => <Badge key={k} status={k}>{rotulo(k)}: {v}</Badge>)}</div> : <Vazio titulo="Nenhum caso de cobrança aberto" />}
          </div>
        </>
      )}
    </div>
  );
}

export function PainelHS() {
  const s = useSessao();
  const [filtros, setFiltros] = useState({});
  const { data: d, carregando, erro, recarregar } = useApi('dashboardHS', { filtros });
  const empresas = useApi(s.pode('empresa.gerenciar_todas') ? 'listarEmpresas' : 'listarEmpresasAtendidas', { pageSize: 200 });
  const ops = useApi(s.pode('caso.distribuir') ? 'listarOperadores' : null);
  const listaEmp = Array.isArray(empresas.data) ? empresas.data : empresas.data?.itens || [];
  return (
    <div className="stack">
      <Cabecalho titulo="Visão geral HS" sub="Indicadores calculados a partir dos registros reais. Recuperado = pagamentos confirmados pelos credores." />
      <Filtros valores={filtros} set={setFiltros} campos={[
        { nome: 'de', rotulo: 'De', tipo: 'data' }, { nome: 'ate', rotulo: 'Até', tipo: 'data' },
        { nome: 'empresa_id', rotulo: 'Empresa', opcoes: listaEmp.map((e) => ({ valor: e.id, rotulo: e.nome_fantasia || e.razao_social })) },
        ...(ops.data ? [{ nome: 'operador_id', rotulo: 'Operador', opcoes: ops.data.map((o) => ({ valor: o.id, rotulo: o.nome })) }] : []),
        ...(s.pode('empresa.gerenciar_todas') ? [{ nome: 'modalidade', rotulo: 'Modalidade', opcoes: ['HS_GERENCIADA', 'AUTOCONTRATADA'] }] : []),
        { nome: 'status', rotulo: 'Status', opcoes: ['AGUARDANDO_VALIDACAO', 'AGUARDANDO_OPERADOR', 'ATRIBUIDO', 'EM_CONTATO', 'EM_NEGOCIACAO', 'ACORDO_AGUARDANDO_PAGAMENTO', 'PAGAMENTO_INFORMADO', 'PARCIALMENTE_RECUPERADO', 'RECUPERADO_INTEGRALMENTE', 'SEM_SUCESSO', 'SUSPENSO', 'CONTESTACAO'] },
      ]} />
      {erro ? <ErroCarga erro={erro} onRetry={recarregar} /> : carregando && !d ? <Carregando linhas={6} /> : (
        <>
          <div className="grid g4">
            <Stat rotulo="Valores confirmados como recuperados" valor={brl(d.valor_recuperado_confirmado_centavos)} tom="ok" destaque />
            <Stat rotulo="Valores informados como pagos" valor={brl(d.valor_informado_pago_centavos)} tom="alerta" />
            <Stat rotulo="Dívidas em operação" valor={d.dividas_em_operacao} />
            <Stat rotulo="Acordos ativos" valor={d.acordos_ativos} />
            <Stat rotulo="Casos aguardando validação" valor={d.casos_aguardando_validacao} tom={d.casos_aguardando_validacao ? 'alerta' : ''} />
            <Stat rotulo="Casos aguardando operador" valor={d.casos_aguardando_operador} tom={d.casos_aguardando_operador ? 'alerta' : ''} />
            <Stat rotulo="Casos em negociação" valor={d.casos_em_negociacao} />
            <Stat rotulo="Operadores ativos" valor={d.operadores_ativos} />
            <Stat rotulo="Empresas cadastradas" valor={d.empresas_cadastradas} />
            <Stat rotulo="Empresas ativas" valor={d.empresas_ativas} />
            {d.assinaturas_ativas !== undefined && <Stat rotulo="Assinaturas ativas" valor={d.assinaturas_ativas} />}
            <Stat rotulo="Empresas com cobrança gerenciada" valor={d.empresas_cobranca_gerenciada} />
            <Stat rotulo="Carteiras recebidas" valor={d.carteiras_recebidas} />
          </div>
          <GraficoMensal serie={d.serie} />
          <div className="card p0">
            <div style={{ padding: '12px 16px 0' }}><h2>Produtividade no mês</h2></div>
            <div className="tabela-wrap"><table>
              <thead><tr><th>Operador</th><th className="num">Interações</th><th className="num">Acordos</th><th className="num">Casos ativos</th></tr></thead>
              <tbody>{d.produtividade_mensal.map((p) => <tr key={p.operador_id}><td>{p.nome}</td><td className="num">{p.interacoes}</td><td className="num">{p.acordos}</td><td className="num">{p.casos_ativos}</td></tr>)}</tbody>
            </table>{!d.produtividade_mensal.length && <Vazio titulo="Nenhum operador cadastrado" />}</div>
          </div>
        </>
      )}
    </div>
  );
}
