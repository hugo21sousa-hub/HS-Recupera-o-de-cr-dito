import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import './styles.css';
import { SessaoProvider, useSessao } from './sessao.jsx';
import { ToastProvider, ConfirmProvider, Carregando, Vazio } from './ui.jsx';
import { Layout } from './layout.jsx';
import { Entrar, Cadastro, Convite, Onboarding, Documento, Esqueci } from './pages/acesso.jsx';
import { Exigir2FA } from './pages/seguranca.jsx';
import { PainelEmpresa, PainelHS } from './pages/painel.jsx';
import { Devedores, DevedorDetalhe, Dividas, DividaDetalhe, Parcelas, Importar } from './pages/cadastros.jsx';
import { MinhasCobrancas, CobrancasHS, Carteiras, CarteiraDetalhe, Encaminhar, Autorizacoes } from './pages/cobranca.jsx';
import { CasoDetalhe } from './pages/caso.jsx';
import { Negociacoes, Acordos, Pagamentos, Relatorios } from './pages/financeiro.jsx';
import { Usuarios, Contratos, Assinatura, Configuracoes, MinhaConta, Modelos } from './pages/gestao.jsx';
import { TriagemWhatsApp } from './pages/hs.jsx';
import { Empresas, EmpresasAtendidas, CarteirasRecebidas, Validacao, Distribuicao, MeusCasos, TodosCasos, Interacoes, Tarefas, Operadores, ContratosHS, Planos, Auditoria } from './pages/hs.jsx';

function Protegida({ p, children }) {
  const s = useSessao();
  const ok = !p || (Array.isArray(p) ? s.podeAlgum(...p) : s.pode(p));
  return ok ? children : <Vazio titulo="Acesso não permitido">Seu perfil não tem permissão para esta área.</Vazio>;
}

function Raiz() {
  const s = useSessao();
  const loc = useLocation();
  if (s.carregando) return <div style={{ padding: 40 }}><Carregando /></div>;
  const publicas = ['/entrar', '/cadastro', '/esqueci', '/termos', '/privacidade'];
  const ehConvite = loc.pathname.startsWith('/convite/');
  if (!s.logado) {
    return (
      <Routes>
        <Route path="/entrar" element={<Entrar />} />
        <Route path="/cadastro" element={<Cadastro />} />
        <Route path="/esqueci" element={<Esqueci />} />
        <Route path="/convite/:token" element={<Convite />} />
        <Route path="/termos" element={<Documento tipo="termos" />} />
        <Route path="/privacidade" element={<Documento tipo="privacidade" />} />
        <Route path="*" element={<Navigate to="/entrar" replace />} />
      </Routes>
    );
  }
  if (ehConvite) return <Routes><Route path="/convite/:token" element={<Convite />} /></Routes>;
  if (loc.pathname === '/termos' || loc.pathname === '/privacidade') return <Documento tipo={loc.pathname.slice(1)} />;
  if (s.perfil?.seguranca?.exige_2fa && !s.perfil?.seguranca?.dois_fatores_ativo) return <Exigir2FA />;
  if (s.perfil?.precisa_onboarding && !s.ehHS) return <Routes><Route path="*" element={<Onboarding />} /></Routes>;
  if (s.usuario?.status && s.usuario.status !== 'ATIVO') return <Vazio titulo="Acesso bloqueado">Fale com o administrador da sua empresa.</Vazio>;
  const inicio = s.ehHS ? (s.pode('relatorio.hs') ? '/hs' : '/hs/meus') : s.pode('relatorio.empresa') ? '/painel' : '/dividas';
  if (publicas.includes(loc.pathname)) return <Navigate to={inicio} replace />;
  const P = (p, el) => <Protegida p={p}>{el}</Protegida>;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to={inicio} replace />} />
        <Route path="/conta" element={<MinhaConta />} />
        <Route path="/casos/:id" element={<CasoDetalhe />} />
        {!s.ehHS && <>
          <Route path="/painel" element={P('relatorio.empresa', <PainelEmpresa />)} />
          <Route path="/devedores" element={P('devedor.ler', <Devedores />)} />
          <Route path="/devedores/:id" element={P('devedor.ler', <DevedorDetalhe />)} />
          <Route path="/dividas" element={P('divida.ler', <Dividas />)} />
          <Route path="/dividas/:id" element={P('divida.ler', <DividaDetalhe />)} />
          <Route path="/parcelas" element={P('divida.ler', <Parcelas />)} />
          <Route path="/importar" element={P('divida.editar', <Importar />)} />
          <Route path="/cobrancas" element={P('caso.ler_empresa', <MinhasCobrancas />)} />
          <Route path="/cobranca-hs" element={P('caso.ler_empresa', <CobrancasHS />)} />
          <Route path="/cobranca-hs/encaminhar" element={P('carteira.encaminhar_hs', <Encaminhar />)} />
          <Route path="/cobranca-hs/autorizacoes" element={P('carteira.ler', <Autorizacoes />)} />
          <Route path="/carteiras" element={P('carteira.ler', <Carteiras />)} />
          <Route path="/carteiras/:id" element={P('carteira.ler', <CarteiraDetalhe />)} />
          <Route path="/negociacoes" element={P('negociacao.ler', <Negociacoes />)} />
          <Route path="/acordos" element={P('acordo.ler', <Acordos />)} />
          <Route path="/pagamentos" element={P('pagamento.ler', <Pagamentos />)} />
          <Route path="/relatorios" element={P('relatorio.empresa', <Relatorios />)} />
          <Route path="/usuarios" element={P('usuario.gerenciar_empresa', <Usuarios />)} />
          <Route path="/contratos" element={P('contrato.ler', <Contratos />)} />
          <Route path="/assinatura" element={P('assinatura.ler', <Assinatura />)} />
          <Route path="/configuracoes" element={P('empresa.ler', <Configuracoes />)} />
        </>}
        {s.ehHS && <>
          <Route path="/hs" element={P('relatorio.hs', <PainelHS />)} />
          <Route path="/hs/empresas" element={P('empresa.gerenciar_todas', <Empresas />)} />
          <Route path="/hs/atendidas" element={P('caso.ler_todos_hs', <EmpresasAtendidas />)} />
          <Route path="/hs/carteiras" element={P('caso.ler_todos_hs', <CarteirasRecebidas />)} />
          <Route path="/hs/validacao" element={P('carteira.validar', <Validacao />)} />
          <Route path="/hs/distribuicao" element={P('caso.distribuir', <Distribuicao />)} />
          <Route path="/hs/meus" element={P(['caso.ler_atribuidos', 'caso.ler_todos_hs'], <MeusCasos />)} />
          <Route path="/hs/casos" element={P('caso.ler_todos_hs', <TodosCasos />)} />
          <Route path="/hs/interacoes" element={P('interacao.registrar', <Interacoes />)} />
          <Route path="/hs/negociacoes" element={P('negociacao.propor', <Negociacoes />)} />
          <Route path="/hs/acordos" element={P('negociacao.propor', <Acordos />)} />
          <Route path="/hs/pagamentos" element={P('pagamento.informar', <Pagamentos />)} />
          <Route path="/hs/tarefas" element={P('tarefa.gerenciar', <Tarefas />)} />
          <Route path="/hs/relatorios" element={P('prestacao.gerar', <Relatorios />)} />
          <Route path="/hs/operadores" element={P('caso.distribuir', <Operadores />)} />
          <Route path="/hs/equipe" element={P('usuario.gerenciar_interno', <Usuarios internos />)} />
          <Route path="/hs/contratos" element={P('contrato.gerenciar', <ContratosHS />)} />
          <Route path="/hs/planos" element={P('plano.gerenciar', <Planos />)} />
          <Route path="/hs/modelos" element={P('config.sistema', <Modelos global />)} />
          <Route path="/hs/whatsapp" element={P('caso.distribuir', <TriagemWhatsApp />)} />
          <Route path="/hs/auditoria" element={P('auditoria.ler', <Auditoria />)} />
        </>}
        <Route path="*" element={<Vazio titulo="Página não encontrada" />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider><ConfirmProvider><SessaoProvider><Raiz /></SessaoProvider></ConfirmProvider></ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
