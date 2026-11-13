import { useEffect, useRef, useState } from 'react';
import logoAzul from './assets/acorly-logo.png';
import logoBranco from './assets/acorly-logo-branco.png';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { hs, sair as sairDoSistema, DEMO, restaurarDemo } from './api.js';
import { useSessao } from './sessao.jsx';
import { rotulo, dataHora, data } from './format.js';

export const MENU_EMPRESA = [
  { secao: 'Visão geral', itens: [{ to: '/painel', r: 'Dashboard', p: 'relatorio.empresa' }] },
  { secao: 'Cadastros', itens: [
    { to: '/devedores', r: 'Clientes e devedores', p: 'devedor.ler' },
    { to: '/dividas', r: 'Dívidas', p: 'divida.ler' },
    { to: '/parcelas', r: 'Parcelas', p: 'divida.ler' },
    { to: '/importar', r: 'Importar planilha', p: 'divida.editar', recurso: 'importacao' },
  ] },
  { secao: 'Cobrança', itens: [
    { to: '/cobrancas', r: 'Minhas cobranças', p: 'caso.ler_empresa' },
    { to: '/mensagens', r: 'Central de mensagens', p: 'interacao.registrar' },
    { to: '/cobranca-hs', r: 'Cobranças Acorly', p: 'caso.ler_empresa' },
    { to: '/carteiras', r: 'Carteiras', p: 'carteira.ler', recurso: 'carteiras' },
    { to: '/negociacoes', r: 'Negociações', p: 'negociacao.ler', contador: 'aprovacoes' },
    { to: '/acordos', r: 'Acordos', p: 'acordo.ler' },
    { to: '/pagamentos', r: 'Pagamentos', p: 'pagamento.ler', contador: 'pagamentos' },
  ] },
  { secao: 'Gestão', itens: [
    { to: '/relatorios', r: 'Relatórios', p: 'relatorio.empresa', recurso: 'relatorios' },
    { to: '/usuarios', r: 'Usuários', p: 'usuario.gerenciar_empresa' },
    { to: '/contratos', r: 'Contratos', p: 'contrato.ler' },
    { to: '/assinatura', r: 'Assinatura', p: 'assinatura.ler' },
    { to: '/configuracoes', r: 'Configurações', p: 'empresa.ler' },
  ] },
];

export const MENU_HS = [
  { secao: 'Negócio', itens: [{ to: '/hs/negocio', r: 'Indicadores do negócio', p: 'plano.gerenciar' }] },
  { secao: 'Central de operações', itens: [
    { to: '/hs', r: 'Visão geral', p: 'relatorio.hs', fim: true },
    { to: '/hs/empresas', r: 'Empresas', p: 'empresa.gerenciar_todas' },
    { to: '/hs/atendidas', r: 'Empresas atendidas', p: 'caso.ler_todos_hs', semP: 'empresa.gerenciar_todas' },
    { to: '/hs/carteiras', r: 'Carteiras recebidas', p: 'caso.ler_todos_hs' },
    { to: '/hs/validacao', r: 'Aguardando validação', p: 'carteira.validar' },
    { to: '/hs/distribuicao', r: 'Aguardando distribuição', p: 'caso.distribuir' },
    { to: '/hs/meus', r: 'Meus casos', p: ['caso.ler_atribuidos', 'caso.ler_todos_hs'] },
    { to: '/hs/casos', r: 'Todos os casos autorizados', p: 'caso.ler_todos_hs' },
    { to: '/hs/mensagens', r: 'Central de mensagens', p: 'interacao.registrar' },
    { to: '/hs/negociacoes', r: 'Negociações', p: 'negociacao.propor' },
    { to: '/hs/acordos', r: 'Acordos', p: 'negociacao.propor' },
    { to: '/hs/pagamentos', r: 'Pagamentos em confirmação', p: 'pagamento.informar' },
    { to: '/hs/tarefas', r: 'Tarefas', p: 'tarefa.gerenciar' },
    { to: '/hs/relatorios', r: 'Relatórios', p: 'prestacao.gerar' },
    { to: '/hs/operadores', r: 'Operadores', p: 'caso.distribuir' },
    { to: '/hs/whatsapp', r: 'WhatsApp sem caso', p: 'caso.distribuir' },
  ] },
  { secao: 'Administração Acorly', itens: [
    { to: '/hs/equipe', r: 'Equipe interna', p: 'usuario.gerenciar_interno' },
    { to: '/hs/contratos', r: 'Contratos de cobrança', p: 'contrato.gerenciar' },
    { to: '/hs/planos', r: 'Planos e assinaturas', p: 'plano.gerenciar' },
    { to: '/hs/comissoes', r: 'Comissão da cobrança', p: 'config.sistema' },
    { to: '/hs/modelos', r: 'Modelos de mensagem', p: 'config.sistema' },
    { to: '/hs/auditoria', r: 'Auditoria', p: 'auditoria.ler' },
  ] },
];

export function Marca({ escura }) {
  return <div className={`marca ${escura ? 'escura' : ''}`}><img src={escura ? logoAzul : logoBranco} alt="Acorly" /></div>;
}

function Notificacoes() {
  const [aberto, setAberto] = useState(false);
  const [dados, setDados] = useState({ itens: [], total: 0 });
  const [naoLidas, setNaoLidas] = useState(0);
  const nav = useNavigate();
  const ref = useRef();
  const carregar = async () => {
    try {
      const [todas, novas] = await Promise.all([hs('listarNotificacoes', { pageSize: 15 }), hs('listarNotificacoes', { naoLidas: true, pageSize: 1 })]);
      setDados(todas); setNaoLidas(novas.total);
    } catch { /* silencioso */ }
  };
  useEffect(() => { carregar(); const t = setInterval(carregar, 60000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const fora = (e) => ref.current && !ref.current.contains(e.target) && setAberto(false);
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, []);
  const abrir = async (n) => {
    if (!n.lida) { await hs('marcarNotificacaoLida', { notificacao_id: n.id }).catch(() => {}); carregar(); }
    setAberto(false);
    if (n.link) nav(n.link);
  };
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="btn icone" aria-label={`Notificações (${naoLidas} não lidas)`} onClick={() => { setAberto(!aberto); if (!aberto) carregar(); }}>
        🔔{naoLidas > 0 && <span className="contador" style={{ position: 'absolute', top: -4, right: -4 }}>{naoLidas}</span>}
      </button>
      {aberto && (
        <div className="pop">
          {!dados.itens.length ? <div className="vazio">Nenhuma notificação</div> : dados.itens.map((n) => (
            <div key={n.id} className={`item ${n.lida ? '' : 'nova'}`} onClick={() => abrir(n)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && abrir(n)}>
              <div style={{ fontWeight: 600 }}>{n.titulo}</div>
              {n.mensagem && <div className="small muted">{n.mensagem}</div>}
              <div className="small muted">{dataHora(n.data_criacao)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Aviso do teste grátis, de mensalidade em atraso ou de acesso somente para consulta. */
function AvisoAssinatura() {
  const s = useSessao();
  const a = s.acesso;
  if (!a || a.modo === 'ATIVO') return null;
  const podeAssinar = s.pode('assinatura.ler');
  const botao = (texto) => (podeAssinar ? (a.fatura_url && a.modo !== 'TESTE'
    ? <a className="btn sm prim" href={a.fatura_url} target="_blank" rel="noreferrer">{texto}</a>
    : <NavLink className="btn sm prim" to="/assinatura">{texto}</NavLink>) : null);
  if (a.modo === 'TESTE') {
    return (
      <div className="aviso info row between aviso-assinatura">
        <span><strong>Teste grátis:</strong> {a.dias_restantes === 1 ? 'último dia' : `faltam ${a.dias_restantes} dias`} (até {data(a.teste_ate)}). Até lá, você usa todos os recursos{a.limites?.devedores ? `, com até ${a.limites.devedores} devedores` : ''}.</span>
        {botao('Ver planos')}
      </div>
    );
  }
  if (a.modo === 'TOLERANCIA') {
    return (
      <div className="aviso alerta row between aviso-assinatura">
        <span><strong>Mensalidade em atraso.</strong> Pague até {data(a.pagar_ate)} para não perder o acesso de edição.</span>
        {botao('Pagar fatura')}
      </div>
    );
  }
  return (
    <div className="aviso critico row between aviso-assinatura">
      <span>
        <strong>Acesso somente para consulta.</strong> {a.motivo === 'ATRASO' ? 'A mensalidade está em atraso.' : `O teste grátis de ${a.dias_teste} dias terminou.`} Seus dados continuam guardados e disponíveis para consulta e exportação.
        {a.com_contrato && ' O cadastro e o encaminhamento de dívidas ao Acorly continuam liberados.'}
      </span>
      {botao(a.motivo === 'ATRASO' ? 'Pagar fatura' : 'Assinar um plano')}
    </div>
  );
}

export function Layout() {
  const s = useSessao();
  const [aberta, setAberta] = useState(false);
  const [contadores, setContadores] = useState({});
  const loc = useLocation();
  useEffect(() => setAberta(false), [loc.pathname]);
  useEffect(() => {
    if (s.ehHS) return;
    (async () => {
      const c = {};
      if (s.pode('negociacao.aprovar_empresa')) c.aprovacoes = (await hs('listarAprovacoesPendentes', { pageSize: 1 }).catch(() => ({ total: 0 }))).total;
      if (s.pode('pagamento.confirmar')) c.pagamentos = (await hs('listarPagamentos', { pageSize: 1, filtros: { status_confirmacao: 'INFORMADO' } }).catch(() => ({ total: 0 }))).total;
      setContadores(c);
    })();
  }, [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  const menu = s.ehHS ? MENU_HS : MENU_EMPRESA;
  const permitido = (i) => (Array.isArray(i.p) ? s.podeAlgum(...i.p) : s.pode(i.p)) && !(i.semP && s.pode(i.semP));
  const sair = () => sairDoSistema();
  return (
    <div className="app">
      <aside className={`lateral ${aberta ? 'aberta' : ''}`} aria-label="Menu principal">
        <Marca />
        <nav>
          {menu.map((g) => {
            const itens = g.itens.filter(permitido);
            if (!itens.length) return null;
            return [<div key={g.secao} className="secao">{g.secao}</div>, ...itens.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.fim} className={({ isActive }) => (isActive ? 'ativo' : '')}>
                <span>{i.r}</span>{i.recurso && s.acesso && !s.acesso.recursos?.includes(i.recurso) && <span className="cadeado" title="Disponível em um plano superior">🔒</span>}{i.contador && contadores[i.contador] > 0 && <span className="contador">{contadores[i.contador]}</span>}
              </NavLink>
            ))];
          })}
        </nav>
        <div style={{ marginTop: 'auto' }} className="small">
          <NavLink to="/conta" className={({ isActive }) => (isActive ? 'ativo' : '')}>Minha conta</NavLink>
          <a href="/privacidade" target="_blank" rel="noreferrer">Política de privacidade</a>
        </div>
      </aside>
      <div className="principal">
        <header className="topo">
          <div className="row">
            <button className="btn icone menu-btn" onClick={() => setAberta(!aberta)} aria-label="Abrir menu">☰</button>
            <div>
              <div style={{ fontWeight: 600 }}>{s.ehHS ? 'Equipe Acorly' : s.empresa?.nome_fantasia || s.empresa?.razao_social}</div>
              {!s.ehHS && s.empresa?.status !== 'ATIVA' && <div className="small" style={{ color: 'var(--alerta)' }}>Empresa: {rotulo(s.empresa?.status)}</div>}
            </div>
          </div>
          <div className="row">
            <Notificacoes />
            <div className="small right" style={{ lineHeight: 1.2 }}><div style={{ fontWeight: 600 }}>{s.usuario?.nome}</div><div className="muted">{rotulo(s.usuario?.perfil)}</div></div>
            <button className="btn sm" onClick={sair}>Sair</button>
          </div>
        </header>
        <main className="conteudo">
          {DEMO && (
            <div className="aviso info row between" style={{ marginBottom: 16 }}>
              <span>Você está na <strong>demonstração</strong>: as alterações ficam só neste navegador. Downloads e anexos ficam desativados.</span>
              <button className="btn sm" onClick={() => restaurarDemo()}>Restaurar dados de exemplo</button>
            </div>
          )}
          {!s.ehHS && <AvisoAssinatura />}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
