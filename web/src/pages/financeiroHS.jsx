// Financeiro da empresa (superadmin): contas a pagar, lançamentos, despesas recorrentes (equipe, sistemas…) e DRE mensal.
import { useState } from 'react';
import { hs, abrirLink, enviarArquivo, baixarArquivo } from '../api.js';
import { Cabecalho, Abas, Modal, Badge, Stat, Vazio, Carregando, ErroCarga, useApi, useExecutar, useToast } from '../ui.jsx';
import { brl, data, pct } from '../format.js';
import { montarPDFDRE, csvDRE, nomeMes, mesAbrev } from '../drePdf.js';

const FORMAS = { PIX: 'Pix', BOLETO: 'Boleto', CARTAO: 'Cartão', TRANSFERENCIA: 'Transferência', DEBITO_AUTOMATICO: 'Débito automático', DINHEIRO: 'Dinheiro', OUTRO: 'Outro' };
const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const mesAtual = () => hojeBR().slice(0, 7);
const somaMes = (m, n) => { const [a, mm] = m.split('-').map(Number); return new Date(Date.UTC(a, mm - 1 + n, 1)).toISOString().slice(0, 7); };
const reais = (c) => (c / 100).toFixed(2).replace('.', ',');
// Margem: com receita quase zero o percentual perde sentido
const margem = (bps, receita) => (!receita ? '—' : bps < -10000 ? 'abaixo de −100%' : pct(bps));

function SituacaoLancamento({ l }) {
  if (l.status === 'CANCELADO') return <Badge status="CANCELADA">Cancelado</Badge>;
  if (l.status === 'PAGO') return <Badge status="ATIVA">{l.tipo === 'RECEITA' ? 'Recebido' : 'Pago'}{l.pago_em ? ` ${data(l.pago_em)}` : ''}</Badge>;
  return <Badge status={l.vencido ? 'CANCELADA' : 'PENDENTE'}>{l.vencido ? 'Vencido' : l.tipo === 'RECEITA' ? 'A receber' : 'A pagar'}</Badge>;
}

/** Novo lançamento ou edição. */
function FormLancamento({ inicial, cats, onClose, onFeito }) {
  const [v, setV] = useState(inicial?.id ? { ...inicial, valor: reais(inicial.valor_centavos) } : { tipo: 'DESPESA', categoria: '', descricao: '', fornecedor: '', valor: '', vencimento: hojeBR(), competencia: '', forma_pagamento: '', observacao: '', recorrente: false, recorrente_ate: '', ja_pago: false, ...inicial });
  const [arquivo, setArquivo] = useState(null);
  const { executar, enviando } = useExecutar();
  const toast = useToast();
  const set = (k) => (e) => setV({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const lista = v.tipo === 'RECEITA' ? cats.receita : cats.despesa;
  const salvar = async () => {
    try {
      let comp = {};
      if (arquivo) comp = { comprovante_uri: (await enviarArquivo(arquivo)).file_uri, comprovante_nome: arquivo.name };
      await executar('salvarLancamentoHS', { ...v, ...comp, pago_em: !v.id && v.ja_pago ? (v.pago_em || hojeBR()) : undefined }, v.id ? 'Lançamento atualizado' : v.recorrente ? 'Lançamento criado: ele se repete todo mês' : 'Lançamento criado');
      onFeito(); onClose();
    } catch (e) { if (e?.message && arquivo) toast.erro(e); }
  };
  return (
    <Modal grande titulo={v.id ? 'Editar lançamento' : 'Novo lançamento'} onClose={onClose} rodape={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn prim" disabled={enviando} onClick={salvar}>Salvar</button></>}>
      <div className="stack">
        {!v.id && <div className="row" style={{ gap: 6 }}>{['DESPESA', 'RECEITA'].map((t) => <button key={t} type="button" className={`btn sm${v.tipo === t ? ' prim' : ''}`} onClick={() => setV({ ...v, tipo: t, categoria: '' })}>{t === 'DESPESA' ? 'Despesa' : 'Receita'}</button>)}</div>}
        <div className="form-grid">
          <div className="campo"><label>Categoria *</label><select value={v.categoria} onChange={set('categoria')}><option value="">Escolha…</option>{Object.entries(lista).map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select></div>
          <div className="campo"><label>Descrição *</label><input value={v.descricao} onChange={set('descricao')} placeholder={v.tipo === 'DESPESA' ? 'Ex.: Salário de operador, Render, Contador' : 'Ex.: Consultoria avulsa'} /></div>
          <div className="campo"><label>{v.tipo === 'DESPESA' ? 'Fornecedor ou colaborador' : 'Cliente'}</label><input value={v.fornecedor} onChange={set('fornecedor')} /></div>
          <div className="campo"><label>Valor (R$) *</label><input value={v.valor} onChange={set('valor')} inputMode="decimal" placeholder="0,00" /></div>
          <div className="campo"><label>Vencimento *</label><input type="date" value={v.vencimento} onChange={set('vencimento')} /></div>
          <div className="campo"><label>Mês de competência</label><input type="month" value={v.competencia} onChange={set('competencia')} /><span className="small muted">Mês a que a despesa se refere no DRE. Vazio = mês do vencimento.</span></div>
          <div className="campo"><label>Forma de pagamento</label><select value={v.forma_pagamento} onChange={set('forma_pagamento')}><option value="">—</option>{Object.entries(FORMAS).map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select></div>
          <div className="campo"><label>Comprovante ou nota (opcional)</label><input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => setArquivo(e.target.files?.[0] || null)} />{v.comprovante_nome && !arquivo && <span className="small muted">Atual: {v.comprovante_nome}</span>}</div>
        </div>
        {!v.id && (
          <div className="stack" style={{ gap: 6 }}>
            <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={v.recorrente} onChange={set('recorrente')} /> Repete todo mês (salário, sistema, contador, aluguel…)</label>
            {v.recorrente && <div className="campo" style={{ maxWidth: 260 }}><label>Até (opcional)</label><input type="month" value={v.recorrente_ate} onChange={set('recorrente_ate')} /><span className="small muted">Vazio = sem data para terminar.</span></div>}
            <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={v.ja_pago} onChange={set('ja_pago')} /> Já foi {v.tipo === 'DESPESA' ? 'pago' : 'recebido'}</label>
            {v.ja_pago && <div className="campo" style={{ maxWidth: 260 }}><label>Data</label><input type="date" value={v.pago_em || hojeBR()} onChange={set('pago_em')} /></div>}
          </div>
        )}
        <div className="campo"><label>Observação</label><textarea rows={2} value={v.observacao} onChange={set('observacao')} /></div>
      </div>
    </Modal>
  );
}

function Pagar({ l, onClose, onFeito }) {
  const [v, setV] = useState({ pago_em: hojeBR(), forma_pagamento: l.forma_pagamento || 'PIX' });
  const [arquivo, setArquivo] = useState(null);
  const { executar, enviando } = useExecutar();
  const salvar = async () => {
    try {
      const comp = arquivo ? { comprovante_uri: (await enviarArquivo(arquivo)).file_uri, comprovante_nome: arquivo.name } : {};
      await executar('pagarLancamentoHS', { id: l.id, ...v, ...comp }, l.tipo === 'RECEITA' ? 'Recebimento registrado' : 'Pagamento registrado');
      onFeito(); onClose();
    } catch { /* aviso já mostrado */ }
  };
  return (
    <Modal titulo={`${l.tipo === 'RECEITA' ? 'Receber' : 'Pagar'}: ${l.descricao}`} onClose={onClose} rodape={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn prim" disabled={enviando} onClick={salvar}>Confirmar</button></>}>
      <div className="stack">
        <div className="small">Valor: <strong>{brl(l.valor_centavos)}</strong> · vencimento {data(l.vencimento)}</div>
        <div className="form-grid">
          <div className="campo"><label>Data</label><input type="date" value={v.pago_em} onChange={(e) => setV({ ...v, pago_em: e.target.value })} /></div>
          <div className="campo"><label>Forma</label><select value={v.forma_pagamento} onChange={(e) => setV({ ...v, forma_pagamento: e.target.value })}>{Object.entries(FORMAS).map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select></div>
        </div>
        <div className="campo"><label>Comprovante (opcional)</label><input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => setArquivo(e.target.files?.[0] || null)} /></div>
      </div>
    </Modal>
  );
}

function TabelaLancamentos({ itens, onPagar, onEditar, onMudou, fechado }) {
  const { executar } = useExecutar();
  const toast = useToast();
  if (!itens.length) return <Vazio titulo="Nenhum lançamento">Use "Novo lançamento" para registrar despesas e receitas da empresa.</Vazio>;
  return (
    <div className="tabela-wrap"><table><thead><tr><th>Vencimento</th><th>Descrição</th><th>Categoria</th><th className="num">Valor</th><th>Situação</th><th /></tr></thead><tbody>
      {itens.map((l) => (
        <tr key={l.id}>
          <td>{data(l.vencimento)}</td>
          <td><strong>{l.descricao}</strong>{l.recorrencia_id && <span className="small muted"> · mensal</span>}{l.fornecedor && <div className="small muted">{l.fornecedor}</div>}</td>
          <td className="small">{l.rotulo_categoria}</td>
          <td className="num" style={{ color: l.tipo === 'RECEITA' ? 'var(--ok)' : undefined }}>{l.tipo === 'RECEITA' ? '+' : '−'}{brl(l.valor_centavos)}</td>
          <td><SituacaoLancamento l={l} /></td>
          <td><div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
            {l.status === 'PENDENTE' && <button className="btn sm prim" onClick={() => onPagar(l)}>{l.tipo === 'RECEITA' ? 'Receber' : 'Pagar'}</button>}
            {l.status === 'PAGO' && <button className="btn sm" onClick={() => executar('pagarLancamentoHS', { id: l.id, desfazer: true }, 'Pagamento desfeito').then(onMudou).catch(() => {})}>Desfazer</button>}
            {l.comprovante_uri && <button className="btn sm" onClick={() => abrirLink(hs('urlComprovanteHS', { id: l.id })).catch(toast.erro)}>Comprovante</button>}
            {!fechado && l.status !== 'CANCELADO' && <button className="btn sm" onClick={() => onEditar(l)}>Editar</button>}
            {!fechado && l.status !== 'CANCELADO' && <button className="btn sm" onClick={() => { const m = window.prompt(`Cancelar "${l.descricao}"? Motivo:`, ''); if (m !== null) executar('cancelarLancamentoHS', { id: l.id, motivo: m }, 'Lançamento cancelado').then(onMudou).catch(() => {}); }}>Cancelar</button>}
          </div></td>
        </tr>
      ))}
    </tbody></table></div>
  );
}

function VisaoGeral({ r, onPagar, onNovo }) {
  const { data: d, erro, recarregar } = useApi('painelFinanceiroHS', {}, [r]);
  if (erro) return <ErroCarga erro={erro} onRetry={recarregar} />;
  if (!d) return <Carregando linhas={6} />;
  return (
    <div className="stack">
      <div className="grid g4">
        <Stat rotulo="Contas vencidas" valor={d.vencidas.qtd ? brl(d.vencidas.total_centavos) : 'Nenhuma'} ajuda={d.vencidas.qtd ? `${d.vencidas.qtd} conta(s)` : 'Tudo em dia'} tom={d.vencidas.qtd ? 'critico' : 'ok'} />
        <Stat rotulo="Vencem hoje" valor={brl(d.hoje_pagar.total_centavos)} ajuda={`${d.hoje_pagar.qtd} conta(s)`} tom={d.hoje_pagar.qtd ? 'alerta' : undefined} />
        <Stat rotulo="Próximos 7 dias" valor={brl(d.proximos_7.total_centavos)} ajuda={`${d.proximos_7.qtd} conta(s)`} />
        <Stat rotulo={`Resultado de ${nomeMes(d.mes).split(' ')[0]} (DRE)`} valor={brl(d.resultado_mes.lucro_centavos)} ajuda={`Receita ${brl(d.resultado_mes.receita_bruta_centavos)} · margem ${margem(d.resultado_mes.margem_bps, d.resultado_mes.receita_bruta_centavos)}`} tom={d.resultado_mes.lucro_centavos >= 0 ? 'ok' : 'critico'} />
      </div>
      <div className="grid g2">
        <div className="card stack" style={{ gap: 8 }}>
          <div className="row between"><h2 style={{ margin: 0 }}>Contas a pagar</h2><button className="btn sm prim" onClick={onNovo}>Novo lançamento</button></div>
          {d.a_pagar_lista.length ? <table className="small"><tbody>{d.a_pagar_lista.map((l) => (
            <tr key={l.id}><td>{data(l.vencimento)}</td><td>{l.descricao}{l.fornecedor ? <div className="muted">{l.fornecedor}</div> : null}</td><td className="num">{brl(l.valor_centavos)}</td><td><SituacaoLancamento l={l} /></td><td><button className="btn sm" onClick={() => onPagar(l)}>Pagar</button></td></tr>
          ))}</tbody></table> : <Vazio titulo="Nada vencendo nos próximos 7 dias" />}
        </div>
        <div className="card stack" style={{ gap: 8 }}>
          <h2 style={{ margin: 0 }}>Caixa de {nomeMes(d.mes)}</h2>
          <table className="small"><tbody>
            <tr><td>Entradas</td><td className="num" style={{ color: 'var(--ok)' }}>{brl(d.caixa_mes.entradas_centavos)}</td></tr>
            <tr><td>Saídas (pagas)</td><td className="num">{brl(d.caixa_mes.saidas_centavos)}</td></tr>
            <tr><td><strong>Saldo do mês</strong></td><td className="num"><strong style={{ color: d.caixa_mes.saldo_centavos >= 0 ? 'var(--ok)' : 'var(--critico)' }}>{brl(d.caixa_mes.saldo_centavos)}</strong></td></tr>
          </tbody></table>
          <span className="small muted">{d.caixa_mes.nota}</span>
          {d.despesas_por_categoria.length > 0 && <>
            <strong className="small">Despesas do mês por categoria</strong>
            <table className="small"><tbody>{d.despesas_por_categoria.map((c) => <tr key={c.categoria}><td>{c.rotulo}</td><td className="num">{brl(c.total_centavos)}</td></tr>)}</tbody></table>
          </>}
        </div>
      </div>
    </div>
  );
}

function Lancamentos({ r, onMudou, onPagar, onEditar, onNovo }) {
  const [mes, setMes] = useState(mesAtual());
  const [tipo, setTipo] = useState('');
  const [status, setStatus] = useState('');
  const { data: d, erro, recarregar } = useApi('listarLancamentosHS', { mes, tipo: tipo || undefined, status: status || undefined, pageSize: 200 }, [r, mes, tipo, status]);
  return (
    <div className="stack">
      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm" onClick={() => setMes(somaMes(mes, -1))} aria-label="Mês anterior">‹</button>
        <input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} style={{ width: 170 }} />
        <button className="btn sm" onClick={() => setMes(somaMes(mes, 1))} aria-label="Próximo mês">›</button>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Despesas e receitas</option><option value="DESPESA">Só despesas</option><option value="RECEITA">Só receitas</option></select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todas as situações</option><option value="PENDENTE">A pagar/receber</option><option value="VENCIDO">Vencidos</option><option value="PAGO">Pagos/recebidos</option><option value="CANCELADO">Cancelados</option></select>
        <div style={{ flex: 1 }} />
        <button className="btn prim" onClick={onNovo}>Novo lançamento</button>
      </div>
      {erro ? <ErroCarga erro={erro} onRetry={recarregar} /> : !d ? <Carregando /> : (
        <>
          {d.fechado && <div className="aviso info small">{nomeMes(d.mes)} está <strong>fechado</strong>: os lançamentos não podem ser alterados (pagamentos ainda podem ser registrados). Para corrigir, reabra o mês na aba DRE.</div>}
          <div className="grid g4">
            <Stat rotulo="Despesas do mês" valor={brl(d.totais.despesas_centavos)} />
            <Stat rotulo="Já pagas" valor={brl(d.totais.pago_centavos)} tom="ok" />
            <Stat rotulo="A pagar" valor={brl(d.totais.a_pagar_centavos)} tom={d.totais.a_pagar_centavos ? 'alerta' : undefined} />
            <Stat rotulo="Outras receitas lançadas" valor={brl(d.totais.receitas_centavos)} ajuda="Mensalidades e comissões entram sozinhas no DRE" />
          </div>
          <TabelaLancamentos itens={d.itens} fechado={d.fechado} onPagar={onPagar} onEditar={onEditar} onMudou={() => { recarregar(); onMudou(); }} />
        </>
      )}
    </div>
  );
}

function Recorrentes({ r, onMudou }) {
  const { data: d, erro, recarregar } = useApi('listarRecorrenciasHS', {}, [r]);
  const [ed, setEd] = useState(null);
  const { executar, enviando } = useExecutar();
  if (erro) return <ErroCarga erro={erro} onRetry={recarregar} />;
  if (!d) return <Carregando />;
  const salvar = async () => { try { await executar('salvarRecorrenciaHS', { id: ed.id, descricao: ed.descricao, valor: ed.valor, dia_vencimento: ed.dia_vencimento, fim: ed.fim || '' }, 'Atualizado: vale para os meses em aberto'); setEd(null); recarregar(); onMudou(); } catch { /* aviso já mostrado */ } };
  const ativas = d.filter((x) => x.ativa);
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>Despesas fixas que se repetem todo mês: equipe (salários, pró-labore), sistemas, contador, aluguel. O sistema lança cada mês sozinho, com o vencimento no dia escolhido. Para criar, use "Novo lançamento" e marque "Repete todo mês". {ativas.length > 0 && <strong>Total mensal das despesas fixas: {brl(ativas.filter((x) => x.tipo === 'DESPESA').reduce((s, x) => s + x.valor_centavos, 0))}.</strong>}</p>
      {d.length ? <table><thead><tr><th>Descrição</th><th>Categoria</th><th className="num">Valor mensal</th><th>Vence dia</th><th>Período</th><th /></tr></thead><tbody>
        {d.map((x) => (
          <tr key={x.id} style={{ opacity: x.ativa ? 1 : 0.55 }}>
            <td><strong>{x.descricao}</strong>{x.fornecedor && <div className="small muted">{x.fornecedor}</div>}</td>
            <td className="small">{x.rotulo_categoria}</td>
            <td className="num">{brl(x.valor_centavos)}</td>
            <td>{x.dia_vencimento}</td>
            <td className="small">desde {mesAbrev(x.inicio)}{x.fim ? ` até ${mesAbrev(x.fim)}` : ''}{!x.ativa && ' · encerrada'}</td>
            <td>{x.ativa && <div className="row" style={{ gap: 4 }}><button className="btn sm" onClick={() => setEd({ ...x, valor: reais(x.valor_centavos) })}>Editar</button><button className="btn sm" disabled={enviando} onClick={() => { if (window.confirm(`Encerrar "${x.descricao}"? Os meses em aberto que ainda não foram pagos serão cancelados.`)) executar('salvarRecorrenciaHS', { id: x.id, ativa: false }, 'Recorrência encerrada').then(() => { recarregar(); onMudou(); }).catch(() => {}); }}>Encerrar</button></div>}</td>
          </tr>
        ))}
      </tbody></table> : <Vazio titulo="Nenhuma despesa fixa cadastrada">Cadastre a equipe e os sistemas como "Repete todo mês".</Vazio>}
      {ed && (
        <Modal titulo={`Editar: ${ed.descricao}`} onClose={() => setEd(null)} rodape={<><button className="btn" onClick={() => setEd(null)}>Cancelar</button><button className="btn prim" disabled={enviando} onClick={salvar}>Salvar</button></>}>
          <div className="form-grid">
            <div className="campo"><label>Descrição</label><input value={ed.descricao} onChange={(e) => setEd({ ...ed, descricao: e.target.value })} /></div>
            <div className="campo"><label>Valor mensal (R$)</label><input value={ed.valor} onChange={(e) => setEd({ ...ed, valor: e.target.value })} /></div>
            <div className="campo"><label>Dia do vencimento</label><input type="number" min="1" max="31" value={ed.dia_vencimento} onChange={(e) => setEd({ ...ed, dia_vencimento: e.target.value })} /></div>
            <div className="campo"><label>Até (opcional)</label><input type="month" value={ed.fim || ''} onChange={(e) => setEd({ ...ed, fim: e.target.value })} /></div>
          </div>
          <p className="small muted">A mudança vale para este mês e os próximos que ainda não foram pagos. Meses fechados não mudam.</p>
        </Modal>
      )}
    </div>
  );
}

function DRE({ r, onMudou }) {
  const [mes, setMes] = useState(somaMes(mesAtual(), 0));
  const { data: d, erro, recarregar } = useApi('dreMensal', { mes }, [r, mes]);
  const { executar, enviando } = useExecutar();
  const toast = useToast();
  const fechar = () => { const obs = window.prompt(`Fechar ${nomeMes(mes)}? O DRE fica registrado e os lançamentos do mês são travados. Observação (opcional):`, ''); if (obs !== null) executar('fecharMesHS', { mes, observacao: obs }, 'Mês fechado').then(() => { recarregar(); onMudou(); }).catch(() => {}); };
  const reabrir = () => { const m = window.prompt(`Reabrir ${nomeMes(mes)}? Informe o motivo (fica registrado na auditoria):`, ''); if (m) executar('reabrirMesHS', { mes, motivo: m }, 'Mês reaberto').then(() => { recarregar(); onMudou(); }).catch(() => {}); };
  const maxHist = d ? Math.max(1, ...d.historico.map((h) => Math.abs(h.receita_bruta_centavos))) : 1;
  return (
    <div className="stack">
      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm" onClick={() => setMes(somaMes(mes, -1))} aria-label="Mês anterior">‹</button>
        <input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} style={{ width: 170 }} />
        <button className="btn sm" onClick={() => setMes(somaMes(mes, 1))} aria-label="Próximo mês">›</button>
        {d && <Badge status={d.fechado ? 'ATIVA' : 'PENDENTE'}>{d.fechado ? 'Mês fechado' : 'Em aberto'}</Badge>}
        <div style={{ flex: 1 }} />
        {d && <>
          <button className="btn" onClick={() => { try { montarPDFDRE(d).save(`DRE-Acorly-${mes}.pdf`); } catch (e) { toast.erro(e); } }}>Baixar PDF</button>
          <button className="btn" onClick={() => { try { baixarArquivo(`DRE-Acorly-${mes}.csv`, csvDRE(d), 'text/csv;charset=utf-8'); } catch (e) { toast.erro(e); } }}>Planilha (CSV)</button>
          {d.fechado ? <button className="btn" disabled={enviando} onClick={reabrir}>Reabrir mês</button> : mes < mesAtual() && <button className="btn prim" disabled={enviando} onClick={fechar}>Fechar mês</button>}
        </>}
      </div>
      {erro ? <ErroCarga erro={erro} onRetry={recarregar} /> : !d ? <Carregando linhas={10} /> : (
        <div className="grid g2" style={{ alignItems: 'start' }}>
          <div className="card p0">
            <table>
              <thead><tr><th>DRE gerencial · {nomeMes(d.mes)}</th><th className="num">Valor</th></tr></thead>
              <tbody>{d.linhas.map((l) => (
                <tr key={l.rotulo} style={{ background: l.destaque || l.final ? 'var(--azul-claro)' : undefined }}>
                  <td style={{ paddingLeft: l.nivel ? 28 : undefined, fontWeight: l.total ? 700 : 400 }}>{l.rotulo}{l.automatico && <span className="small muted"> · automático</span>}{l.nota && <div className="small muted">{l.nota}</div>}</td>
                  <td className="num" style={{ fontWeight: l.total ? 700 : 400, color: l.final ? (l.valor_centavos >= 0 ? 'var(--ok)' : 'var(--critico)') : undefined }}>{brl(l.valor_centavos)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="stack">
            <div className="grid g2">
              <Stat rotulo="Margem líquida" valor={margem(d.margem_bps, d.receita_bruta_centavos)} tom={d.lucro_centavos >= 0 ? 'ok' : 'critico'} />
              <Stat rotulo={`Acumulado em ${d.mes.slice(0, 4)}`} valor={brl(d.acumulado_ano.lucro_centavos)} ajuda={`Receita ${brl(d.acumulado_ano.receita_bruta_centavos)}`} />
            </div>
            <div className="card stack" style={{ gap: 6 }}>
              <strong className="small">Últimos 6 meses</strong>
              <table className="small"><thead><tr><th>Mês</th><th className="num">Receita</th><th className="num">Lucro</th><th className="num">Margem</th></tr></thead><tbody>
                {d.historico.map((h) => (
                  <tr key={h.mes}><td>{mesAbrev(h.mes)}{h.fechado ? ' ✓' : ''}</td>
                    <td className="num"><div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}><span style={{ display: 'inline-block', height: 6, borderRadius: 3, background: 'var(--azul)', width: `${Math.round((Math.abs(h.receita_bruta_centavos) / maxHist) * 60)}px` }} />{brl(h.receita_bruta_centavos)}</div></td>
                    <td className="num" style={{ color: h.lucro_centavos < 0 ? 'var(--critico)' : undefined }}>{brl(h.lucro_centavos)}</td><td className="num">{margem(h.margem_bps, h.receita_bruta_centavos)}</td></tr>
                ))}
              </tbody></table>
              <span className="small muted">✓ = mês fechado.</span>
            </div>
            {d.impostos_estimados && <div className="aviso info small">Os impostos deste mês foram <strong>estimados</strong> pela alíquota de {(d.aliquota_bps / 100).toFixed(2).replace('.', ',')}%. Quando pagar o DAS, lance-o na categoria "Impostos sobre o faturamento" com a competência do mês: o valor real substitui a estimativa.</div>}
            {!d.aliquota_bps && !d.impostos_estimados && <div className="aviso info small">Configure a alíquota de impostos na aba "Configurações" para o DRE estimar os impostos enquanto o DAS não é lançado.</div>}
            <span className="small muted">DRE gerencial por competência, para acompanhar o negócio. Não substitui o contábil oficial. Mensalidades (Asaas, com as taxas descontadas), comissões da cobrança e comissões de parceiros entram sozinhas; o resto vem dos lançamentos.</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Configuracoes() {
  const { data: d } = useApi('dreMensal', {});
  const [aliq, setAliq] = useState(null);
  const { executar, enviando } = useExecutar();
  const valor = aliq ?? (d ? (d.aliquota_bps / 100).toFixed(2).replace('.', ',') : '');
  return (
    <div className="card stack" style={{ maxWidth: 640 }}>
      <h2 style={{ margin: 0 }}>Impostos sobre o faturamento</h2>
      <p className="small muted" style={{ margin: 0 }}>Alíquota efetiva que a HS paga sobre o faturamento (por exemplo, a do Simples Nacional informada pelo contador). Ela serve para estimar os impostos no DRE enquanto o DAS do mês não é lançado.</p>
      <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
        <div className="campo" style={{ maxWidth: 180 }}><label>Alíquota (%)</label><input value={valor} onChange={(e) => setAliq(e.target.value)} inputMode="decimal" placeholder="6,00" /></div>
        <button className="btn prim" disabled={enviando} onClick={() => executar('configurarFinanceiroHS', { aliquota: valor }, 'Alíquota salva').catch(() => {})}>Salvar</button>
      </div>
    </div>
  );
}

export function FinanceiroHS() {
  const [aba, setAba] = useState('geral');
  const [r, setR] = useState(0);
  const cats = useApi('categoriasFinanceiroHS', {});
  const [form, setForm] = useState(null);
  const [pagar, setPagar] = useState(null);
  const mudou = () => setR((x) => x + 1);
  return (
    <div className="stack">
      <Cabecalho titulo="Financeiro da empresa" sub="Despesas e receitas da HS, contas a pagar, despesas fixas (equipe, sistemas, contador) e o DRE mensal.">
        <button className="btn prim" onClick={() => setForm({})}>Novo lançamento</button>
      </Cabecalho>
      <div className="card">
        <Abas ativa={aba} onChange={setAba} abas={[{ id: 'geral', rotulo: 'Visão geral' }, { id: 'lancamentos', rotulo: 'Lançamentos' }, { id: 'recorrentes', rotulo: 'Despesas fixas' }, { id: 'dre', rotulo: 'DRE mensal' }, { id: 'config', rotulo: 'Configurações' }]} />
        {aba === 'geral' && <VisaoGeral r={r} onPagar={setPagar} onNovo={() => setForm({})} />}
        {aba === 'lancamentos' && <Lancamentos r={r} onMudou={mudou} onPagar={setPagar} onEditar={setForm} onNovo={() => setForm({})} />}
        {aba === 'recorrentes' && <Recorrentes r={r} onMudou={mudou} />}
        {aba === 'dre' && <DRE r={r} onMudou={mudou} />}
        {aba === 'config' && <Configuracoes />}
      </div>
      {form && cats.data && <FormLancamento inicial={form} cats={cats.data} onClose={() => setForm(null)} onFeito={mudou} />}
      {pagar && <Pagar l={pagar} onClose={() => setPagar(null)} onFeito={mudou} />}
    </div>
  );
}
