import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { auth, hs } from '../api.js';
import { useSessao } from '../sessao.jsx';
import { Marca } from '../layout.jsx';
import { Campos, useFormulario, useToast, Spinner, Carregando, Badge } from '../ui.jsx';
import { rotulo } from '../format.js';

function TelaAcesso({ children }) {
  return (
    <div className="acesso">
      <div className="lado">
        <Marca />
        <div>
          <h2>Recupere seus créditos com organização, transparência e respeito ao devedor.</h2>
          <ul>
            <li>Cadastre devedores e dívidas, negocie e acompanhe pagamentos.</li>
            <li>Ou contrate a equipe HS para cobrar por você, acompanhando tudo pelo seu painel.</li>
            <li>O devedor paga direto à sua empresa. Só você confirma o recebimento.</li>
          </ul>
        </div>
        <div className="small">© HS Recuperação de Crédito</div>
      </div>
      <div className="form"><div className="card">{children}</div></div>
    </div>
  );
}

function FormSimples({ campos, botao, onSubmit, rodape }) {
  const f = useFormulario(campos);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null);
  const enviar = async (e) => {
    e.preventDefault();
    const d = f.validar();
    if (!d) return;
    setEnviando(true); setErro(null);
    try { await onSubmit(d); } catch (err) { setErro(err.message); } finally { setEnviando(false); }
  };
  return (
    <form onSubmit={enviar} className="stack">
      <Campos campos={campos.map((c) => ({ ...c, full: true }))} valores={f.valores} setValores={f.setValores} erros={f.erros} />
      {erro && <div className="aviso critico" role="alert">{erro}</div>}
      <button className="btn prim" disabled={enviando} style={{ height: 40 }}>{enviando && <Spinner />}{botao}</button>
      {rodape}
    </form>
  );
}

export function Entrar() {
  const s = useSessao();
  const nav = useNavigate();
  const [desafio, setDesafio] = useState(null);
  const entrar = async () => { await s.recarregar(); nav('/'); };
  return (
    <TelaAcesso>
      <div className="stack">
        <Marca escura />
        {!desafio ? (
          <>
            <h1 style={{ marginTop: 12 }}>Entrar</h1>
            <FormSimples botao="Entrar"
              campos={[{ nome: 'email', rotulo: 'E-mail', tipo: 'email', obrigatorio: true, autoComplete: 'username' }, { nome: 'senha', rotulo: 'Senha', tipo: 'senha', obrigatorio: true, autoComplete: 'current-password' }]}
              onSubmit={async (d) => { const r = await auth.login(d.email, d.senha); if (r?.precisa_2fa) setDesafio(r.desafio); else await entrar(); }}
              rodape={<p className="small muted"><Link to="/esqueci">Esqueci minha senha</Link> · Empresa nova? <Link to="/cadastro">Crie sua conta</Link></p>} />
          </>
        ) : (
          <>
            <h1 style={{ marginTop: 12 }}>Verificação em duas etapas</h1>
            <p className="muted">Digite o código de 6 dígitos do seu aplicativo autenticador. Sem o celular? Use um dos códigos de recuperação.</p>
            <FormSimples botao="Verificar"
              campos={[{ nome: 'codigo', rotulo: 'Código', obrigatorio: true, autoComplete: 'one-time-code', placeholder: '123456' }]}
              onSubmit={async (d) => { await auth.verificar2fa(desafio, d.codigo); await entrar(); }}
              rodape={<button type="button" className="btn link small" onClick={() => setDesafio(null)}>Voltar</button>} />
          </>
        )}
      </div>
    </TelaAcesso>
  );
}

export function Esqueci() {
  const [r, setR] = useState(null);
  return (
    <TelaAcesso>
      <div className="stack">
        <Marca escura />
        <h1 style={{ marginTop: 12 }}>Esqueci minha senha</h1>
        {!r ? (
          <FormSimples botao="Enviar link"
            campos={[{ nome: 'email', rotulo: 'E-mail cadastrado', tipo: 'email', obrigatorio: true, autoComplete: 'username' }]}
            onSubmit={async (d) => setR(await auth.esqueci(d.email))}
            rodape={<p className="small muted"><Link to="/entrar">Voltar para o login</Link></p>} />
        ) : r.email_disponivel ? (
          <div className="aviso ok">Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha em instantes. Confira também a caixa de spam.</div>
        ) : (
          <div className="aviso info">O envio de e-mails não está configurado. Peça ao administrador da sua empresa (ou à HS) um novo link de acesso.</div>
        )}
      </div>
    </TelaAcesso>
  );
}

export function Cadastro() {
  const s = useSessao();
  const nav = useNavigate();
  return (
    <TelaAcesso>
      <div className="stack">
        <Marca escura />
        <h1 style={{ marginTop: 12 }}>Criar conta</h1>
        <p className="muted">Crie seu acesso. Em seguida, você cadastra a sua empresa.</p>
        <FormSimples botao="Criar conta"
          campos={[
            { nome: 'nome', rotulo: 'Seu nome', obrigatorio: true, autoComplete: 'name' },
            { nome: 'email', rotulo: 'E-mail', tipo: 'email', obrigatorio: true, autoComplete: 'username' },
            { nome: 'senha', rotulo: 'Senha', tipo: 'senha', obrigatorio: true, autoComplete: 'new-password', ajuda: 'Mínimo de 8 caracteres, com letras e números.' },
          ]}
          onSubmit={async (d) => { await auth.cadastro(d); await s.recarregar(); nav('/onboarding'); }}
          rodape={<p className="small muted">Já tem conta? <Link to="/entrar">Entrar</Link></p>} />
      </div>
    </TelaAcesso>
  );
}

export function Convite() {
  const { token } = useParams();
  const s = useSessao();
  const nav = useNavigate();
  const [info, setInfo] = useState(undefined);
  useEffect(() => { auth.convite(token).then(setInfo).catch(() => setInfo(null)); }, [token]);
  return (
    <TelaAcesso>
      <div className="stack">
        <Marca escura />
        <h1 style={{ marginTop: 12 }}>Definir senha de acesso</h1>
        {info === undefined ? <Carregando /> : info === null ? <div className="aviso critico">Convite inválido ou expirado. Peça um novo link ao administrador.</div> : (
          <>
            <p className="muted">Acesso para <strong>{info.email}</strong></p>
            <FormSimples botao="Salvar senha e entrar"
              campos={[
                { nome: 'nome', rotulo: 'Seu nome', autoComplete: 'name' },
                { nome: 'senha', rotulo: 'Nova senha', tipo: 'senha', obrigatorio: true, autoComplete: 'new-password', ajuda: 'Mínimo de 8 caracteres, com letras e números.' },
                { nome: 'confirmar', rotulo: 'Confirme a senha', tipo: 'senha', obrigatorio: true, autoComplete: 'new-password', validar: (v, all) => (v !== all.senha ? 'As senhas não conferem' : null) },
              ]}
              onSubmit={async (d) => { await auth.aceitarConvite(token, d.senha, d.nome); await s.recarregar(); nav('/'); }} />
          </>
        )}
      </div>
    </TelaAcesso>
  );
}

const CAMPOS_EMPRESA = [
  { nome: 'razao_social', rotulo: 'Razão social', obrigatorio: true },
  { nome: 'nome_fantasia', rotulo: 'Nome fantasia' },
  { nome: 'cnpj', rotulo: 'CNPJ', tipo: 'cnpj', obrigatorio: true },
  { nome: 'email', rotulo: 'E-mail da empresa', tipo: 'email', obrigatorio: true },
  { nome: 'telefone', rotulo: 'Telefone', tipo: 'telefone', obrigatorio: true },
  { nome: 'responsavel_legal', rotulo: 'Responsável legal', obrigatorio: true },
  { nome: 'endereco', rotulo: 'Endereço completo', obrigatorio: true, full: true },
  { nome: 'contato_nome', rotulo: 'Contato (nome)' },
  { nome: 'contato_telefone', rotulo: 'Contato (telefone)' },
  { nome: 'contato_email', rotulo: 'Contato (e-mail)', tipo: 'email' },
];
export { CAMPOS_EMPRESA };

const CAMPOS_ONB = [...CAMPOS_EMPRESA, { nome: 'admin_nome', rotulo: 'Seu nome (administrador da conta)', obrigatorio: true },
  { nome: 'aceite_termos', tipo: 'checkbox', obrigatorio: true, full: true, textoCheck: <>Li e aceito os <a href="/termos" target="_blank" rel="noreferrer">Termos de Uso</a></> },
  { nome: 'aceite_privacidade', tipo: 'checkbox', obrigatorio: true, full: true, textoCheck: <>Li e aceito a <a href="/privacidade" target="_blank" rel="noreferrer">Política de Privacidade</a></> }];

const SERVICOS = [
  { id: 'PLATAFORMA', titulo: 'A. Quero utilizar a plataforma', texto: 'Sua equipe faz as cobranças pelo sistema. Você paga só a assinatura, sem comissão sobre o que recuperar.' },
  { id: 'HS_GERENCIADA', titulo: 'B. Quero contratar a cobrança da HS', texto: 'A equipe HS faz contatos e negociações. O devedor paga direto à sua empresa. Exige contrato próprio.' },
  { id: 'AMBOS', titulo: 'Quero os dois', texto: 'Parte das dívidas você cobra; outra parte você encaminha à equipe HS.' },
];

export function Onboarding() {
  const s = useSessao();
  const nav = useNavigate();
  const toast = useToast();
  const [servico, setServico] = useState(null);
  const [tipo, setTipo] = useState('CARTEIRA_SELECIONADA');
  const [enviando, setEnviando] = useState(false);
  const f = useFormulario(CAMPOS_ONB, { admin_nome: s.usuario?.nome || s.perfil?.conta?.nome });
  const temEmpresa = !!s.empresa;

  const cadastrar = async (e) => {
    e.preventDefault();
    const d = f.validar();
    if (!d) return;
    setEnviando(true);
    try { await hs('registrarEmpresa', d); await s.recarregar(); toast.ok('Empresa cadastrada'); } catch (err) { toast.erro(err); } finally { setEnviando(false); }
  };
  const escolher = async () => {
    setEnviando(true);
    try {
      await hs('escolherServico', { modalidade_servico: servico, tipo_carteira: servico === 'PLATAFORMA' ? undefined : tipo });
      await s.recarregar();
      toast.ok(servico === 'PLATAFORMA' ? 'Tudo pronto!' : 'Solicitação enviada. A HS vai preparar a proposta de contrato.');
      nav('/painel');
    } catch (err) { toast.erro(err); } finally { setEnviando(false); }
  };

  return (
    <div style={{ minHeight: '100%', padding: '32px 16px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }} className="stack">
        <div className="row between"><Marca escura /><button className="btn sm" onClick={async () => { await auth.logout(); window.location.href = '/entrar'; }}>Sair</button></div>
        <div className="row small"><Badge status={temEmpresa ? 'CONCLUIDA' : 'PENDENTE'}>1. Empresa</Badge><span className="muted">→</span><Badge status={temEmpresa ? 'PENDENTE' : 'info'}>2. Serviço</Badge></div>
        {!temEmpresa ? (
          <form className="card stack" onSubmit={cadastrar}>
            <h1>Cadastro da empresa</h1>
            <p className="muted">Esses dados identificam sua empresa como credora. A HS confere o cadastro antes de liberar a cobrança gerenciada.</p>
            <Campos campos={CAMPOS_ONB} valores={f.valores} setValores={f.setValores} erros={f.erros} />
            <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn prim" disabled={enviando}>{enviando && <Spinner />}Continuar</button></div>
          </form>
        ) : (
          <div className="card stack">
            <h1>Como você quer usar a HS?</h1>
            <div className="escolha" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              {SERVICOS.map((o) => (
                <button key={o.id} type="button" className={`opcao ${servico === o.id ? 'sel' : ''}`} onClick={() => setServico(o.id)} aria-pressed={servico === o.id}>
                  <strong>{o.titulo}</strong><span className="muted">{o.texto}</span>
                </button>
              ))}
            </div>
            {servico && servico !== 'PLATAFORMA' && (
              <fieldset className="stack" style={{ border: '1px solid var(--borda)', borderRadius: 8, padding: 12 }}>
                <legend className="small muted">Escopo da cobrança HS</legend>
                <label className="check"><input type="radio" name="tipo" checked={tipo === 'CARTEIRA_SELECIONADA'} onChange={() => setTipo('CARTEIRA_SELECIONADA')} />Cobrança por carteira selecionada (você escolhe quais dívidas encaminhar)</label>
                <label className="check"><input type="radio" name="tipo" checked={tipo === 'TODOS_ELEGIVEIS'} onChange={() => setTipo('TODOS_ELEGIVEIS')} />Cobrança de todos os devedores elegíveis</label>
              </fieldset>
            )}
            <p className="small muted">Você pode mudar a modalidade depois, conforme as condições contratuais.</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn prim" disabled={!servico || enviando} onClick={escolher}>{enviando && <Spinner />}Concluir</button></div>
            <div className="aviso info">Situação do cadastro: <strong>{rotulo(s.empresa.status)}</strong>. A HS valida os dados da empresa antes de liberar a cobrança gerenciada.</div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Documento({ tipo }) {
  const termos = tipo === 'termos';
  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '32px 16px' }} className="stack">
      <Marca escura />
      <div className="card stack">
        <h1>{termos ? 'Termos de Uso' : 'Política de Privacidade'}</h1>
        <div className="aviso alerta">Modelo-base. O texto definitivo deve ser revisado pelo jurídico da HS antes da comercialização.</div>
        {termos ? (
          <>
            <p>1. A HS Recuperação de Crédito fornece (a) uma plataforma para a empresa gerir as próprias cobranças e (b), mediante contrato específico, um serviço de cobrança extrajudicial administrativa executado pela equipe HS.</p>
            <p>2. A HS não é titular dos créditos, não recebe valores em nome das empresas, não mantém saldo de devedores e não faz repasses. Os pagamentos são feitos diretamente à empresa credora, que é a única responsável por confirmá-los.</p>
            <p>3. A empresa declara que os créditos cadastrados são legítimos, exigíveis e documentados, e que tem base legal para tratar os dados dos devedores.</p>
            <p>4. É proibido usar a plataforma para ameaçar, constranger, expor ou cobrar de forma abusiva, conforme o Código de Defesa do Consumidor (arts. 42 e 71).</p>
            <p>5. A assinatura da plataforma e o serviço de cobrança gerenciada são cobrados separadamente, conforme o plano e o contrato.</p>
          </>
        ) : (
          <>
            <p><strong>Papéis.</strong> A empresa credora é a controladora dos dados dos seus devedores. A HS atua como operadora quando executa a cobrança gerenciada, nos limites da autorização dada pela empresa. A HS é controladora dos dados cadastrais de empresas e usuários da plataforma.</p>
            <p><strong>Dados tratados.</strong> Identificação e contato dos devedores, informações das dívidas, histórico de contatos, negociações e pagamentos.</p>
            <p><strong>Bases legais.</strong> Exercício regular de direitos e proteção do crédito (LGPD, art. 7º, VI e X), além da execução de contrato.</p>
            <p><strong>Direitos do titular.</strong> Acesso, correção, portabilidade, informação sobre compartilhamento, oposição e eliminação quando aplicável. As solicitações são registradas pela empresa credora e respondidas em até 15 dias.</p>
            <p><strong>Segurança.</strong> Acesso por perfil, isolamento entre empresas, arquivos privados, senhas protegidas por hash e trilha de auditoria.</p>
            <p><strong>Retenção.</strong> Pelo prazo configurado pela empresa (padrão: 60 meses após a quitação) ou pelo exigido em lei.</p>
          </>
        )}
      </div>
    </div>
  );
}
