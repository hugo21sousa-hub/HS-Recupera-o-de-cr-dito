import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { hs } from './api.js';
import { tom, rotulo, reaisParaCentavos, pctParaBps, centavosParaTexto, cpfValido, cnpjValido } from './format.js';

/* ---------- Toasts ---------- */
const ToastCtx = createContext(null);
export function ToastProvider({ children }) {
  const [itens, setItens] = useState([]);
  const push = useCallback((tipo, msg) => {
    const id = Math.random();
    setItens((l) => [...l, { id, tipo, msg }]);
    setTimeout(() => setItens((l) => l.filter((x) => x.id !== id)), tipo === 'erro' ? 7000 : 4000);
  }, []);
  const api = useMemo(() => ({ ok: (m) => push('ok', m), info: (m) => push('info', m), erro: (e) => push('erro', e?.message || String(e)) }), [push]);
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">{itens.map((t) => <div key={t.id} className={`toast ${t.tipo}`}>{t.msg}</div>)}</div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ---------- Dados ---------- */
export function useApi(acao, payload = {}, deps = []) {
  const [estado, setEstado] = useState({ data: null, carregando: true, erro: null });
  const chave = JSON.stringify(payload);
  const seq = useRef(0);
  const carregar = useCallback(async () => {
    if (!acao) return;
    const n = ++seq.current;
    setEstado((s) => ({ ...s, carregando: true, erro: null }));
    try {
      const data = await hs(acao, JSON.parse(chave));
      if (n === seq.current) setEstado({ data, carregando: false, erro: null });
    } catch (erro) {
      if (n === seq.current) setEstado({ data: null, carregando: false, erro });
    }
  }, [acao, chave, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { carregar(); }, [carregar]);
  return { ...estado, recarregar: carregar };
}

/** Executa uma ação com toast de sucesso/erro e estado "enviando". */
export function useExecutar() {
  const toast = useToast();
  const [enviando, setEnviando] = useState(false);
  const executar = useCallback(async (acao, payload, msgOk) => {
    setEnviando(true);
    try {
      const r = await hs(acao, payload);
      if (msgOk) toast.ok(msgOk);
      return r;
    } catch (e) {
      toast.erro(e);
      throw e;
    } finally {
      setEnviando(false);
    }
  }, [toast]);
  return { executar, enviando };
}

/* ---------- Básicos ---------- */
export const Badge = ({ status, children }) => <span className={`badge ${tom(status)}`}>{children ?? rotulo(status)}</span>;
export const Spinner = () => <span className="spinner" aria-label="Carregando" />;
export function Carregando({ linhas = 4 }) {
  return <div className="stack" aria-busy="true">{Array.from({ length: linhas }, (_, i) => <div key={i} className="skeleton" style={{ width: `${90 - i * 12}%` }} />)}</div>;
}
export function Vazio({ titulo = 'Nada por aqui ainda', children }) {
  return <div className="vazio"><strong>{titulo}</strong>{children}</div>;
}
export function ErroCarga({ erro, onRetry }) {
  return <div className="aviso critico row between"><span>{erro?.message || 'Não foi possível carregar.'}</span>{onRetry && <button className="btn sm" onClick={onRetry}>Tentar novamente</button>}</div>;
}
export function Cabecalho({ titulo, sub, children, voltar }) {
  return (
    <div className="cabecalho">
      <div>
        {voltar && <Link to={voltar} className="small">← Voltar</Link>}
        <h1>{titulo}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}
export const Stat = ({ rotulo: r, valor, tom: t, destaque, ajuda }) => (
  <div className={`card stat ${t || ''} ${destaque ? 'destaque' : ''}`} title={ajuda}>
    <span className="rot">{r}</span><span className="val">{valor}</span>{ajuda && <span className="small muted">{ajuda}</span>}
  </div>
);
export function Dl({ itens }) {
  return <dl className="dl">{itens.filter(Boolean).map(([k, v]) => [<dt key={k + 't'}>{k}</dt>, <dd key={k + 'd'}>{v ?? '—'}</dd>])}</dl>;
}
export function Abas({ abas, ativa, onChange }) {
  return (
    <div className="abas" role="tablist">
      {abas.map((a) => <button key={a.id} role="tab" aria-selected={ativa === a.id} className={ativa === a.id ? 'ativa' : ''} onClick={() => onChange(a.id)}>{a.rotulo}{a.contador ? ` (${a.contador})` : ''}</button>)}
    </div>
  );
}

/* ---------- Modal e confirmação ---------- */
export function Modal({ titulo, onClose, children, rodape, grande }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${grande ? 'grande' : ''}`} role="dialog" aria-modal="true" aria-label={titulo}>
        <header><h2 style={{ margin: 0 }}>{titulo}</h2><button className="btn icone" onClick={onClose} aria-label="Fechar">✕</button></header>
        <div className="corpo">{children}</div>
        {rodape && <footer>{rodape}</footer>}
      </div>
    </div>
  );
}

const ConfirmCtx = createContext(null);
export function ConfirmProvider({ children }) {
  const [pedido, setPedido] = useState(null);
  const [motivo, setMotivo] = useState('');
  const confirmar = useCallback((opts) => new Promise((resolve) => { setMotivo(''); setPedido({ ...opts, resolve }); }), []);
  const fechar = (valor) => { pedido.resolve(valor); setPedido(null); };
  return (
    <ConfirmCtx.Provider value={confirmar}>
      {children}
      {pedido && (
        <Modal titulo={pedido.titulo || 'Confirmar'} onClose={() => fechar(null)} rodape={<>
          <button className="btn" onClick={() => fechar(null)}>Cancelar</button>
          <button className={`btn ${pedido.perigo ? 'perigo cheio' : 'prim'}`} disabled={pedido.pedirMotivo && !motivo.trim()} onClick={() => fechar({ motivo: motivo.trim() })}>{pedido.botao || 'Confirmar'}</button>
        </>}>
          <div className="stack">
            {typeof pedido.mensagem === 'string' ? <p>{pedido.mensagem}</p> : pedido.mensagem}
            {pedido.pedirMotivo && (
              <div className="campo">
                <label htmlFor="motivo-conf">{pedido.rotuloMotivo || 'Motivo'} *</label>
                <textarea id="motivo-conf" autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={1000} />
              </div>
            )}
          </div>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

/* ---------- Formulários ---------- */
function valorInicial(c, v) {
  if (v === undefined || v === null) return c.tipo === 'checkbox' ? false : c.tipo === 'multi' ? [] : '';
  if (c.tipo === 'dinheiro') return centavosParaTexto(v);
  if (c.tipo === 'percentual') return String(v / 100).replace('.', ',');
  return v;
}

export function converter(campos, valores) {
  const out = {}, erros = {};
  for (const c of campos) {
    if (c.oculto) continue;
    let v = valores[c.nome];
    const vazio = v === '' || v === undefined || v === null || (Array.isArray(v) && !v.length) || (c.tipo === 'checkbox' && v === false && c.obrigatorio);
    if (vazio) {
      if (c.obrigatorio) erros[c.nome] = c.tipo === 'checkbox' ? 'Obrigatório' : 'Campo obrigatório';
      else if (c.tipo !== 'checkbox') { out[c.nome] = c.tipo === 'dinheiro' || c.tipo === 'numero' || c.tipo === 'percentual' ? undefined : ''; continue; }
    }
    if (c.tipo === 'dinheiro') {
      const cents = reaisParaCentavos(v);
      if (vazio) continue;
      if (Number.isNaN(cents)) { erros[c.nome] = 'Valor inválido (ex.: 1.234,56)'; continue; }
      if (!c.permitirZero && cents <= 0) { erros[c.nome] = 'Informe um valor maior que zero'; continue; }
      v = cents;
    } else if (c.tipo === 'percentual') {
      if (vazio) continue;
      v = pctParaBps(v);
      if (Number.isNaN(v) || v < 0 || v > 10000) { erros[c.nome] = 'Percentual entre 0 e 100'; continue; }
    } else if (c.tipo === 'numero') {
      if (vazio) continue;
      v = Number(v);
      if (!Number.isInteger(v) || v < (c.min ?? 0) || (c.max != null && v > c.max)) { erros[c.nome] = `Número inteiro${c.max != null ? ` entre ${c.min ?? 0} e ${c.max}` : ''}`; continue; }
    } else if (c.tipo === 'documento') {
      v = String(v).replace(/\D/g, '');
      const tipoPessoa = c.tipoPessoaDe ? valores[c.tipoPessoaDe] : null;
      const ok = tipoPessoa === 'PJ' ? cnpjValido(v) : tipoPessoa === 'PF' ? cpfValido(v) : cpfValido(v) || cnpjValido(v);
      if (!ok) { erros[c.nome] = 'CPF/CNPJ inválido'; continue; }
    } else if (c.tipo === 'cnpj') {
      v = String(v).replace(/\D/g, '');
      if (!cnpjValido(v)) { erros[c.nome] = 'CNPJ inválido'; continue; }
    } else if (c.tipo === 'email' && v) {
      v = String(v).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { erros[c.nome] = 'E-mail inválido'; continue; }
    } else if (typeof v === 'string') v = v.trim();
    if (c.validar) { const m = c.validar(v, valores); if (m) { erros[c.nome] = m; continue; } }
    out[c.nome] = v;
  }
  return { out, erros };
}

export function Campos({ campos, valores, setValores, erros = {} }) {
  const set = (n, v) => setValores((s) => ({ ...s, [n]: v }));
  return (
    <div className="form-grid">
      {campos.filter((c) => !c.oculto && (!c.mostrarSe || c.mostrarSe(valores))).map((c) => {
        const id = `f-${c.nome}`;
        const v = valores[c.nome];
        let input;
        if (c.tipo === 'select') input = (
          <select id={id} value={v ?? ''} onChange={(e) => set(c.nome, e.target.value)}>
            {!c.semVazio && <option value="">Selecione…</option>}
            {c.opcoes.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{rotulo(o)}</option> : <option key={o.valor} value={o.valor}>{o.rotulo}</option>))}
          </select>
        );
        else if (c.tipo === 'multi') input = (
          <div className="row">{c.opcoes.map((o) => {
            const val = typeof o === 'string' ? o : o.valor;
            return <label key={val} className="check"><input type="checkbox" checked={(v || []).includes(val)} onChange={(e) => set(c.nome, e.target.checked ? [...(v || []), val] : (v || []).filter((x) => x !== val))} />{typeof o === 'string' ? rotulo(o) : o.rotulo}</label>;
          })}</div>
        );
        else if (c.tipo === 'textarea') input = <textarea id={id} value={v ?? ''} onChange={(e) => set(c.nome, e.target.value)} maxLength={c.max || 4000} />;
        else if (c.tipo === 'checkbox') input = <label className="check"><input id={id} type="checkbox" checked={!!v} onChange={(e) => set(c.nome, e.target.checked)} />{c.textoCheck || c.rotulo}</label>;
        else input = (
          <input id={id} value={v ?? ''} onChange={(e) => set(c.nome, e.target.value)} placeholder={c.placeholder}
            type={c.tipo === 'data' ? 'date' : c.tipo === 'email' ? 'email' : c.tipo === 'senha' ? 'password' : c.tipo === 'numero' ? 'number' : 'text'}
            inputMode={['dinheiro', 'percentual'].includes(c.tipo) ? 'decimal' : ['documento', 'cnpj', 'telefone'].includes(c.tipo) ? 'numeric' : undefined}
            autoComplete={c.autoComplete} />
        );
        return (
          <div key={c.nome} className={`campo ${c.full || c.tipo === 'textarea' || c.tipo === 'multi' ? 'full' : ''}`}>
            {c.tipo !== 'checkbox' && <label htmlFor={id}>{c.rotulo}{c.obrigatorio ? ' *' : ''}{c.tipo === 'dinheiro' ? ' (R$)' : c.tipo === 'percentual' ? ' (%)' : ''}</label>}
            {input}
            {erros[c.nome] ? <span className="erro">{erros[c.nome]}</span> : c.ajuda && <span className="ajuda">{c.ajuda}</span>}
          </div>
        );
      })}
    </div>
  );
}

export function useFormulario(campos, inicial = {}) {
  const [valores, setValores] = useState(() => Object.fromEntries(campos.map((c) => [c.nome, valorInicial(c, inicial[c.nome] ?? c.padrao)])));
  const [erros, setErros] = useState({});
  const validar = () => { const r = converter(campos.filter((c) => !c.mostrarSe || c.mostrarSe(valores)), valores); setErros(r.erros); return Object.keys(r.erros).length ? null : r.out; };
  return { valores, setValores, erros, validar };
}

/** Modal com formulário declarativo. onSubmit recebe os valores convertidos (centavos/bps). */
export function FormModal({ titulo, campos, inicial, onSubmit, onClose, botao = 'Salvar', grande, children, aviso }) {
  const f = useFormulario(campos, inicial);
  const [enviando, setEnviando] = useState(false);
  const toast = useToast();
  const enviar = async (e) => {
    e?.preventDefault();
    const dados = f.validar();
    if (!dados) return;
    setEnviando(true);
    try { await onSubmit(dados); onClose(); } catch (err) { toast.erro(err); } finally { setEnviando(false); }
  };
  return (
    <Modal titulo={titulo} onClose={onClose} grande={grande} rodape={<>
      <button className="btn" type="button" onClick={onClose}>Cancelar</button>
      <button className="btn prim" onClick={enviar} disabled={enviando}>{enviando ? <Spinner /> : null}{botao}</button>
    </>}>
      <form onSubmit={enviar} className="stack">
        {aviso}
        <Campos campos={campos} valores={f.valores} setValores={f.setValores} erros={f.erros} />
        {children}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/* ---------- Tabela com busca, filtros e paginação no servidor ---------- */
export function Tabela({ acao, payload = {}, colunas, busca = true, filtros = [], acoesBarra, vazio, recarregar = 0, pageSize = 20, aoCarregar }) {
  const [page, setPage] = useState(1);
  const [termo, setTermo] = useState('');
  const [termoAtivo, setTermoAtivo] = useState('');
  const [valFiltros, setValFiltros] = useState({});
  useEffect(() => { const t = setTimeout(() => { setTermoAtivo(termo); setPage(1); }, 350); return () => clearTimeout(t); }, [termo]);
  const req = { ...payload, page, pageSize, busca: termoAtivo || undefined, filtros: { ...(payload.filtros || {}), ...valFiltros } };
  const { data, carregando, erro, recarregar: rec } = useApi(acao, req, [recarregar]);
  useEffect(() => { if (data && aoCarregar) aoCarregar(data); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const itens = Array.isArray(data) ? data : data?.itens || [];
  const total = Array.isArray(data) ? data.length : data?.total || 0;
  const paginas = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="card p0">
      {(busca || filtros.length || acoesBarra) && (
        <div className="barra-tabela">
          {busca && <input type="search" placeholder="Buscar…" value={termo} onChange={(e) => setTermo(e.target.value)} aria-label="Buscar" />}
          {filtros.map((f) => (
            f.tipo === 'data'
              ? <label key={f.nome} className="row small muted">{f.rotulo}<input type="date" style={{ width: 150 }} value={valFiltros[f.nome] || ''} onChange={(e) => { setValFiltros((s) => ({ ...s, [f.nome]: e.target.value || undefined })); setPage(1); }} /></label>
              : <select key={f.nome} value={valFiltros[f.nome] || ''} onChange={(e) => { setValFiltros((s) => ({ ...s, [f.nome]: e.target.value || undefined })); setPage(1); }} aria-label={f.rotulo}>
                  <option value="">{f.rotulo}: todos</option>
                  {f.opcoes.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{rotulo(o)}</option> : <option key={o.valor} value={o.valor}>{o.rotulo}</option>))}
                </select>
          ))}
          <div style={{ flex: 1 }} />
          {acoesBarra}
        </div>
      )}
      {erro ? <div style={{ padding: 12 }}><ErroCarga erro={erro} onRetry={rec} /></div> : (
        <div className="tabela-wrap">
          <table>
            <thead><tr>{colunas.map((c) => <th key={c.titulo} className={c.num ? 'num' : ''}>{c.titulo}</th>)}</tr></thead>
            <tbody>
              {carregando && !itens.length ? Array.from({ length: 4 }, (_, i) => <tr key={i}>{colunas.map((c) => <td key={c.titulo}><div className="skeleton" /></td>)}</tr>)
                : itens.map((r) => <tr key={r.id || JSON.stringify(r)}>{colunas.map((c) => <td key={c.titulo} className={c.num ? 'num' : ''}>{c.render ? c.render(r, rec) : r[c.campo] ?? '—'}</td>)}</tr>)}
            </tbody>
          </table>
          {!carregando && !itens.length && (vazio || <Vazio />)}
        </div>
      )}
      {!Array.isArray(data) && total > pageSize && (
        <div className="paginacao">
          <span className="muted small">{total} registros · página {page} de {paginas}</span>
          <div className="row">
            <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
            <button className="btn sm" disabled={page >= paginas} onClick={() => setPage(page + 1)}>Próxima</button>
          </div>
        </div>
      )}
    </div>
  );
}
