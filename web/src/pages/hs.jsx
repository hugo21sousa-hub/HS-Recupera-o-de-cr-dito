import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { hs } from '../api.js';
import { useSessao } from '../sessao.jsx';
import { Tabela, Badge, Cabecalho, FormModal, Modal, useApi, useToast, useConfirm, Vazio, Dl, useExecutar, Stat } from '../ui.jsx';
import { brl, data, dataHora, rotulo, mascaraDoc, pct, hojeISO } from '../format.js';
import { colunasCaso, ListaCasos } from './cobranca.jsx';
import { EditorFaixas, TabelaComissao } from './comissao.jsx';

const STATUS_EMPRESA = ['CADASTRO_INCOMPLETO', 'AGUARDANDO_VALIDACAO', 'ATIVA', 'SUSPENSA', 'CANCELADA'];

function DetalheEmpresa({ empresa: e, onClose, onFeito }) {
  const { executar } = useExecutar();
  const confirmar = useConfirm();
  const usuarios = useApi('listarUsuarios', { empresa_id: e.id, pageSize: 50 });
  const contratos = useApi('listarContratos', { filtros: { empresa_id: e.id } });
  const ass = useApi('minhaAssinatura', { empresa_id: e.id });
  const mudar = async (status) => {
    const r = await confirmar({ titulo: `Alterar empresa para ${rotulo(status)}`, pedirMotivo: true, perigo: status !== 'ATIVA', mensagem: status === 'ATIVA' ? 'A empresa poderá encaminhar cobranças ao Acorly.' : 'Os usuários da empresa terão o acesso limitado.' });
    if (r) { await executar('alterarStatusEmpresa', { empresa_id: e.id, status, motivo: r.motivo }, 'Status atualizado'); onFeito(); onClose(); }
  };
  return (
    <Modal titulo={e.razao_social} onClose={onClose} grande rodape={<>
      {e.status !== 'ATIVA' && <button className="btn ok" onClick={() => mudar('ATIVA')}>Validar e ativar</button>}
      {e.status === 'ATIVA' && <button className="btn perigo" onClick={() => mudar('SUSPENSA')}>Suspender</button>}
      {e.status !== 'CANCELADA' && <button className="btn perigo" onClick={() => mudar('CANCELADA')}>Cancelar</button>}
    </>}>
      <div className="stack">
        <div className="aviso info small">Acesso administrativo: consultas a dados desta empresa ficam registradas na auditoria.</div>
        <Dl itens={[['Nome fantasia', e.nome_fantasia], ['CNPJ', mascaraDoc(e.cnpj)], ['E-mail', e.email], ['Telefone', e.telefone], ['Endereço', e.endereco], ['Responsável legal', e.responsavel_legal], ['Contato', [e.contato_nome, e.contato_telefone, e.contato_email].filter(Boolean).join(' · ') || '—'], ['Serviço', rotulo(e.modalidade_servico)], ['Cadastro', dataHora(e.data_cadastro)], ['Status', <Badge key="s" status={e.status} />], ['Último motivo', e.motivo_status || '—']]} />
        <h3>Usuários</h3>
        <table><tbody>{(usuarios.data?.itens || []).map((u) => <tr key={u.id}><td>{u.nome}</td><td>{u.email}</td><td>{rotulo(u.perfil)}</td><td><Badge status={u.status} /></td></tr>)}</tbody></table>
        <h3>Assinatura</h3>
        <p>{ass.data?.atual ? `${ass.data.plano?.nome} · ${brl(ass.data.atual.valor_contratado_centavos)} · vence ${data(ass.data.atual.data_vencimento)}` : 'Sem assinatura ativa'}</p>
        <h3>Contratos de cobrança</h3>
        {(contratos.data?.itens || []).length ? <table><tbody>{contratos.data.itens.map((c) => <tr key={c.id}><td>{rotulo(c.modalidade)}</td><td>{brl(c.valor_contratado_centavos)}</td><td><Badge status={c.status} /></td></tr>)}</tbody></table> : <p className="muted">Nenhum</p>}
      </div>
    </Modal>
  );
}

export function Empresas() {
  const [sel, setSel] = useState(null);
  const [r, setR] = useState(0);
  return (
    <div className="stack">
      <Cabecalho titulo="Empresas" sub="Todas as empresas cadastradas. Valide cadastros novos e gerencie a situação de cada uma." />
      <Tabela acao="listarEmpresas" recarregar={r} filtros={[{ nome: 'status', rotulo: 'Status', opcoes: STATUS_EMPRESA }, { nome: 'modalidade_servico', rotulo: 'Serviço', opcoes: ['PLATAFORMA', 'HS_GERENCIADA', 'AMBOS'] }]} colunas={[
        { titulo: 'Razão social', render: (e) => <button className="btn link" onClick={() => setSel(e)}>{e.razao_social}</button> },
        { titulo: 'CNPJ', render: (e) => mascaraDoc(e.cnpj) }, { titulo: 'Serviço', render: (e) => rotulo(e.modalidade_servico) },
        { titulo: 'Cadastro', render: (e) => data(e.data_cadastro) }, { titulo: 'Status', render: (e) => <Badge status={e.status} /> },
      ]} vazio={<Vazio titulo="Nenhuma empresa cadastrada" />} />
      {sel && <DetalheEmpresa empresa={sel} onClose={() => setSel(null)} onFeito={() => setR(r + 1)} />}
    </div>
  );
}

export function EmpresasAtendidas() {
  return (
    <div className="stack">
      <Cabecalho titulo="Empresas atendidas" sub="Empresas com contrato de cobrança gerenciada ativo." />
      <Tabela acao="listarEmpresasAtendidas" busca={false} colunas={[{ titulo: 'Empresa', render: (e) => e.nome_fantasia || e.razao_social }, { titulo: 'Contratos ativos', num: true, campo: 'contratos' }, { titulo: 'Status', render: (e) => <Badge status={e.status} /> }]} vazio={<Vazio titulo="Nenhuma empresa com contrato ativo" />} />
    </div>
  );
}

export function CarteirasRecebidas() {
  return (
    <div className="stack">
      <Cabecalho titulo="Carteiras recebidas" sub="Lotes encaminhados pelas empresas para cobrança gerenciada." />
      <Tabela acao="listarCarteirasRecebidas" colunas={[
        { titulo: 'Credor', campo: 'credor' }, { titulo: 'Carteira', campo: 'nome' }, { titulo: 'Dívidas', num: true, campo: 'quantidade_dividas' },
        { titulo: 'Valor total', num: true, render: (c) => brl(c.valor_total_centavos) }, { titulo: 'Recebida em', render: (c) => dataHora(c.updated_date || c.data_criacao) }, { titulo: 'Status', render: (c) => <Badge status={c.status} /> },
      ]} vazio={<Vazio titulo="Nenhuma carteira recebida" />} />
    </div>
  );
}

export function Validacao() {
  const [sel, setSel] = useState([]);
  const [r, setR] = useState(0);
  const confirmar = useConfirm();
  const toast = useToast();
  const decidir = async (aprovado) => {
    const ok = await confirmar(aprovado
      ? { titulo: `Aprovar ${sel.length} caso(s)`, mensagem: 'O sistema revalida dados, documentos e autorização. Aprovados entram na fila de distribuição.' }
      : { titulo: `Devolver ${sel.length} caso(s)`, pedirMotivo: true, perigo: true, botao: 'Devolver ao credor', mensagem: 'O credor será notificado para corrigir as informações.' });
    if (!ok) return;
    try {
      const x = await hs('validarCaso', { caso_ids: sel, aprovado, motivo: ok.motivo });
      toast.ok(`${x.aprovados} aprovado(s), ${x.reprovados} devolvido(s)`);
      x.erros.forEach((e) => toast.erro(new Error(e.erro)));
      setSel([]); setR(r + 1);
    } catch (e) { toast.erro(e); }
  };
  return (
    <div className="stack">
      <Cabecalho titulo="Aguardando validação" sub="Nenhum caso entra na fila sem validação e autorização.">
        <button className="btn ok" disabled={!sel.length} onClick={() => decidir(true)}>Aprovar selecionados</button>
        <button className="btn perigo" disabled={!sel.length} onClick={() => decidir(false)}>Devolver selecionados</button>
      </Cabecalho>
      <Tabela acao="listarCasos" payload={{ escopo: 'validacao' }} busca={false} recarregar={r} colunas={colunasCaso({ credor: true, selecao: { sel, set: setSel } })} vazio={<Vazio titulo="Nada aguardando validação" />} />
    </div>
  );
}

export function Distribuicao() {
  const toast = useToast();
  const [r, setR] = useState(0);
  const { executar } = useExecutar();
  const ops = useApi('listarOperadores', {}, [r]);
  const ativos = (ops.data || []).filter((o) => o.status === 'ATIVO');
  return (
    <div className="stack">
      <Cabecalho titulo="Aguardando distribuição" sub="Atribua manualmente ou distribua pela capacidade de cada operador.">
        <button className="btn prim" onClick={async () => { const x = await executar('distribuirAutomatico', {}); toast.ok(`${x.atribuidos} caso(s) distribuído(s); ${x.restantes_na_fila} na fila`); setR(r + 1); }}>Distribuir automaticamente</button>
      </Cabecalho>
      <div className="grid g4">{ativos.map((o) => <Stat key={o.id} rotulo={o.nome} valor={`${o.carga_atual}/${o.capacidade_casos}`} tom={o.carga_atual >= o.capacidade_casos ? 'critico' : ''} ajuda="casos ativos / capacidade" />)}</div>
      <Tabela acao="listarCasos" payload={{ escopo: 'fila' }} busca={false} recarregar={r} colunas={[...colunasCaso({ credor: true }), { titulo: 'Atribuir', render: (c) => (
        <select style={{ width: 'auto' }} value="" aria-label="Atribuir a operador" onChange={async (e) => { if (!e.target.value) return; const o = ativos.find((x) => x.id === e.target.value); await executar('atribuirCaso', { caso_id: c.id, operador_id: o.id, forcar: o.carga_atual >= o.capacidade_casos }, `Atribuído a ${o.nome}`); setR(r + 1); }}>
          <option value="">Escolher…</option>{ativos.map((o) => <option key={o.id} value={o.id}>{o.nome} ({o.carga_atual}/{o.capacidade_casos})</option>)}
        </select>
      ) }]} vazio={<Vazio titulo="Fila vazia" />} />
    </div>
  );
}

export function MeusCasos() {
  const s = useSessao();
  const toast = useToast();
  const nav = useNavigate();
  const { executar } = useExecutar();
  return (
    <ListaCasos titulo="Meus casos" sub="Sua fila de trabalho. Priorize próximas tarefas vencidas e casos de prioridade alta." payload={{ escopo: s.pode('caso.ler_atribuidos') ? 'todos' : 'meus', ordenarPor: 'proxima_atividade', ordem: 'asc' }} credor
      acoes={s.pode('caso.puxar_fila') && <button className="btn prim" onClick={async () => { const r = await executar('puxarProximoCaso', {}); if (r.caso) nav(`/casos/${r.caso.id}`); else toast.info('A fila está vazia no momento.'); }}>Pegar próximo caso da fila</button>} />
  );
}

export function TodosCasos() {
  const ops = useApi('listarOperadores', {});
  const emp = useApi('listarEmpresasAtendidas', {});
  return <ListaCasos titulo="Todos os casos autorizados" sub="Casos de cobrança gerenciada de todas as empresas atendidas." credor filtrosExtra={[
    { nome: 'operador_id', rotulo: 'Operador', opcoes: (ops.data || []).map((o) => ({ valor: o.id, rotulo: o.nome })) },
    { nome: 'empresa_id', rotulo: 'Empresa', opcoes: (emp.data || []).map((e) => ({ valor: e.id, rotulo: e.nome_fantasia || e.razao_social })) },
  ]} />;
}

export function Interacoes() {
  return (
    <div className="stack">
      <Cabecalho titulo="Interações" sub="Contatos e respostas registrados nos casos que você pode acessar." />
      <Tabela acao="listarInteracoes" busca={false} colunas={[
        { titulo: 'Data', render: (i) => dataHora(i.data_hora) }, { titulo: 'Credor', campo: 'credor' }, { titulo: 'Devedor', render: (i) => <Link to={`/casos/${i.caso_id}`}>{i.devedor_nome}</Link> },
        { titulo: 'Canal', render: (i) => rotulo(i.canal) }, { titulo: 'Tipo', render: (i) => rotulo(i.tipo_interacao) }, { titulo: 'Resultado', render: (i) => rotulo(i.resultado) },
        { titulo: 'Mensagem', render: (i) => <span className="small">{(i.mensagem || i.resposta || '').slice(0, 90)}</span> },
      ]} vazio={<Vazio titulo="Nenhuma interação" />} />
    </div>
  );
}

export function Tarefas() {
  const [st, setSt] = useState('PENDENTE');
  const [r, setR] = useState(0);
  const { executar } = useExecutar();
  return (
    <div className="stack">
      <Cabecalho titulo="Tarefas" sub="Retornos e acompanhamentos agendados.">
        <select style={{ width: 'auto' }} value={st} onChange={(e) => setSt(e.target.value)} aria-label="Status"><option value="PENDENTE">Pendentes</option><option value="CONCLUIDA">Concluídas</option><option value="CANCELADA">Canceladas</option></select>
      </Cabecalho>
      <Tabela key={st} acao="listarTarefas" payload={{ status: st }} busca={false} recarregar={r} colunas={[
        { titulo: 'Prazo', render: (t) => <span style={{ color: t.status === 'PENDENTE' && t.data_prazo < hojeISO() ? 'var(--critico)' : undefined, fontWeight: 600 }}>{data(t.data_prazo)}</span> },
        { titulo: 'Devedor', render: (t) => <Link to={`/casos/${t.caso_id}`}>{t.devedor_nome}</Link> }, { titulo: 'Credor', campo: 'credor' },
        { titulo: 'Descrição', campo: 'descricao' }, { titulo: 'Prioridade', render: (t) => rotulo(t.prioridade) },
        { titulo: '', render: (t) => t.status === 'PENDENTE' && <button className="btn sm" onClick={async () => { await executar('concluirTarefa', { tarefa_id: t.id }, 'Tarefa concluída'); setR(r + 1); }}>Concluir</button> },
      ]} vazio={<Vazio titulo="Nenhuma tarefa" />} />
    </div>
  );
}

export function Operadores() {
  const s = useSessao();
  const [editar, setEditar] = useState(null);
  const { data: ops, recarregar } = useApi('listarOperadores', {});
  return (
    <div className="stack">
      <Cabecalho titulo="Operadores" sub="Carga atual, capacidade e produtividade no mês.">{s.pode('usuario.gerenciar_interno') && <Link className="btn" to="/hs/equipe">Gerenciar equipe</Link>}</Cabecalho>
      <div className="card p0"><div className="tabela-wrap"><table>
        <thead><tr><th>Operador</th><th>E-mail</th><th className="num">Casos ativos</th><th className="num">Capacidade</th><th className="num">Interações no mês</th><th>Status</th><th></th></tr></thead>
        <tbody>{(ops || []).map((o) => <tr key={o.id}><td>{o.nome}</td><td>{o.email}</td><td className="num">{o.carga_atual}</td><td className="num">{o.capacidade_casos}</td><td className="num">{o.interacoes_mes}</td><td><Badge status={o.status} /></td>
          <td className="right">{s.pode('operador.gerenciar') && <button className="btn sm" onClick={() => setEditar(o)}>Capacidade</button>}</td></tr>)}</tbody>
      </table>{!ops?.length && <Vazio titulo="Nenhum operador" />}</div></div>
      {editar && <FormModal titulo={`Capacidade de ${editar.nome}`} inicial={editar} onClose={() => setEditar(null)} campos={[{ nome: 'capacidade_casos', rotulo: 'Casos simultâneos', tipo: 'numero', min: 1, max: 1000, obrigatorio: true }, { nome: 'alcada_desconto_bps', rotulo: 'Alçada individual de desconto', tipo: 'percentual' }]}
        onSubmit={async (v) => { await hs('alterarUsuario', { usuario_id: editar.id, ...v }); recarregar(); }} />}
    </div>
  );
}

function ComissaoContrato({ inicial, padrao, onChange }) {
  const [propria, setPropria] = useState(!!inicial);
  const [faixas, setFaixas] = useState(inicial || padrao.map(({ ate_dias, bps }) => ({ ate_dias, bps })));
  useEffect(() => { onChange(propria ? faixas : null); }, [propria, faixas]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="stack">
      <h3 style={{ margin: 0 }}>Comissão do Acorly sobre valores recebidos</h3>
      <label className="check"><input type="checkbox" checked={propria} onChange={(e) => setPropria(e.target.checked)} />Usar tabela própria neste contrato</label>
      {propria ? <EditorFaixas faixas={faixas} onChange={setFaixas} /> : <><p className="small muted" style={{ margin: 0 }}>Sem tabela própria, o contrato usa a tabela padrão vigente (abaixo).</p><TabelaComissao faixas={padrao} /></>}
    </div>
  );
}

export function ContratosHS() {
  const [editar, setEditar] = useState(null);
  const [faixasContrato, setFaixasContrato] = useState(null);
  const tabela = useApi('obterTabelaComissao', {});
  const [r, setR] = useState(0);
  const confirmar = useConfirm();
  const { executar } = useExecutar();
  const empresas = useApi('listarEmpresas', { pageSize: 200 });
  const nomes = new Map((empresas.data?.itens || []).map((e) => [e.id, e.nome_fantasia || e.razao_social]));
  const campos = [
    { nome: 'empresa_id', rotulo: 'Empresa', tipo: 'select', obrigatorio: true, full: true, opcoes: (empresas.data?.itens || []).map((e) => ({ valor: e.id, rotulo: `${e.razao_social} · ${mascaraDoc(e.cnpj)}` })) },
    { nome: 'modalidade', rotulo: 'Modalidade', tipo: 'select', obrigatorio: true, opcoes: ['PACOTE_CASOS', 'CARTEIRA_ESPECIFICA', 'CARTEIRA_COMPLETA', 'PERSONALIZADA'] },
    { nome: 'quantidade_casos_contratada', rotulo: 'Quantidade de casos', tipo: 'numero', min: 1, max: 1000000, mostrarSe: (v) => v.modalidade === 'PACOTE_CASOS' },
    { nome: 'valor_contratado_centavos', rotulo: 'Preço do serviço', tipo: 'dinheiro', permitirZero: true, obrigatorio: true },
    { nome: 'forma_cobranca_servico', rotulo: 'Forma de cobrança do serviço', padrao: 'Mensal' },
    { nome: 'data_inicio', rotulo: 'Início da vigência', tipo: 'data', obrigatorio: true, padrao: hojeISO() }, { nome: 'data_fim', rotulo: 'Fim da vigência', tipo: 'data' },
    { nome: 'escopo', rotulo: 'Escopo', tipo: 'textarea' }, { nome: 'limites', rotulo: 'Limites', tipo: 'textarea' },
  ];
  return (
    <div className="stack">
      <Cabecalho titulo="Contratos de cobrança" sub="Propostas e contratos ativos. O faturamento do serviço é separado da assinatura e dos valores das dívidas."><button className="btn prim" onClick={() => setEditar({})}>Nova proposta</button></Cabecalho>
      <Tabela acao="listarContratos" busca={false} recarregar={r} filtros={[{ nome: 'status', rotulo: 'Status', opcoes: ['SOLICITADO', 'PROPOSTO', 'ATIVO', 'ENCERRADO'] }]} colunas={[
        { titulo: 'Empresa', render: (c) => nomes.get(c.empresa_id) || '—' }, { titulo: 'Modalidade', render: (c) => rotulo(c.modalidade) },
        { titulo: 'Preço', num: true, render: (c) => brl(c.valor_contratado_centavos) }, { titulo: 'Casos', num: true, render: (c) => c.quantidade_casos_contratada || '—' },
        { titulo: 'Vigência', render: (c) => (c.data_inicio ? `${data(c.data_inicio)} a ${data(c.data_fim)}` : '—') }, { titulo: 'Status', render: (c) => <Badge status={c.status} /> },
        { titulo: '', render: (c) => <div className="row" style={{ justifyContent: 'flex-end' }}>
          {['SOLICITADO', 'PROPOSTO'].includes(c.status) && <button className="btn sm" onClick={() => setEditar(c)}>{c.status === 'SOLICITADO' ? 'Elaborar proposta' : 'Editar proposta'}</button>}
          {c.status === 'ATIVO' && <button className="btn sm perigo" onClick={async () => { const ok = await confirmar({ titulo: 'Encerrar contrato', perigo: true, pedirMotivo: true, mensagem: 'Casos em andamento serão suspensos.' }); if (ok) { await executar('encerrarContrato', { contrato_id: c.id, motivo: ok.motivo }, 'Contrato encerrado'); setR(r + 1); } }}>Encerrar</button>}
        </div> },
      ]} vazio={<Vazio titulo="Nenhum contrato" />} />
      {editar && <FormModal grande titulo={editar.id ? 'Proposta de contrato' : 'Nova proposta'} inicial={editar} onClose={() => { setEditar(null); setFaixasContrato(null); }} campos={campos} botao="Enviar proposta à empresa"
        onSubmit={async (v) => { await hs('salvarContrato', { ...v, id: editar.id, comissao_faixas: faixasContrato || undefined }); setR(r + 1); }}>
        {tabela.data && <ComissaoContrato inicial={editar.comissao_faixas && editar.status !== 'SOLICITADO' ? editar.comissao_faixas : null} padrao={tabela.data.padrao} onChange={setFaixasContrato} />}
      </FormModal>}
    </div>
  );
}

export function Planos() {
  const [editar, setEditar] = useState(null);
  const [assinar, setAssinar] = useState(false);
  const { executar } = useExecutar();
  const { data: planos, recarregar } = useApi('listarPlanos', {});
  const empresas = useApi('listarEmpresas', { pageSize: 200 });
  return (
    <div className="stack">
      <Cabecalho titulo="Planos e assinaturas" sub="Limites e recursos configuráveis. A cobrança da assinatura é separada dos valores recuperados.">
        {!planos?.length && <button className="btn" onClick={async () => { await executar('seedPlanos', {}, 'Planos padrão criados'); recarregar(); }}>Criar planos padrão</button>}
        <button className="btn" onClick={() => setAssinar(true)}>Registrar assinatura</button>
        <button className="btn prim" onClick={() => setEditar({})}>Novo plano</button>
      </Cabecalho>
      <div className="grid g3">{(planos || []).map((p) => (
        <div key={p.id} className="card stack">
          <div className="row between"><h2 style={{ margin: 0 }}>{p.nome}</h2><Badge status={p.status} /></div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{brl(p.preco_mensal_centavos)}<span className="small muted">/mês</span></div>
          <div className="small">{p.limite_devedores || '∞'} devedores · {p.limite_usuarios || '∞'} usuários</div>
          <div className="small muted">{(p.funcionalidades || []).map(rotulo).join(', ')}</div>
          <div><button className="btn sm" onClick={() => setEditar({ ...p, funcionalidades: (p.funcionalidades || []).join(', ') })}>Editar</button></div>
        </div>
      ))}</div>
      {editar && <FormModal titulo={editar.id ? 'Editar plano' : 'Novo plano'} inicial={editar} onClose={() => setEditar(null)} campos={[
        { nome: 'nome', rotulo: 'Nome', obrigatorio: true }, { nome: 'preco_mensal_centavos', rotulo: 'Preço mensal', tipo: 'dinheiro', obrigatorio: true },
        { nome: 'limite_devedores', rotulo: 'Limite de devedores (vazio = ilimitado)', tipo: 'numero', min: 1, max: 10000000 }, { nome: 'limite_usuarios', rotulo: 'Limite de usuários', tipo: 'numero', min: 1, max: 100000 },
        { nome: 'funcionalidades', rotulo: 'Recursos (separados por vírgula)', full: true }, { nome: 'ordem', rotulo: 'Ordem de exibição', tipo: 'numero', min: 0, max: 99 },
        { nome: 'status', rotulo: 'Status', tipo: 'select', opcoes: ['ATIVO', 'INATIVO'], padrao: 'ATIVO', semVazio: true },
      ]} onSubmit={async (v) => { await hs('salvarPlano', { ...v, id: editar.id, funcionalidades: String(v.funcionalidades || '').split(',').map((x) => x.trim()).filter(Boolean) }); recarregar(); }} />}
      {assinar && <FormModal titulo="Registrar assinatura" onClose={() => setAssinar(false)} campos={[
        { nome: 'empresa_id', rotulo: 'Empresa', tipo: 'select', obrigatorio: true, full: true, opcoes: (empresas.data?.itens || []).map((e) => ({ valor: e.id, rotulo: e.razao_social })) },
        { nome: 'plano_id', rotulo: 'Plano', tipo: 'select', obrigatorio: true, opcoes: (planos || []).map((p) => ({ valor: p.id, rotulo: `${p.nome} · ${brl(p.preco_mensal_centavos)}` })) },
        { nome: 'valor_contratado_centavos', rotulo: 'Valor contratado (vazio = preço do plano)', tipo: 'dinheiro', permitirZero: true },
        { nome: 'data_inicio', rotulo: 'Início', tipo: 'data', obrigatorio: true, padrao: hojeISO() }, { nome: 'data_vencimento', rotulo: 'Vencimento', tipo: 'data', obrigatorio: true },
        { nome: 'status', rotulo: 'Status', tipo: 'select', opcoes: ['ATIVA', 'TRIAL', 'INADIMPLENTE', 'CANCELADA'], padrao: 'ATIVA', semVazio: true },
      ]} aviso={<div className="aviso info">Registro manual. A integração com gateway de pagamento fica para uma etapa posterior.</div>} onSubmit={async (v) => { await hs('salvarAssinatura', v); }} />}
    </div>
  );
}

export function Auditoria() {
  const [ver, setVer] = useState(null);
  const empresas = useApi('listarEmpresas', { pageSize: 200 });
  return (
    <div className="stack">
      <Cabecalho titulo="Auditoria" sub="Toda criação, alteração, exportação e acesso administrativo fica registrado." />
      <Tabela acao="listarAuditoria" busca={false} pageSize={50} filtros={[
        { nome: 'empresa_id', rotulo: 'Empresa', opcoes: (empresas.data?.itens || []).map((e) => ({ valor: e.id, rotulo: e.razao_social })) },
        { nome: 'acao', rotulo: 'Ação', opcoes: ['ACESSO_ADMINISTRATIVO', 'CONFIRMAR_PAGAMENTO', 'REJEITAR_PAGAMENTO', 'DECIDIR_NEGOCIACAO', 'CONCEDER_AUTORIZACAO', 'REVOGAR_AUTORIZACAO', 'ALTERAR_MODALIDADE', 'ATRIBUIR_CASO', 'EXPORTAR_DADOS', 'ANONIMIZAR_TITULAR', 'ALTERAR_USUARIO', 'ALTERAR_STATUS_EMPRESA', 'ACESSO_DOCUMENTO'] },
        { nome: 'entidade', rotulo: 'Entidade', opcoes: ['Empresa', 'UsuarioPlataforma', 'Devedor', 'Divida', 'CasoCobranca', 'Negociacao', 'Acordo', 'Pagamento', 'AutorizacaoCobranca', 'ContratoServico', 'DocumentoDivida'] },
      ]} colunas={[
        { titulo: 'Data', render: (a) => dataHora(a.data_hora) }, { titulo: 'Usuário', render: (a) => <>{a.usuario_email}<div className="small muted">{rotulo(a.perfil)}</div></> },
        { titulo: 'Ação', render: (a) => rotulo(a.acao) }, { titulo: 'Entidade', campo: 'entidade' }, { titulo: 'Registro', render: (a) => <span className="small muted">{a.registro_id || '—'}</span> },
        { titulo: '', render: (a) => (a.dados_anteriores || a.dados_novos) && <button className="btn sm" onClick={() => setVer(a)}>Detalhes</button> },
      ]} />
      {ver && <Modal titulo={rotulo(ver.acao)} grande onClose={() => setVer(null)}><div className="grid g2">
        <div><h3>Antes</h3><pre className="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{ver.dados_anteriores ? JSON.stringify(JSON.parse(ver.dados_anteriores), null, 2) : '—'}</pre></div>
        <div><h3>Depois</h3><pre className="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{ver.dados_novos ? JSON.stringify(JSON.parse(ver.dados_novos), null, 2) : '—'}</pre></div>
      </div></Modal>}
    </div>
  );
}


export function TriagemWhatsApp() {
  const [r, setR] = useState(0);
  const [vincular, setVincular] = useState(null);
  const { executar } = useExecutar();
  const casos = useApi('listarCasos', { pageSize: 200 });
  const ativos = (casos.data?.itens || []).filter((c) => !['RECUPERADO_INTEGRALMENTE', 'SEM_SUCESSO'].includes(c.status_operacional));
  return (
    <div className="stack">
      <Cabecalho titulo="WhatsApp sem caso" sub="Mensagens recebidas pelo WhatsApp Business que não puderam ser associadas automaticamente a um caso." />
      <Tabela acao="listarMensagensSemCaso" busca={false} recarregar={r} colunas={[
        { titulo: 'Recebida em', render: (m) => dataHora(m.recebido_em) }, { titulo: 'Número', render: (m) => `+${m.de}` },
        { titulo: 'Mensagem', render: (m) => <span style={{ whiteSpace: 'pre-wrap' }}>{m.texto}</span> },
        { titulo: '', render: (m) => <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn sm prim" onClick={() => setVincular(m)}>Vincular a um caso</button>
          <button className="btn sm" onClick={async () => { await executar('vincularMensagem', { log_id: m.id, descartar: true }, 'Mensagem descartada'); setR(r + 1); }}>Descartar</button>
        </div> },
      ]} vazio={<Vazio titulo="Nenhuma mensagem pendente">Quando a integração do WhatsApp Business estiver ativa, respostas sem caso identificado aparecem aqui.</Vazio>} />
      {vincular && <FormModal titulo="Vincular mensagem" onClose={() => setVincular(null)} botao="Vincular" campos={[
        { nome: 'caso_id', rotulo: 'Caso', tipo: 'select', obrigatorio: true, full: true, opcoes: ativos.map((c) => ({ valor: c.id, rotulo: `${c.devedor_nome} · ${c.credor} · ${rotulo(c.status_operacional)}` })) },
      ]} aviso={<div className="aviso info">Confira se o número +{vincular.de} pertence ao devedor do caso antes de vincular.</div>}
        onSubmit={async (v) => { await hs('vincularMensagem', { log_id: vincular.id, caso_id: v.caso_id }); setR(r + 1); }} />}
    </div>
  );
}
