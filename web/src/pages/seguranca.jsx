import { useState } from 'react';
import QRCode from 'qrcode';
import { auth, sair } from '../api.js';
import { useSessao } from '../sessao.jsx';
import { Marca } from '../layout.jsx';
import { useToast, Spinner, Badge } from '../ui.jsx';
import { baixarArquivo } from '../api.js';

/** Configuração da verificação em duas etapas (TOTP). */
export function Configurar2FA({ aoConcluir }) {
  const toast = useToast();
  const [etapa, setEtapa] = useState('inicio');
  const [dados, setDados] = useState(null);
  const [qr, setQr] = useState('');
  const [codigo, setCodigo] = useState('');
  const [codigos, setCodigos] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const iniciar = async () => {
    setEnviando(true);
    try {
      const d = await auth.iniciar2fa();
      setDados(d);
      setQr(await QRCode.toDataURL(d.otpauth, { margin: 1, width: 220, color: { dark: '#0b2545', light: '#ffffff' } }));
      setEtapa('ler');
    } catch (e) { toast.erro(e); } finally { setEnviando(false); }
  };
  const ativar = async (e) => {
    e.preventDefault();
    setEnviando(true);
    try { const r = await auth.ativar2fa(codigo); setCodigos(r.codigos_recuperacao); setEtapa('codigos'); } catch (err) { toast.erro(err); } finally { setEnviando(false); }
  };
  if (etapa === 'inicio') return (
    <div className="stack">
      <p>A verificação em duas etapas pede, além da senha, um código que muda a cada 30 segundos no seu celular. Use um aplicativo autenticador gratuito (Google Authenticator, Microsoft Authenticator, Authy ou outro).</p>
      <div><button className="btn prim" disabled={enviando} onClick={iniciar}>{enviando && <Spinner />}Configurar agora</button></div>
    </div>
  );
  if (etapa === 'ler') return (
    <form className="stack" onSubmit={ativar}>
      <ol style={{ margin: 0, paddingLeft: 18 }} className="stack">
        <li>No aplicativo autenticador, toque em <strong>adicionar conta</strong> e leia o QR Code:</li>
      </ol>
      <img src={qr} alt="QR Code para o aplicativo autenticador" width="220" height="220" style={{ border: '1px solid var(--borda)', borderRadius: 8 }} />
      <p className="small muted">Não consegue ler? Digite a chave: <code style={{ userSelect: 'all' }}>{dados.segredo}</code></p>
      <div className="campo" style={{ maxWidth: 220 }}><label htmlFor="cod2fa">2. Código mostrado no app</label><input id="cod2fa" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} placeholder="123456" /></div>
      <div><button className="btn prim" disabled={codigo.length !== 6 || enviando}>{enviando && <Spinner />}Ativar</button></div>
    </form>
  );
  return (
    <div className="stack">
      <div className="aviso ok">Verificação em duas etapas ativada.</div>
      <p><strong>Guarde estes códigos de recuperação</strong> em local seguro. Cada um funciona uma única vez, caso você perca o celular.</p>
      <div className="card" style={{ fontFamily: 'ui-monospace, Menlo, monospace', display: 'grid', gridTemplateColumns: 'repeat(2, max-content)', gap: '6px 24px' }}>{codigos.map((c) => <span key={c}>{c}</span>)}</div>
      <div className="row">
        <button className="btn" onClick={() => baixarArquivo('codigos-recuperacao-acorly.txt', `Acorly - códigos de recuperação\n\n${codigos.join('\n')}\n`, 'text/plain')}>Baixar códigos</button>
        <button className="btn prim" onClick={aoConcluir}>Já guardei, continuar</button>
      </div>
    </div>
  );
}

/** Tela de bloqueio: a equipe Acorly precisa ativar o 2FA antes de usar o sistema. */
export function Exigir2FA() {
  const s = useSessao();
  return (
    <div style={{ minHeight: '100%', padding: '32px 16px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }} className="stack">
        <div className="row between"><Marca escura /><button className="btn sm" onClick={() => sair()}>Sair</button></div>
        <div className="card stack">
          <h1>Proteja sua conta</h1>
          <div className="aviso alerta">Por segurança, a equipe Acorly só acessa dados de devedores com a verificação em duas etapas ativa.</div>
          <Configurar2FA aoConcluir={() => s.recarregar()} />
        </div>
      </div>
    </div>
  );
}

export function Seguranca2FA() {
  const s = useSessao();
  const toast = useToast();
  const seg = s.perfil?.seguranca || {};
  const [configurando, setConfigurando] = useState(false);
  const [desativar, setDesativar] = useState({ senha: '', codigo: '' });
  if (seg.metodo === 'email' && !seg.dois_fatores_ativo && !configurando) return (
    <div className="card stack">
      <div className="row between"><h2 style={{ margin: 0 }}>Verificação em duas etapas</h2><Badge status="ATIVA">Código por e-mail</Badge></div>
      <p style={{ margin: 0 }}>A cada entrada no sistema, enviamos um código de 6 dígitos para o seu e-mail. Mantenha o acesso ao seu e-mail protegido.</p>
      <p className="small muted" style={{ margin: 0 }}>Opcional: você também pode usar um aplicativo autenticador no celular. <button className="btn link small" onClick={() => setConfigurando(true)}>Configurar aplicativo</button></p>
    </div>
  );
  if (configurando) return <div className="card stack"><h2>Verificação em duas etapas</h2><Configurar2FA aoConcluir={() => { setConfigurando(false); s.recarregar(); }} /></div>;
  return (
    <div className="card stack">
      <div className="row between"><h2 style={{ margin: 0 }}>Verificação em duas etapas</h2><Badge status={seg.dois_fatores_ativo ? 'ATIVA' : 'PENDENTE'}>{seg.dois_fatores_ativo ? 'Ativa' : 'Desativada'}</Badge></div>
      {seg.dois_fatores_ativo ? (
        <>
          <p className="small muted">Códigos de recuperação restantes: {seg.codigos_recuperacao_restantes}. Se acabarem ou você perder o celular, peça ao administrador um novo link de acesso (ele redefine a senha e o 2FA).</p>
          {!seg.exige_2fa && (
            <form className="row" onSubmit={async (e) => { e.preventDefault(); try { await auth.desativar2fa(desativar.senha, desativar.codigo); toast.ok('Verificação em duas etapas desativada'); s.recarregar(); } catch (err) { toast.erro(err); } }}>
              <input type="password" placeholder="Senha" style={{ maxWidth: 180 }} value={desativar.senha} onChange={(e) => setDesativar({ ...desativar, senha: e.target.value })} aria-label="Senha" />
              <input inputMode="numeric" placeholder="Código do app" style={{ maxWidth: 150 }} value={desativar.codigo} onChange={(e) => setDesativar({ ...desativar, codigo: e.target.value })} aria-label="Código" />
              <button className="btn perigo">Desativar</button>
            </form>
          )}
        </>
      ) : (
        <>
          <p>Recomendado para todos os usuários{seg.exige_2fa ? ' e obrigatório para a equipe Acorly' : ''}.</p>
          <div><button className="btn prim" onClick={() => setConfigurando(true)}>Ativar</button></div>
        </>
      )}
    </div>
  );
}
