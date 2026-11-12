import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { hs } from '../api.js';
import { useSessao } from '../sessao.jsx';
import { Tabela, Badge, Cabecalho, FormModal, Modal, useApi, useToast, useConfirm, Carregando, ErroCarga, Vazio, Stat, Spinner, Campos, useFormulario, useExecutar } from '../ui.jsx';
import { brl, data, dataHora, rotulo, pct } from '../format.js';
import { TabelaComissao } from './comissao.jsx';

const STATUS_CASO = ['AGUARDANDO_VALIDACAO', 'AGUARDANDO_OPERADOR', 'ATRIBUIDO', 'PRIMEIRO_CONTATO_PENDENTE', 'EM_CONTATO', 'DEVEDOR_RESPONDEU', 'EM_NEGOCIACAO', 'ACORDO_AGUARDANDO_PAGAMENTO', 'PAGAMENTO_INFORMADO', 'PAGAMENTO_EM_CONFIRMACAO', 'PARCIALMENTE_RECUPERADO', 'RECUPERADO_INTEGRALMENTE', 'SEM_SUCESSO', 'SUSPENSO', 'CONTESTACAO'];

export const colunasCaso = ({ credor = false, selecao } = {}) => [
  ...(selecao ? [{ titulo: '✓', render: (c) => <input type="checkbox" aria-label="Selecionar caso" checked={selecao.sel.includes(c.id)} onChange={(e) => selecao.set(e.target.checked ? [...selecao.sel, c.id] : selecao.sel.filter((x) => x !== c.id))} /> }] : []),
  ...(credor ? [{ titulo: 'Credor', campo: 'credor' }] : []),
  { titulo: 'Devedor', render: (c) => <Link to={`/casos/${c.id}`}>{c.devedor_nome}</Link> },
  { titulo: 'Original', num: true, render: (c) => brl(c.valor_original_centavos) },
  { titulo: 'Saldo', num: true, render: (c) => brl(c.saldo_atual_centavos) },
  { titulo: 'Atraso', num: true, render: (c) => <span style={{ color: c.dias_atraso > 60 ? 'var(--critico)' : undefined }}>{c.dias_atraso ?? '—'} dias</span> },
  { titulo: 'Responsável', render: (c) => c.operador_nome || (c.modalidade_cobranca === 'AUTOCONTRATADA' ? 'Empresa' : <span className="muted">Sem operador</span>) },
  { titulo: 'Último contato', render: (c) => dataHora(c.ultima_interacao) },
  { titulo: 'Próxima tarefa', render: (c) => (c.proxima_tarefa ? <span title={c.proxima_tarefa.descricao}>{data(c.proxima_tarefa.data_prazo)}</span> : '—') },
  { titulo: 'Prioridade', render: (c) => <Badge status={c.prioridade === 'URGENTE' || c.prioridade === 'ALTA' ? 'PENDENTE' : 'info'}>{rotulo(c.prioridade)}</Badge> },
  { titulo: 'Status', render: (c) => <Badge status={c.status_operacional} /> },
];

export function ListaCasos({ titulo, sub, payload = {}, credor, acoes, filtrosExtra = [] }) {
  return (
    <div className="stack">
      <Cabecalho titulo={titulo} sub={sub}>{acoes}</Cabecalho>
      <Tabela acao="listarCasos" payload={payload} busca={false} colunas={colunasCaso({ credor })}
        filtros={[{ nome: 'status_operacional', rotulo: 'Status', opcoes: STATUS_CASO }, { nome: 'prioridade', rotulo: 'Prioridade', opcoes: ['URGENTE', 'ALTA', 'NORMAL', 'BAIXA'] }, ...filtrosExtra]}
        vazio={<Vazio titulo="Nenhum caso encontrado" />} />
    </div>
  );
}

export function MinhasCobrancas() {
  return <ListaCasos titulo="Minhas cobranças" sub="Cobranças conduzidas pela sua equipe. Abra uma pela tela da dívida (Iniciar cobrança própria)." payload={{ filtros: { modalidade_cobranca: 'AUTOCONTRATADA' } }} acoes={<Link className="btn" to="/dividas">Ir para dívidas</Link>} />;
}

export function CobrancasHS() {
  const s = useSessao();
  return (
    <ListaCasos titulo="Cobranças HS" sub="Casos encaminhados à equipe HS. Acompanhe contatos, propostas e pagamentos."
      payload={{ filtros: { modalidade_cobranca: 'HS_GERENCIADA' } }}
      acoes={<>{s.pode('carteira.ler') && <Link className="btn" to="/cobranca-hs/autorizacoes">Autorizações</Link>}{s.pode('carteira.encaminhar_hs') && <Link className="btn prim" to="/cobranca-hs/encaminhar">Encaminhar à HS</Link>}</>} />
  );
}

export function Carteiras() {
  const s = useSessao();
  const nav = useNavigate();
  const [nova, setNova] = useState(false);
  return (
    <div className="stack">
      <Cabecalho titulo="Carteiras" sub="Agrupe dívidas para organizar cobranças ou encaminhar lotes à HS.">
        {s.pode('carteira.editar') && <button className="btn prim" onClick={() => setNova(true)}>Nova carteira</button>}
      </Cabecalho>
      <Tabela acao="listarCarteiras" filtros={[{ nome: 'status', rotulo: 'Status', opcoes: ['RASCUNHO', 'ENCAMINHADA', 'EM_OPERACAO', 'ENCERRADA'] }, { nome: 'modalidade', rotulo: 'Modalidade', opcoes: ['AUTOCONTRATADA', 'HS_GERENCIADA'] }]} colunas={[
        { titulo: 'Nome', render: (c) => <Link to={`/carteiras/${c.id}`}>{c.nome}</Link> },
        { titulo: 'Modalidade', render: (c) => rotulo(c.modalidade) },
        { titulo: 'Dívidas', num: true, campo: 'quantidade_dividas' },
        { titulo: 'Valor total', num: true, render: (c) => brl(c.valor_total_centavos) },
        { titulo: 'Criada em', render: (c) => dataHora(c.data_criacao) },
        { titulo: 'Status', render: (c) => <Badge status={c.status} /> },
      ]} vazio={<Vazio titulo="Nenhuma carteira" />} />
      {nova && <FormModal titulo="Nova carteira" onClose={() => setNova(false)} campos={[
        { nome: 'nome', rotulo: 'Nome', obrigatorio: true, full: true }, { nome: 'descricao', rotulo: 'Descrição', tipo: 'textarea' },
        { nome: 'modalidade', rotulo: 'Uso previsto', tipo: 'select', opcoes: ['AUTOCONTRATADA', 'HS_GERENCIADA'], padrao: 'HS_GERENCIADA', semVazio: true },
      ]} onSubmit={async (v) => { const c = await hs('salvarCarteira', v); nav(`/carteiras/${c.id}`); }} />}
    </div>
  );
}

function AdicionarDividas({ carteira_id, onClose, onFeito }) {
  const [sel, setSel] = useState([]);
  const toast = useToast();
  const [enviando, setEnviando] = useState(false);
  const salvar = async () => {
    setEnviando(true);
    try { const r = await hs('adicionarDividasCarteira', { carteira_id, divida_ids: sel }); toast.ok(`${r.adicionadas} dívida(s) adicionada(s)`); onFeito(); onClose(); } catch (e) { toast.erro(e); } finally { setEnviando(false); }
  };
  return (
    <Modal titulo="Adicionar dívidas" grande onClose={onClose} rodape={<><span className="muted small" style={{ marginRight: 'auto' }}>{sel.length} selecionada(s)</span><button className="btn" onClick={onClose}>Cancelar</button><button className="btn prim" disabled={!sel.length || enviando} onClick={salvar}>Adicionar</button></>}>
      <Tabela acao="listarDividas" payload={{ filtros: { modalidade_cobranca: 'AUTOCONTRATADA' } }} pageSize={10}
        filtros={[{ nome: 'status_financeiro', rotulo: 'Status', opcoes: ['EM_ABERTO', 'PARCIALMENTE_PAGA', 'EM_ACORDO'] }]} colunas={[
          { titulo: '✓', render: (d) => <input type="checkbox" aria-label="Selecionar" checked={sel.includes(d.id)} onChange={(e) => setSel(e.target.checked ? [...sel, d.id] : sel.filter((x) => x !== d.id))} /> },
          { titulo: 'Devedor', campo: 'devedor_nome' }, { titulo: 'Referência', render: (d) => d.documento_referencia || d.descricao || '—' },
          { titulo: 'Vencimento', render: (d) => data(d.data_vencimento) }, { titulo: 'Saldo', num: true, render: (d) => brl(d.saldo_atual_centavos) }, { titulo: 'Status', render: (d) => <Badge status={d.status_financeiro} /> },
        ]} />
    </Modal>
  );
}

export function CarteiraDetalhe() {
  const { id } = useParams();
  const s = useSessao();
  const { executar } = useExecutar();
  const confirmar = useConfirm();
  const { data: d, carregando, erro, recarregar } = useApi('detalheCarteira', { carteira_id: id });
  const [add, setAdd] = useState(false);
  const [editar, setEditar] = useState(false);
  if (erro) return <ErroCarga erro={erro} onRetry={recarregar} />;
  if (carregando && !d) return <Carregando />;
  const c = d.carteira;
  const rascunho = c.status === 'RASCUNHO';
  return (
    <div className="stack">
      <Cabecalho titulo={c.nome} sub={c.descricao} voltar="/carteiras">
        {s.pode('carteira.editar') && rascunho && <button className="btn" onClick={() => setEditar(true)}>Editar</button>}
        {s.pode('carteira.editar') && rascunho && <button className="btn" onClick={() => setAdd(true)}>Adicionar dívidas</button>}
        {s.pode('carteira.encaminhar_hs') && rascunho && d.itens.length > 0 && <Link className="btn prim" to={`/cobranca-hs/encaminhar?carteira=${c.id}`}>Encaminhar à HS</Link>}
      </Cabecalho>
      <div className="grid g3"><Stat rotulo="Dívidas" valor={c.quantidade_dividas} /><Stat rotulo="Valor total" valor={brl(c.valor_total_centavos)} /><div className="card stat"><span className="rot">Status</span><Badge status={c.status} /></div></div>
      <div className="card p0"><div className="tabela-wrap"><table>
        <thead><tr><th>Devedor</th><th>Referência</th><th>Vencimento</th><th className="num">Saldo</th><th>Situação</th><th>Na carteira</th><th></th></tr></thead>
        <tbody>{d.itens.map((i) => <tr key={i.id}><td><Link to={`/dividas/${i.divida_id}`}>{i.devedor_nome}</Link></td><td>{i.documento_referencia || '—'}</td><td>{data(i.data_vencimento)}</td><td className="num">{brl(i.saldo_atual_centavos)}</td><td><Badge status={i.status_financeiro} /></td><td><Badge status={i.status === 'ENCAMINHADO' ? 'CONFIRMADO' : 'info'}>{rotulo(i.status)}</Badge></td>
          <td className="right">{s.pode('carteira.editar') && rascunho && <button className="btn sm perigo" onClick={async () => { const ok = await confirmar({ titulo: 'Remover da carteira', mensagem: 'A dívida continua cadastrada, só sai desta carteira.' }); if (ok) { await executar('removerDividaCarteira', { carteira_id: c.id, divida_id: i.divida_id }, 'Removida'); recarregar(); } }}>Remover</button>}</td></tr>)}</tbody>
      </table>{!d.itens.length && <Vazio titulo="Carteira vazia">Adicione dívidas para começar.</Vazio>}</div></div>
      {add && <AdicionarDividas carteira_id={c.id} onClose={() => setAdd(false)} onFeito={recarregar} />}
      {editar && <FormModal titulo="Editar carteira" inicial={c} onClose={() => setEditar(false)} campos={[{ nome: 'nome', rotulo: 'Nome', obrigatorio: true, full: true }, { nome: 'descricao', rotulo: 'Descrição', tipo: 'textarea' }]} onSubmit={async (v) => { await hs('salvarCarteira', { ...v, id: c.id }); recarregar(); }} />}
    </div>
  );
}

const CANAIS = ['WHATSAPP', 'TELEFONE', 'EMAIL', 'SMS', 'CARTA'];
const CAMPOS_AUT = [
  { nome: 'limite_desconto_bps', rotulo: 'Desconto máximo', tipo: 'percentual', obrigatorio: true, padrao: 2000 },
  { nome: 'limite_parcelamento', rotulo: 'Parcelas máximas (com entrada)', tipo: 'numero', min: 1, max: 120, obrigatorio: true, padrao: 6 },
  { nome: 'entrada_minima_bps', rotulo: 'Entrada mínima', tipo: 'percentual', padrao: 1000 },
  { nome: 'horario_contato', rotulo: 'Janela de contato', padrao: '08:00-20:00', validar: (v) => (!/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(v) ? 'Use HH:MM-HH:MM' : null), ajuda: 'Segunda a sábado, horário de Brasília' },
  { nome: 'canais_autorizados', rotulo: 'Canais autorizados', tipo: 'multi', opcoes: CANAIS, obrigatorio: true, padrao: ['WHATSAPP', 'TELEFONE'] },
  { nome: 'exige_aprovacao_sempre', tipo: 'checkbox', textoCheck: 'Toda proposta precisa da minha aprovação, mesmo dentro dos limites', full: true },
  { nome: 'condicoes', rotulo: 'Condições e orientações para a equipe HS', tipo: 'textarea' },
];

export function Encaminhar() {
  const s = useSessao();
  const nav = useNavigate();
  const toast = useToast();
  const [qs] = useSearchParams();
  const [passo, setPasso] = useState(1);
  const [tipo, setTipo] = useState(qs.get('carteira') ? 'CARTEIRA' : qs.get('divida') ? 'DIVIDAS' : 'CARTEIRA');
  const [carteiras, setCarteiras] = useState(qs.get('carteira') ? [qs.get('carteira')] : []);
  const [dividas, setDividas] = useState(qs.get('divida') ? [qs.get('divida')] : []);
  const [contrato, setContrato] = useState('');
  const [previa, setPrevia] = useState(null);
  const [aceite, setAceite] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const contratos = useApi('listarContratos', { pageSize: 100 });
  const listaCarteiras = useApi('listarCarteiras', { pageSize: 200, filtros: { status: 'RASCUNHO' } });
  const aut = useFormulario(CAMPOS_AUT);
  const ativos = (contratos.data?.itens || []).filter((c) => c.status === 'ATIVO');
  useEffect(() => { if (!contrato && ativos.length === 1) setContrato(ativos[0].id); }, [ativos.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const selecao = { tipo_selecao: tipo, carteira_ids: tipo === 'CARTEIRA' ? carteiras : undefined, divida_ids: tipo === 'DIVIDAS' ? dividas : undefined };

  if (s.empresa?.status !== 'ATIVA') return <div className="stack"><Cabecalho titulo="Encaminhar à HS" voltar="/cobranca-hs" /><div className="aviso alerta">Sua empresa precisa estar validada (ATIVA) pela HS para encaminhar cobranças. Situação atual: {rotulo(s.empresa?.status)}.</div></div>;
  if (contratos.data && !ativos.length) return <div className="stack"><Cabecalho titulo="Encaminhar à HS" voltar="/cobranca-hs" /><div className="aviso alerta">Você ainda não tem contrato de cobrança gerenciada ativo. <Link to="/contratos">Veja seus contratos</Link> para aceitar uma proposta ou solicitar uma.</div></div>;

  const verPrevia = async () => {
    setEnviando(true);
    try { setPrevia(await hs('previewEncaminhamento', { ...selecao, contrato_servico_id: contrato || undefined })); setPasso(2); } catch (e) { toast.erro(e); } finally { setEnviando(false); }
  };
  const concluir = async () => {
    const a = aut.validar();
    if (!a) { setPasso(3); return; }
    setEnviando(true);
    try {
      const r = await hs('encaminharParaHS', { ...selecao, contrato_servico_id: contrato, autorizacao: { ...a, entrada_minima_bps: a.entrada_minima_bps ?? 0 }, confirmacao: true });
      setResultado(r); setPasso(5); toast.ok(`${r.casos_criados} caso(s) encaminhado(s)`);
    } catch (e) { toast.erro(e); } finally { setEnviando(false); }
  };
  const r = previa?.resumo;
  const av = aut.valores;
  return (
    <div className="stack">
      <Cabecalho titulo="Encaminhar à cobrança HS" sub="Selecione, confira, defina os limites e autorize expressamente." voltar="/cobranca-hs" />
      <div className="row small">{['Seleção', 'Conferência', 'Limites', 'Autorização'].map((t, i) => <Badge key={t} status={passo > i + 1 ? 'CONCLUIDA' : passo === i + 1 ? 'PENDENTE' : 'info'}>{i + 1}. {t}</Badge>)}</div>

      {passo === 1 && (
        <div className="card stack">
          <div className="campo"><label>Contrato de cobrança gerenciada *</label>
            <select value={contrato} onChange={(e) => setContrato(e.target.value)}><option value="">Selecione…</option>{ativos.map((c) => <option key={c.id} value={c.id}>{rotulo(c.modalidade)} · vigência até {data(c.data_fim)}{c.quantidade_casos_contratada ? ` · ${c.quantidade_casos_contratada} casos` : ''}</option>)}</select></div>
          <div className="escolha" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            {[['CARTEIRA', 'Por carteira', 'Uma ou mais carteiras montadas por você'], ['DIVIDAS', 'Dívidas individuais', 'Escolha dívida a dívida'], ['TODOS_ELEGIVEIS', 'Todos os elegíveis', 'Todas as dívidas que cumprem os requisitos, dentro do contrato']].map(([v, t, d]) => (
              <button key={v} type="button" className={`opcao ${tipo === v ? 'sel' : ''}`} onClick={() => setTipo(v)} aria-pressed={tipo === v}><strong>{t}</strong><span className="muted small">{d}</span></button>
            ))}
          </div>
          {tipo === 'CARTEIRA' && (
            <div className="stack">
              {(listaCarteiras.data?.itens || []).length ? (listaCarteiras.data.itens.map((c) => (
                <label key={c.id} className="check"><input type="checkbox" checked={carteiras.includes(c.id)} onChange={(e) => setCarteiras(e.target.checked ? [...carteiras, c.id] : carteiras.filter((x) => x !== c.id))} />{c.nome} · {c.quantidade_dividas} dívidas · {brl(c.valor_total_centavos)}</label>
              ))) : <Vazio titulo="Nenhuma carteira em rascunho"><Link to="/carteiras">Crie uma carteira</Link></Vazio>}
            </div>
          )}
          {tipo === 'DIVIDAS' && (
            <Tabela acao="listarDividas" payload={{ filtros: { modalidade_cobranca: 'AUTOCONTRATADA' } }} pageSize={10} colunas={[
              { titulo: '✓', render: (d) => <input type="checkbox" aria-label="Selecionar" checked={dividas.includes(d.id)} onChange={(e) => setDividas(e.target.checked ? [...dividas, d.id] : dividas.filter((x) => x !== d.id))} /> },
              { titulo: 'Devedor', campo: 'devedor_nome' }, { titulo: 'Vencimento', render: (d) => data(d.data_vencimento) }, { titulo: 'Saldo', num: true, render: (d) => brl(d.saldo_atual_centavos) }, { titulo: 'Status', render: (d) => <Badge status={d.status_financeiro} /> },
            ]} />
          )}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn prim" disabled={!contrato || enviando || (tipo === 'CARTEIRA' && !carteiras.length) || (tipo === 'DIVIDAS' && !dividas.length)} onClick={verPrevia}>{enviando && <Spinner />}Conferir seleção</button>
          </div>
        </div>
      )}

      {passo === 2 && r && (
        <div className="card stack">
          <h2>Conferência antes do encaminhamento</h2>
          <div className="grid g4">
            <Stat rotulo="Devedores" valor={r.quantidade_devedores} /><Stat rotulo="Dívidas" valor={r.quantidade_dividas} />
            <Stat rotulo="Valor total" valor={brl(r.valor_total_centavos)} /><Stat rotulo="Valor vencido" valor={brl(r.valor_vencido_centavos)} tom="critico" />
            <Stat rotulo="Elegíveis" valor={`${r.elegiveis} · ${brl(r.valor_elegivel_centavos)}`} tom="ok" /><Stat rotulo="Registros incompletos" valor={r.registros_incompletos} tom={r.registros_incompletos ? 'alerta' : ''} />
            <Stat rotulo="Não podem ser encaminhados" valor={r.registros_bloqueados} tom={r.registros_bloqueados ? 'critico' : ''} />
            <Stat rotulo="Comissão HS se tudo for recebido" valor={brl(r.comissao_estimada_elegiveis_centavos)} ajuda="Cobrada só sobre o que entrar" />
          </div>
          {previa.itens.some((i) => i.elegivel) && (
            <div className="tabela-wrap"><table><thead><tr><th>Dívida elegível</th><th className="num">Atraso</th><th>Faixa</th><th className="num">Comissão HS</th><th className="num">Saldo</th><th className="num">Comissão se receber tudo</th></tr></thead><tbody>
              {previa.itens.filter((i) => i.elegivel).map((i) => <tr key={i.divida_id}><td>{i.devedor_nome}{i.documento_referencia ? ` · ${i.documento_referencia}` : ''}</td><td className="num">{i.dias_atraso} dias</td><td>{i.comissao_faixa}</td><td className="num"><strong>{pct(i.comissao_bps)}</strong></td><td className="num">{brl(i.saldo_centavos)}</td><td className="num">{brl(i.comissao_estimada_centavos)}</td></tr>)}
            </tbody></table></div>
          )}
          {previa.itens.some((i) => !i.elegivel) && (
            <div className="tabela-wrap"><table><thead><tr><th>Dívida</th><th>Impedimentos</th><th>Pendências (corrigíveis)</th></tr></thead><tbody>
              {previa.itens.filter((i) => !i.elegivel).map((i) => <tr key={i.divida_id}><td><Link to={`/dividas/${i.divida_id}`} target="_blank">{i.devedor_nome || 'Dívida'}{i.documento_referencia ? ` · ${i.documento_referencia}` : ''}</Link></td><td>{i.problemas.join('; ') || '—'}</td><td>{i.pendencias.join('; ') || '—'}</td></tr>)}
            </tbody></table></div>
          )}
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button className="btn" onClick={() => setPasso(1)}>Voltar</button>
            <div className="row"><button className="btn" onClick={verPrevia}>Atualizar conferência</button><button className="btn prim" disabled={!r.elegiveis} onClick={() => setPasso(3)}>Continuar com {r.elegiveis} {r.elegiveis === 1 ? 'dívida elegível' : 'dívidas elegíveis'}</button></div>
          </div>
        </div>
      )}

      {passo === 3 && (
        <div className="card stack">
          <h2>Limites de negociação e contato</h2>
          <p className="muted">A equipe HS só negocia e contata dentro destes limites. Propostas fora deles chegam para a sua aprovação.</p>
          <Campos campos={CAMPOS_AUT} valores={aut.valores} setValores={aut.setValores} erros={aut.erros} />
          <div className="row" style={{ justifyContent: 'space-between' }}><button className="btn" onClick={() => setPasso(2)}>Voltar</button><button className="btn prim" onClick={() => aut.validar() && setPasso(4)}>Revisar autorização</button></div>
        </div>
      )}

      {passo === 4 && r && (
        <div className="card stack">
          <h2>Autorização expressa</h2>
          <div className="aviso info">
            Autorizo a HS Recuperação de Crédito a realizar a cobrança extrajudicial administrativa de <strong>{r.elegiveis} dívida(s)</strong>, no valor de <strong>{brl(r.valor_elegivel_centavos)}</strong>,
            com desconto de até <strong>{pct(Math.round(Number(String(av.limite_desconto_bps).replace(',', '.')) * 100))}</strong>, em até <strong>{av.limite_parcelamento}x</strong>,
            pelos canais <strong>{(av.canais_autorizados || []).map(rotulo).join(', ')}</strong>, das {av.horario_contato}. O pagamento será feito diretamente à minha empresa, que confirmará o recebimento.
            {' '}Estou ciente da <strong>comissão da HS</strong> conforme a faixa de atraso de cada dívida (abaixo), cobrada somente sobre os valores efetivamente recebidos e confirmados.
          </div>
          <TabelaComissao faixas={previa?.tabela_comissao} />
          <label className="check"><input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} />Li e autorizo expressamente, em nome da empresa, nos termos acima.</label>
          <p className="small muted">A autorização fica registrada com seu nome, data e versão. Você pode revogá-la a qualquer momento em Autorizações.</p>
          <div className="row" style={{ justifyContent: 'space-between' }}><button className="btn" onClick={() => setPasso(3)}>Voltar</button><button className="btn prim" disabled={!aceite || enviando} onClick={concluir}>{enviando && <Spinner />}Autorizar e encaminhar</button></div>
        </div>
      )}

      {passo === 5 && resultado && (
        <div className="card stack">
          <div className="aviso ok"><strong>{resultado.casos_criados} caso(s) encaminhado(s)</strong> (autorização v{resultado.autorizacao.versao}). Eles aguardam a validação da equipe HS antes de entrar na fila de cobrança.</div>
          {resultado.nao_encaminhadas.length > 0 && <p>{resultado.nao_encaminhadas.length} dívida(s) não foram encaminhadas por pendências.</p>}
          <div className="row"><button className="btn prim" onClick={() => nav('/cobranca-hs')}>Ver cobranças HS</button></div>
        </div>
      )}
    </div>
  );
}

export function Autorizacoes() {
  const s = useSessao();
  const confirmar = useConfirm();
  const { executar } = useExecutar();
  const [r, setR] = useState(0);
  return (
    <div className="stack">
      <Cabecalho titulo="Autorizações de cobrança" sub="Cada encaminhamento gera uma versão de autorização com os limites concedidos." voltar="/cobranca-hs" />
      <Tabela acao="listarAutorizacoes" busca={false} recarregar={r} colunas={[
        { titulo: 'Versão', render: (a) => `v${a.versao}` }, { titulo: 'Tipo', render: (a) => rotulo(a.tipo_autorizacao) },
        { titulo: 'Dívidas', num: true, render: (a) => JSON.parse(a.escopo_autorizado || '[]').length },
        { titulo: 'Desconto máx.', num: true, render: (a) => pct(a.limite_desconto_bps) }, { titulo: 'Parcelas', num: true, render: (a) => `${a.limite_parcelamento}x` },
        { titulo: 'Canais', render: (a) => (a.canais_autorizados || []).map(rotulo).join(', ') },
        { titulo: 'Responsável', campo: 'responsavel_nome' }, { titulo: 'Data', render: (a) => dataHora(a.data_autorizacao) },
        { titulo: 'Status', render: (a) => <Badge status={a.status} /> },
        { titulo: '', render: (a) => a.status === 'ATIVA' && s.pode('autorizacao.conceder') && <button className="btn sm perigo" onClick={async () => {
          const ok = await confirmar({ titulo: 'Revogar autorização', perigo: true, pedirMotivo: true, botao: 'Revogar', mensagem: 'Os casos ativos desta autorização serão suspensos imediatamente.' });
          if (ok) { await executar('revogarAutorizacao', { autorizacao_id: a.id, motivo: ok.motivo }, 'Autorização revogada e casos suspensos'); setR(r + 1); }
        }}>Revogar</button> },
      ]} vazio={<Vazio titulo="Nenhuma autorização emitida" />} />
    </div>
  );
}
