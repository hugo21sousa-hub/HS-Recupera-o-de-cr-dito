// Indicadores do negócio (superadmin).
import { Link } from 'react-router-dom';
import { Cabecalho, useApi, Carregando, ErroCarga, Vazio, Stat, Badge } from '../ui.jsx';
import { brl, data, dataHora, pct } from '../format.js';

const nomeMes = (m) => { const [a, mm] = m.split('-'); return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(mm) - 1]}/${a.slice(2)}`; };

export function IndicadoresNegocio() {
  const { data: d, carregando, erro, recarregar } = useApi('indicadoresNegocio', {});
  if (erro) return <ErroCarga erro={erro} onRetry={recarregar} />;
  if (carregando && !d) return <Carregando linhas={8} />;
  return (
    <div className="stack">
      <Cabecalho titulo="Indicadores do negócio" sub={`Assinaturas da plataforma e comissão da cobrança gerenciada, calculadas dos registros reais. Atualizado em ${dataHora(d.gerado_em)}.`}>
        <button className="btn" onClick={recarregar}>Atualizar</button>
      </Cabecalho>

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
