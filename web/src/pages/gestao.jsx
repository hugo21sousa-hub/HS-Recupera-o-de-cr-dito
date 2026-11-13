import { useState } from 'react';
import { hs, auth } from '../api.js';
import { useSessao } from '../sessao.jsx';
import { Tabela, Badge, Cabecalho, FormModal, Modal, useApi, useToast, useConfirm, Carregando, ErroCarga, Vazio, Dl, Abas, useExecutar, Campos, useFormulario, Spinner } from '../ui.jsx';
import { brl, data, dataHora, rotulo, mascaraDoc, pct } from '../format.js';
import { JanelaContrato } from '../contrato.jsx';
import { CAMPOS_EMPRESA } from './acesso.jsx';
import { Seguranca2FA } from './seguranca.jsx';
import { TabelaComissao, EditorFaixas } from './comissao.jsx';
import { rotuloFaixa } from '../../../src/core/comissao.js';

export function LinkAcesso({ link, email, onClose, enviado }) {
  const toast = useToast();
  return (
    <Modal titulo="Link de acesso" onClose={onClose} rodape={<button className="btn prim" onClick={onClose}>Concluir</button>}>
      <div className="stack">
        <p>Envie este link para <strong>{email}</strong> (por e-mail, WhatsApp ou outro canal seguro). Com ele, a pessoa define a própria senha. O link vale por 7 dias e só pode ser usado uma vez.</p>
        <div className="row" style={{ flexWrap: 'nowrap' }}><input readOnly value={link} onFocus={(e) => e.target.select()} /><button className="btn" onClick={() => navigator.clipboard.writeText(link).then(() => toast.ok('Link copiado'))}>Copiar</button></div>
        {enviado ? <div className="aviso ok">O link também foi enviado para o e-mail da pessoa.</div> : <div className="aviso info">O envio automático de e-mails não está configurado, por isso o link aparece aqui.</div>}
      </div>
    </Modal>
  );
}

/** Lista e gestão de usuários (empresa ou equipe Acorly interna). */
export function Usuarios({ internos = false }) {
  const s = useSessao();
  const confirmar = useConfirm();
  const { executar } = useExecutar();
  const [novo, setNovo] = useState(false);
  const [editar, setEditar] = useState(null);
  const [link, setLink] = useState(null);
  const [r, setR] = useState(0);
  const perfis = internos ? ['GESTOR_OPERACOES_HS', 'OPERADOR_HS', 'SUPERADMIN_HS'] : ['ADMIN_EMPRESA', 'FINANCEIRO_EMPRESA', 'VISUALIZADOR_EMPRESA'];
  const campos = [
    { nome: 'nome', rotulo: 'Nome', obrigatorio: true }, { nome: 'email', rotulo: 'E-mail', tipo: 'email', obrigatorio: true },
    { nome: 'perfil', rotulo: 'Perfil', tipo: 'select', opcoes: perfis, obrigatorio: true, padrao: perfis[1], semVazio: true },
    ...(internos ? [
      { nome: 'capacidade_casos', rotulo: 'Capacidade de casos (operador)', tipo: 'numero', min: 1, max: 1000, padrao: 50, mostrarSe: (v) => v.perfil === 'OPERADOR_HS' },
      { nome: 'alcada_desconto_bps', rotulo: 'Alçada individual de desconto', tipo: 'percentual', padrao: 1000, mostrarSe: (v) => v.perfil === 'OPERADOR_HS', ajuda: 'Acima disso, a proposta vai ao credor mesmo que esteja no limite dele.' },
    ] : []),
  ];
  const alterarStatus = async (u, status) => {
    const ok = await confirmar({ titulo: status === 'ATIVO' ? 'Reativar usuário' : 'Bloquear usuário', perigo: status !== 'ATIVO', mensagem: status === 'ATIVO' ? `${u.nome} voltará a ter acesso.` : `${u.nome} perde o acesso imediatamente.` });
    if (ok) { await executar('alterarUsuario', { usuario_id: u.id, status }, 'Usuário atualizado'); setR(r + 1); }
  };
  const gerarLink = async (u) => { const x = await executar('gerarLinkAcesso', { usuario_id: u.id }); setLink({ ...x, enviado: x.enviado_por_email }); };
  return (
    <div className="stack">
      <Cabecalho titulo={internos ? 'Equipe interna Acorly' : 'Usuários'} sub={internos ? 'Superadmins, gestores de operações e operadores.' : 'Pessoas da sua empresa com acesso à plataforma.'}>
        <button className="btn prim" onClick={() => setNovo(true)}>Convidar usuário</button>
      </Cabecalho>
      {!internos && <div className="aviso info small">Administrador: acesso completo. Financeiro: dívidas, aprovações e confirmação de pagamentos. Visualizador: somente consulta.</div>}
      <Tabela acao="listarUsuarios" payload={{ internos }} recarregar={r} colunas={[
        { titulo: 'Nome', campo: 'nome' }, { titulo: 'E-mail', campo: 'email' }, { titulo: 'Perfil', render: (u) => rotulo(u.perfil) },
        ...(internos ? [{ titulo: 'Capacidade', num: true, render: (u) => (u.perfil === 'OPERADOR_HS' ? u.capacidade_casos : '—') }] : []),
        { titulo: 'Criado em', render: (u) => dataHora(u.data_criacao) }, { titulo: 'Status', render: (u) => <Badge status={u.status} /> },
        { titulo: '', render: (u) => u.id !== s.usuario.id && <div className="row" style={{ justifyContent: 'flex-end' }}>
          {u.status === 'ATIVO' && <button className="btn sm" onClick={() => gerarLink(u)} title="Para primeiro acesso ou senha esquecida">Link de acesso</button>}
          <button className="btn sm" onClick={() => setEditar(u)}>Editar</button>
          {u.status === 'ATIVO' ? <button className="btn sm perigo" onClick={() => alterarStatus(u, 'BLOQUEADO')}>Bloquear</button> : <button className="btn sm" onClick={() => alterarStatus(u, 'ATIVO')}>Reativar</button>}
        </div> },
      ]} />
      {novo && <FormModal titulo="Convidar usuário" campos={campos} onClose={() => setNovo(false)} botao="Convidar"
        onSubmit={async (v) => { const u = await hs('convidarUsuario', v); setR(r + 1); if (u.convite_link) setLink({ link: u.convite_link, email: u.email, enviado: u.convite_enviado_por_email }); }} />}
      {editar && <FormModal titulo={`Editar ${editar.nome}`} inicial={editar} onClose={() => setEditar(null)} campos={campos.filter((c) => c.nome !== 'email').map((c) => (c.mostrarSe ? { ...c, mostrarSe: () => editar.perfil === 'OPERADOR_HS' } : c))}
        onSubmit={async (v) => { await hs('alterarUsuario', { usuario_id: editar.id, ...v, perfil: v.perfil !== editar.perfil ? v.perfil : undefined }); setR(r + 1); }} />}
      {link && <LinkAcesso link={link.link} email={link.email} enviado={link.enviado} onClose={() => setLink(null)} />}
    </div>
  );
}

export function Contratos() {
  const s = useSessao();
  const confirmar = useConfirm();
  const { executar } = useExecutar();
  const [r, setR] = useState(0);
  const [ver, setVer] = useState(null);
  const encerrar = async (c) => {
    const ok = await confirmar({ titulo: 'Encerrar contrato', perigo: true, pedirMotivo: true, botao: 'Encerrar', mensagem: 'Os casos em andamento neste contrato serão suspensos.' });
    if (ok) { await executar('encerrarContrato', { contrato_id: c.id, motivo: ok.motivo }, 'Contrato encerrado'); setR(r + 1); }
  };
  return (
    <div className="stack">
      <Cabecalho titulo="Contratos" sub="Contratos de cobrança gerenciada com o Acorly. A assinatura da plataforma fica em Assinatura." />
      <Tabela acao="listarContratos" busca={false} recarregar={r} colunas={[
        { titulo: 'Modalidade', render: (c) => rotulo(c.modalidade) }, { titulo: 'Escopo', render: (c) => rotulo(c.tipo_carteira) },
        { titulo: 'Valor do serviço', num: true, render: (c) => (c.status === 'SOLICITADO' ? 'Aguardando proposta' : brl(c.valor_contratado_centavos)) },
        { titulo: 'Casos', num: true, render: (c) => c.quantidade_casos_contratada || '—' },
        { titulo: 'Comissão', render: (c) => (c.comissao_faixas?.length ? c.comissao_faixas.map((f) => pct(f.bps)).join(' / ') : 'Tabela padrão') },
        { titulo: 'Vigência', render: (c) => (c.data_inicio ? `${data(c.data_inicio)} a ${data(c.data_fim)}` : '—') },
        { titulo: 'Aceite', render: (c) => (c.aceite ? dataHora(c.data_aceite) : '—') }, { titulo: 'Status', render: (c) => <Badge status={c.status} /> },
        { titulo: '', render: (c) => <div className="row" style={{ justifyContent: 'flex-end' }}>
          {c.status === 'PROPOSTO' && s.pode('contrato.contratar') && <button className="btn sm prim" onClick={() => setVer({ c, aceitar: true })}>Ler e aceitar</button>}
          {c.status !== 'SOLICITADO' && c.status !== 'PROPOSTO' && <button className="btn sm" onClick={() => setVer({ c })}>Ver contrato</button>}
          {c.status === 'ATIVO' && s.pode('contrato.contratar') && <button className="btn sm perigo" onClick={() => encerrar(c)}>Encerrar</button>}
        </div> },
      ]} vazio={<Vazio titulo="Nenhum contrato">Para contratar a cobrança do Acorly, escolha essa opção em Configurações › Serviço, ou fale com o Acorly.</Vazio>} />
      {ver && <JanelaContrato contrato={ver.c} aceitar={ver.aceitar && s.pode('contrato.contratar')} onClose={() => setVer(null)} onAceito={() => { setR(r + 1); s.recarregar(); }} />}
    </div>
  );
}

export function Assinatura() {
  const s = useSessao();
  const confirmar = useConfirm();
  const { executar, enviando } = useExecutar();
  const { data: d, carregando, erro, recarregar } = useApi('minhaAssinatura', {});
  const assinar = async (p) => {
    const ok = await confirmar({ titulo: `Assinar ${p.nome}`, botao: 'Gerar fatura', mensagem: `A cobrança de ${brl(p.preco_mensal_centavos)}/mês será feita pelo Asaas (Pix, boleto ou cartão). O plano é ativado assim que o pagamento for confirmado.` });
    if (!ok) return;
    const r = await executar('assinarPlano', { plano_id: p.id }, 'Fatura gerada');
    recarregar();
    if (r.fatura_url) window.open(r.fatura_url, '_blank', 'noopener');
  };
  const planos = useApi('listarPlanos', {});
  if (erro) return <ErroCarga erro={erro} onRetry={recarregar} />;
  if (carregando && !d) return <Carregando />;
  return (
    <div className="stack">
      <Cabecalho titulo="Assinatura" sub="Plano da plataforma. Não há comissão sobre valores recuperados." />
      <div className="card">
        {d.atual ? <Dl itens={[['Plano', d.plano?.nome], ['Valor mensal', brl(d.atual.valor_contratado_centavos)], ['Início', data(d.atual.data_inicio)], ['Vencimento', data(d.atual.data_vencimento)], ['Limites', `${d.plano?.limite_devedores || '∞'} devedores · ${d.plano?.limite_usuarios || '∞'} usuários`], ['Status', <Badge key="s" status={d.atual.status} />]]} />
          : d.acesso?.modo === 'TESTE'
            ? <Vazio titulo={`Teste grátis até ${data(d.acesso.teste_ate)}`}>Você está usando o Acorly de graça por {d.acesso.dias_teste} dias, com todos os recursos{d.acesso.limites?.devedores ? ` e até ${d.acesso.limites.devedores} devedores` : ''}. Escolha um plano abaixo para continuar depois do teste.</Vazio>
            : <Vazio titulo="Nenhuma assinatura ativa">{d.acesso?.modo === 'SOMENTE_LEITURA' ? 'O teste grátis terminou e o acesso está somente para consulta. Escolha um plano abaixo para voltar a cadastrar e editar.' : 'Escolha um plano abaixo para ativar.'}</Vazio>}
      </div>
      <div className="grid g4">
        {(planos.data || []).map((p) => (
          <div key={p.id} className="card stack" style={d.plano?.id === p.id ? { borderColor: 'var(--azul)', borderWidth: 2 } : undefined}>
            <div className="row between"><h2 style={{ margin: 0 }}>{p.nome}</h2>{d.plano?.id === p.id && <Badge status="ATIVO">Seu plano</Badge>}</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{brl(p.preco_mensal_centavos)}<span className="small muted">/mês</span></div>
            <div className="small">{p.limite_devedores ? `Até ${p.limite_devedores} devedores` : 'Devedores ilimitados'} · {p.limite_usuarios ? `${p.limite_usuarios} usuários` : 'usuários ilimitados'}</div>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{(p.funcionalidades || []).map((f) => <li key={f}>{rotulo(f)}</li>)}</ul>
            {d.gateway === 'ASAAS' && s.pode('assinatura.gerenciar_propria') && d.plano?.id !== p.id && <button className="btn prim" disabled={enviando} onClick={() => assinar(p)}>{d.atual ? 'Mudar para este plano' : 'Assinar'}</button>}
          </div>
        ))}
      </div>
      {d.pendente && <div className="aviso alerta row between"><span>Fatura do plano <strong>{d.plano_pendente?.nome}</strong> aguardando pagamento.</span>{d.pendente.fatura_url && <a className="btn sm prim" href={d.pendente.fatura_url} target="_blank" rel="noreferrer">Pagar fatura</a>}</div>}
      {d.atual?.status === 'INADIMPLENTE' && <div className="aviso critico row between"><span>Há uma fatura da assinatura em atraso.</span>{d.atual.fatura_url && <a className="btn sm" href={d.atual.fatura_url} target="_blank" rel="noreferrer">Pagar agora</a>}</div>}
      {d.gateway !== 'ASAAS' && <div className="aviso info">O pagamento online da assinatura não está configurado. Para contratar ou mudar de plano, fale com o Acorly.</div>}
    </div>
  );
}

function DadosEmpresa() {
  const s = useSessao();
  const toast = useToast();
  const f = useFormulario(CAMPOS_EMPRESA.filter((c) => c.nome !== 'cnpj'), s.empresa || {});
  const [enviando, setEnviando] = useState(false);
  const pode = s.pode('empresa.editar');
  const salvar = async (e) => {
    e.preventDefault();
    const d = f.validar();
    if (!d) return;
    setEnviando(true);
    try { await hs('atualizarEmpresa', d); await s.recarregar(); toast.ok('Dados atualizados'); } catch (err) { toast.erro(err); } finally { setEnviando(false); }
  };
  return (
    <form className="stack" onSubmit={salvar}>
      <Dl itens={[['CNPJ', mascaraDoc(s.empresa?.cnpj)], ['Situação', <Badge key="s" status={s.empresa?.status} />], ['Serviço escolhido', rotulo(s.empresa?.modalidade_servico)], ['Termos aceitos em', dataHora(s.empresa?.aceite_termos_em)]]} />
      <fieldset disabled={!pode} style={{ border: 0, padding: 0, margin: 0 }}><Campos campos={CAMPOS_EMPRESA.filter((c) => c.nome !== 'cnpj')} valores={f.valores} setValores={f.setValores} erros={f.erros} /></fieldset>
      {pode && <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn prim" disabled={enviando}>{enviando && <Spinner />}Salvar</button></div>}
    </form>
  );
}

function Servico() {
  const s = useSessao();
  const { executar } = useExecutar();
  const [tipo, setTipo] = useState('CARTEIRA_SELECIONADA');
  const pedir = async (modalidade_servico) => { await executar('escolherServico', { modalidade_servico, tipo_carteira: modalidade_servico === 'PLATAFORMA' ? undefined : tipo }, 'Solicitação registrada'); s.recarregar(); };
  return (
    <div className="stack">
      <p>Serviço atual: <strong>{rotulo(s.empresa?.modalidade_servico)}</strong></p>
      {s.pode('empresa.editar') && s.empresa?.modalidade_servico === 'PLATAFORMA' && (
        <div className="card stack">
          <h3>Contratar também a cobrança do Acorly</h3>
          <label className="check"><input type="radio" checked={tipo === 'CARTEIRA_SELECIONADA'} onChange={() => setTipo('CARTEIRA_SELECIONADA')} />Por carteira selecionada</label>
          <label className="check"><input type="radio" checked={tipo === 'TODOS_ELEGIVEIS'} onChange={() => setTipo('TODOS_ELEGIVEIS')} />Todos os devedores elegíveis</label>
          <div><button className="btn prim" onClick={() => pedir('AMBOS')}>Solicitar proposta ao Acorly</button></div>
        </div>
      )}
      <p className="small muted">Casos já encaminhados ao Acorly seguem as regras do contrato; para retirar uma dívida, use "Retirar do Acorly" na tela da dívida.</p>
    </div>
  );
}

function Privacidade() {
  const toast = useToast();
  const s = useSessao();
  const { data: cfg, carregando } = useApi('obterConfiguracoes', {});
  if (carregando && !cfg) return <Carregando />;
  return <PrivacidadeForm cfg={cfg} pode={s.pode('empresa.editar')} toast={toast} />;
}
function PrivacidadeForm({ cfg, pode, toast }) {
  const campos = [
    { nome: 'retencao_meses_apos_quitacao', rotulo: 'Retenção após quitação (meses)', tipo: 'numero', min: 0, max: 240, obrigatorio: true },
    { nome: 'exigir_documento_hs', tipo: 'checkbox', textoCheck: 'Exigir documento anexado para encaminhar dívidas ao Acorly', full: true },
    { nome: 'encarregado_dpo_nome', rotulo: 'Encarregado de dados (DPO)' }, { nome: 'encarregado_dpo_email', rotulo: 'E-mail do encarregado', tipo: 'email' },
  ];
  const f = useFormulario(campos, cfg);
  const salvar = async () => { const d = f.validar(); if (!d) return; try { await hs('salvarPoliticaRetencao', d); toast.ok('Configurações salvas'); } catch (e) { toast.erro(e); } };
  return (
    <div className="stack">
      <fieldset disabled={!pode} style={{ border: 0, padding: 0, margin: 0 }}><Campos campos={campos} valores={f.valores} setValores={f.setValores} erros={f.erros} /></fieldset>
      {pode && <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn prim" onClick={salvar}>Salvar</button></div>}
    </div>
  );
}

function SolicitacoesTitular() {
  const [nova, setNova] = useState(false);
  const [responder, setResponder] = useState(null);
  const [r, setR] = useState(0);
  const devedores = useApi('listarDevedores', { pageSize: 200 });
  return (
    <div className="stack">
      <div className="row between"><p className="muted" style={{ margin: 0 }}>Pedidos de acesso, correção, eliminação e outros direitos (LGPD, art. 18). Prazo de resposta: 15 dias.</p><button className="btn prim" onClick={() => setNova(true)}>Registrar solicitação</button></div>
      <Tabela acao="listarSolicitacoesTitular" busca={false} recarregar={r} colunas={[
        { titulo: 'Abertura', render: (x) => dataHora(x.data_abertura) }, { titulo: 'Titular', render: (x) => (devedores.data?.itens || []).find((d) => d.id === x.devedor_id)?.nome || '—' },
        { titulo: 'Tipo', render: (x) => rotulo(x.tipo) }, { titulo: 'Prazo', render: (x) => data(x.prazo_resposta) }, { titulo: 'Status', render: (x) => <Badge status={x.status} /> },
        { titulo: '', render: (x) => x.status !== 'CONCLUIDA' && <button className="btn sm" onClick={() => setResponder(x)}>Responder</button> },
      ]} vazio={<Vazio titulo="Nenhuma solicitação registrada" />} />
      {nova && <FormModal titulo="Registrar solicitação do titular" onClose={() => setNova(false)} campos={[
        { nome: 'devedor_id', rotulo: 'Titular', tipo: 'select', obrigatorio: true, full: true, opcoes: (devedores.data?.itens || []).map((d) => ({ valor: d.id, rotulo: `${d.nome} · ${mascaraDoc(d.cpf_cnpj)}` })) },
        { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', obrigatorio: true, opcoes: ['ACESSO', 'CORRECAO', 'ELIMINACAO', 'PORTABILIDADE', 'INFORMACAO_COMPARTILHAMENTO', 'OPOSICAO', 'REVOGACAO_CONSENTIMENTO'] },
        { nome: 'canal', rotulo: 'Recebida por', tipo: 'select', opcoes: ['EMAIL', 'TELEFONE', 'WHATSAPP', 'CARTA', 'PRESENCIAL'], padrao: 'EMAIL', semVazio: true },
        { nome: 'descricao', rotulo: 'Descrição', tipo: 'textarea' },
      ]} onSubmit={async (v) => { await hs('registrarSolicitacaoTitular', v); setR(r + 1); }} />}
      {responder && <FormModal titulo="Responder solicitação" onClose={() => setResponder(null)} campos={[
        { nome: 'status', rotulo: 'Situação', tipo: 'select', opcoes: ['EM_ANALISE', 'CONCLUIDA', 'NEGADA_FUNDAMENTADA'], padrao: 'CONCLUIDA', semVazio: true },
        { nome: 'resposta', rotulo: 'Resposta enviada ao titular', tipo: 'textarea', obrigatorio: true },
      ]} aviso={<div className="aviso info">Exportação, correção e anonimização são feitas na tela do devedor.</div>} onSubmit={async (v) => { await hs('responderSolicitacaoTitular', { solicitacao_id: responder.id, ...v }); setR(r + 1); }} />}
    </div>
  );
}

export function Modelos({ global = false }) {
  const [editar, setEditar] = useState(null);
  const { data: lista, recarregar, carregando } = useApi('listarModelosMensagem', {});
  const s = useSessao();
  const meus = (lista || []).filter((m) => (global ? !m.empresa_id : m.empresa_id === s.usuario?.empresa_id || !m.empresa_id));
  const pode = global ? s.pode('config.sistema') : s.pode('empresa.editar');
  return (
    <div className="stack">
      {global && <Cabecalho titulo="Modelos de mensagem" sub="Modelos globais, disponíveis para todos os casos Acorly." />}
      <div className="row between"><p className="muted small" style={{ margin: 0 }}>Variáveis: {'{{nome}} {{credor}} {{valor}} {{vencimento}}'}. Textos com ameaça ou exposição são recusados.</p>{pode && <button className="btn prim" onClick={() => setEditar({})}>Novo modelo</button>}</div>
      {carregando && !lista ? <Carregando /> : meus.length ? (
        <div className="grid g2">{meus.map((m) => (
          <div key={m.id} className="card stack">
            <div className="row between"><strong>{m.nome}</strong><div className="row">{m.aprovado_meta && <Badge status="ATIVA">Aprovado na Meta</Badge>}<Badge status="info">{rotulo(m.canal)}</Badge>{!m.empresa_id && !global && <Badge status="info">Acorly</Badge>}</div></div>
            {m.canal === 'EMAIL' && m.assunto && <div className="small"><strong>Assunto:</strong> {m.assunto}</div>}
            <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{m.conteudo}</div>
            {pode && (global ? !m.empresa_id : !!m.empresa_id) && <div><button className="btn sm" onClick={() => setEditar(m)}>Editar</button></div>}
          </div>
        ))}</div>
      ) : <Vazio titulo="Nenhum modelo" />}
      {editar && <FormModal titulo={editar.id ? 'Editar modelo' : 'Novo modelo'} inicial={editar} onClose={() => setEditar(null)} campos={[
        { nome: 'nome', rotulo: 'Nome', obrigatorio: true }, { nome: 'canal', rotulo: 'Canal', tipo: 'select', opcoes: ['WHATSAPP', 'EMAIL', 'SMS'], padrao: 'WHATSAPP', semVazio: true },
        { nome: 'assunto', rotulo: 'Assunto do e-mail', full: true, mostrarSe: (v) => v.canal === 'EMAIL', padrao: 'Pendência financeira com {{credor}}' },
        { nome: 'conteudo', rotulo: 'Texto', tipo: 'textarea', obrigatorio: true, padrao: 'Olá, {{nome}}! Aqui é da equipe de relacionamento da {{credor}}. Identificamos um valor em aberto de {{valor}}, vencido em {{vencimento}}. Podemos conversar sobre uma condição para regularizar?' },
        { nome: 'status', rotulo: 'Status', tipo: 'select', opcoes: ['ATIVO', 'INATIVO'], padrao: 'ATIVO', semVazio: true },
        ...(global ? [
          { nome: 'nome_template_meta', rotulo: 'Nome do modelo aprovado na Meta (opcional)', ajuda: 'Preencha só se este texto foi aprovado como modelo no WhatsApp Business. As variáveis viram os parâmetros {{1}}, {{2}}… na ordem em que aparecem.' },
          { nome: 'idioma_template', rotulo: 'Idioma do modelo', padrao: 'pt_BR' },
        ] : []),
      ]} onSubmit={async (v) => { await hs('salvarModeloMensagem', { ...v, id: editar.id }); recarregar(); }} />}
    </div>
  );
}

export function Integracoes() {
  const { data: d, carregando } = useApi('statusIntegracoes', {});
  if (carregando && !d) return <Carregando />;
  const itens = [
    ['WhatsApp Business Platform', d.whatsapp_business_api, 'Envio pela API oficial da Meta (modelos aprovados e respostas em até 24 h) e recebimento automático das respostas nos casos Acorly. Quando inativo, o envio é manual pelo link do WhatsApp.'],
    ['E-mail transacional', d.email_transacional, 'Convites, redefinição de senha e notificações por e-mail. Quando inativo, os links de acesso são copiados pelo administrador.'],
    ['Pagamento da assinatura (Asaas)', d.gateway_assinatura, 'Cobrança mensal da assinatura por Pix, boleto ou cartão. Nunca recebe valores de devedores.'],
    ['Assistente de IA', d.assistente_ia, 'Resumo de histórico e sugestões de mensagem (etapa futura).'],
  ];
  return <div className="grid g2">{itens.map(([n, st, desc]) => <div key={n} className="card stack"><div className="row between"><strong>{n}</strong><Badge status={String(st).startsWith('ATIVA') ? 'ATIVA' : 'INATIVO'}>{String(st).startsWith('ATIVA') ? 'Ativa' : 'Indisponível'}</Badge></div><span className="small muted">{desc}</span></div>)}</div>;
}

export function Configuracoes() {
  const s = useSessao();
  const [aba, setAba] = useState('empresa');
  return (
    <div className="stack">
      <Cabecalho titulo="Configurações" />
      <div className="card">
        <Abas ativa={aba} onChange={setAba} abas={[
          { id: 'empresa', rotulo: 'Dados da empresa' }, { id: 'servico', rotulo: 'Serviço' }, { id: 'privacidade', rotulo: 'Privacidade e retenção' },
          ...(s.pode('lgpd.atender') ? [{ id: 'titulares', rotulo: 'Solicitações de titulares' }] : []),
          { id: 'modelos', rotulo: 'Modelos de mensagem' }, { id: 'integracoes', rotulo: 'Integrações' },
        ]} />
        {aba === 'empresa' && <DadosEmpresa />}
        {aba === 'servico' && <Servico />}
        {aba === 'privacidade' && <Privacidade />}
        {aba === 'titulares' && <SolicitacoesTitular />}
        {aba === 'modelos' && <Modelos />}
        {aba === 'integracoes' && <Integracoes />}
      </div>
    </div>
  );
}

export function MinhaConta() {
  const s = useSessao();
  const toast = useToast();
  const campos = [
    { nome: 'atual', rotulo: 'Senha atual', tipo: 'senha', obrigatorio: true, autoComplete: 'current-password' },
    { nome: 'nova', rotulo: 'Nova senha', tipo: 'senha', obrigatorio: true, autoComplete: 'new-password', ajuda: 'Mínimo de 8 caracteres, com letras e números.' },
    { nome: 'confirmar', rotulo: 'Confirme a nova senha', tipo: 'senha', obrigatorio: true, validar: (v, all) => (v !== all.nova ? 'As senhas não conferem' : null) },
  ];
  const f = useFormulario(campos);
  const salvar = async (e) => { e.preventDefault(); const d = f.validar(); if (!d) return; try { await auth.trocarSenha(d.atual, d.nova); toast.ok('Senha alterada. Outras sessões foram encerradas.'); f.setValores({ atual: '', nova: '', confirmar: '' }); } catch (err) { toast.erro(err); } };
  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <Cabecalho titulo="Minha conta" />
      <div className="card"><Dl itens={[['Nome', s.usuario?.nome], ['E-mail', s.usuario?.email], ['Perfil', rotulo(s.usuario?.perfil)]]} /></div>
      <Seguranca2FA />
      <form className="card stack" onSubmit={salvar}><h2>Alterar senha</h2><Campos campos={campos.map((c) => ({ ...c, full: true }))} valores={f.valores} setValores={f.setValores} erros={f.erros} /><div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn prim">Alterar senha</button></div></form>
    </div>
  );
}
