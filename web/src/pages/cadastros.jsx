import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { hs, enviarArquivo, abrirLink, baixarArquivo } from '../api.js';
import { useSessao } from '../sessao.jsx';
import { Tabela, Badge, Cabecalho, FormModal, Modal, useApi, useToast, useConfirm, Carregando, ErroCarga, Dl, Abas, Vazio, Stat, Spinner, useExecutar } from '../ui.jsx';
import { brl, data, dataHora, mascaraDoc, mascaraFone, rotulo, hojeISO, reaisParaCentavos, centavosParaTexto, pct } from '../format.js';
import { TabelaComissao } from './comissao.jsx';

export const CAMPOS_DEVEDOR = [
  { nome: 'nome', rotulo: 'Nome / razão social', obrigatorio: true, full: true },
  { nome: 'tipo_pessoa', rotulo: 'Tipo de pessoa', tipo: 'select', opcoes: ['PF', 'PJ'], obrigatorio: true, padrao: 'PF', semVazio: true },
  { nome: 'cpf_cnpj', rotulo: 'CPF/CNPJ', tipo: 'documento', tipoPessoaDe: 'tipo_pessoa', obrigatorio: true },
  { nome: 'telefone', rotulo: 'Telefone', tipo: 'telefone' },
  { nome: 'whatsapp', rotulo: 'WhatsApp', tipo: 'telefone' },
  { nome: 'email', rotulo: 'E-mail', tipo: 'email' },
  { nome: 'canal_preferido', rotulo: 'Canal preferido', tipo: 'select', opcoes: ['WHATSAPP', 'TELEFONE', 'EMAIL', 'SMS', 'CARTA'] },
  { nome: 'endereco', rotulo: 'Endereço', full: true },
  { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea' },
];

export const CAMPOS_DIVIDA = [
  { nome: 'descricao', rotulo: 'Descrição', full: true, placeholder: 'Ex.: mensalidade de agosto' },
  { nome: 'origem', rotulo: 'Origem', placeholder: 'Ex.: contrato, venda, serviço' },
  { nome: 'documento_referencia', rotulo: 'Documento de referência', placeholder: 'Nº da nota, contrato, boleto' },
  { nome: 'valor_original_centavos', rotulo: 'Valor original', tipo: 'dinheiro', obrigatorio: true },
  { nome: 'encargos_centavos', rotulo: 'Encargos contratuais', tipo: 'dinheiro', permitirZero: true, ajuda: 'Multa e juros previstos em contrato (opcional)' },
  { nome: 'data_vencimento', rotulo: 'Vencimento', tipo: 'data', obrigatorio: true },
];

/** Seletor de devedor com busca no servidor. */
export function EscolherDevedor({ valor, onChange }) {
  const [busca, setBusca] = useState('');
  const { data } = useApi('listarDevedores', { busca: busca || undefined, pageSize: 20 });
  return (
    <div className="campo full">
      <label>Devedor *</label>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input type="search" placeholder="Buscar por nome ou CPF/CNPJ" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 220 }} />
        <select value={valor || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Selecione…</option>
          {(data?.itens || []).map((d) => <option key={d.id} value={d.id}>{d.nome} · {mascaraDoc(d.cpf_cnpj)}</option>)}
        </select>
      </div>
    </div>
  );
}

export function Devedores() {
  const s = useSessao();
  const nav = useNavigate();
  const [novo, setNovo] = useState(false);
  const [r, setR] = useState(0);
  return (
    <div className="stack">
      <Cabecalho titulo="Clientes e devedores" sub="Pessoas e empresas com valores em aberto com a sua empresa.">
        {s.pode('divida.editar') && <Link className="btn" to="/importar">Importar planilha</Link>}
        {s.pode('devedor.editar') && <button className="btn prim" onClick={() => setNovo(true)}>Novo devedor</button>}
      </Cabecalho>
      <Tabela acao="listarDevedores" recarregar={r} filtros={[{ nome: 'tipo_pessoa', rotulo: 'Tipo', opcoes: ['PF', 'PJ'] }, { nome: 'status', rotulo: 'Status', opcoes: ['ATIVO', 'INATIVO', 'ANONIMIZADO'] }]}
        vazio={<Vazio titulo="Nenhum devedor cadastrado">Cadastre manualmente ou importe uma planilha CSV.</Vazio>}
        colunas={[
          { titulo: 'Nome', render: (d) => <Link to={`/devedores/${d.id}`}>{d.nome}</Link> },
          { titulo: 'CPF/CNPJ', render: (d) => mascaraDoc(d.cpf_cnpj) },
          { titulo: 'Contato', render: (d) => mascaraFone(d.whatsapp || d.telefone) },
          { titulo: 'E-mail', campo: 'email' },
          { titulo: 'Situação', render: (d) => d.nao_contatar ? <Badge status="SUSPENSO">Não contatar</Badge> : <Badge status={d.status} /> },
        ]} />
      {novo && <FormModal titulo="Novo devedor" campos={CAMPOS_DEVEDOR} onClose={() => setNovo(false)} onSubmit={async (d) => { const x = await hs('salvarDevedor', d); setR(r + 1); nav(`/devedores/${x.id}`); }} />}
    </div>
  );
}

export function DevedorDetalhe() {
  const { id } = useParams();
  const s = useSessao();
  const toast = useToast();
  const confirmar = useConfirm();
  const { data: det, carregando, erro, recarregar } = useApi('detalheDevedor', { devedor_id: id });
  const [editar, setEditar] = useState(false);
  const [novaDivida, setNovaDivida] = useState(false);
  if (erro) return <ErroCarga erro={erro} onRetry={recarregar} />;
  if (carregando && !det) return <Carregando />;
  const d = det.devedor;
  const naoContatar = async () => {
    const r = await confirmar({ titulo: d.nao_contatar ? 'Liberar contato' : 'Registrar pedido de não contato', mensagem: d.nao_contatar ? 'O devedor voltará a poder ser contatado.' : 'Nenhum novo contato poderá ser feito com este devedor.', pedirMotivo: true });
    if (!r) return;
    try { await hs('registrarNaoContatar', { devedor_id: d.id, nao_contatar: !d.nao_contatar, motivo: r.motivo }); toast.ok('Preferência registrada'); recarregar(); } catch (e) { toast.erro(e); }
  };
  const exportar = async () => {
    try { const x = await hs('exportarDadosTitular', { devedor_id: d.id }); baixarArquivo(`dados-titular-${d.id}.json`, JSON.stringify(x, null, 2), 'application/json'); } catch (e) { toast.erro(e); }
  };
  const anonimizar = async () => {
    const r = await confirmar({ titulo: 'Anonimizar titular', perigo: true, botao: 'Anonimizar definitivamente', pedirMotivo: true, mensagem: 'Os dados pessoais serão apagados de forma irreversível. Só é possível quando não há dívidas em aberto nem cobrança ativa.' });
    if (!r) return;
    try { await hs('anonimizarDevedor', { devedor_id: d.id, confirmacao: true, motivo: r.motivo }); toast.ok('Titular anonimizado'); recarregar(); } catch (e) { toast.erro(e); }
  };
  return (
    <div className="stack">
      <Cabecalho titulo={d.nome} sub={`${rotulo(d.tipo_pessoa)} · ${mascaraDoc(d.cpf_cnpj)}`} voltar="/devedores">
        {s.pode('devedor.editar') && d.status !== 'ANONIMIZADO' && <button className="btn" onClick={() => setEditar(true)}>Editar</button>}
        {s.pode('divida.editar') && d.status !== 'ANONIMIZADO' && <button className="btn prim" onClick={() => setNovaDivida(true)}>Nova dívida</button>}
      </Cabecalho>
      {d.nao_contatar && <div className="aviso critico">Este devedor pediu a interrupção de contato. {d.motivo_nao_contatar}</div>}
      <div className="grid g3">
        <Stat rotulo="Saldo em aberto" valor={brl(det.totais.saldo_centavos)} tom={det.totais.saldo_centavos ? 'critico' : 'ok'} />
        <Stat rotulo="Valor original total" valor={brl(det.totais.original_centavos)} />
        <Stat rotulo="Casos de cobrança" valor={det.casos.length} />
      </div>
      <div className="grid g2">
        <div className="card">
          <h2>Dados de contato</h2>
          <Dl itens={[['Telefone', mascaraFone(d.telefone)], ['WhatsApp', mascaraFone(d.whatsapp)], ['E-mail', d.email || '—'], ['Canal preferido', rotulo(d.canal_preferido)], ['Endereço', d.endereco || '—'], ['Observações', d.observacoes || '—'], ['Base legal', rotulo(d.base_legal)]]} />
        </div>
        <div className="card stack">
          <h2>Privacidade (LGPD)</h2>
          <p className="muted small">Atenda às solicitações do titular. A empresa credora é a controladora destes dados.</p>
          <div className="row">
            {s.pode('devedor.editar') && <button className="btn sm" onClick={naoContatar}>{d.nao_contatar ? 'Liberar contato' : 'Pedido de não contato'}</button>}
            {s.pode('lgpd.atender') && <button className="btn sm" onClick={exportar}>Exportar dados do titular</button>}
            {s.pode('lgpd.atender') && d.status !== 'ANONIMIZADO' && <button className="btn sm perigo" onClick={anonimizar}>Anonimizar</button>}
          </div>
        </div>
      </div>
      <div className="card p0">
        <div style={{ padding: '12px 16px 0' }}><h2>Dívidas</h2></div>
        <div className="tabela-wrap"><table>
          <thead><tr><th>Descrição</th><th>Vencimento</th><th className="num">Atraso</th><th className="num">Original</th><th className="num">Saldo</th><th>Modalidade</th><th>Status</th></tr></thead>
          <tbody>{det.dividas.map((x) => (
            <tr key={x.id}><td><Link to={`/dividas/${x.id}`}>{x.descricao || x.documento_referencia || 'Dívida'}</Link></td><td>{data(x.data_vencimento)}</td>
              <td className="num" style={{ color: x.dias_atraso > 0 ? 'var(--critico)' : undefined }}>{x.dias_atraso} dias</td><td className="num">{brl(x.valor_original_centavos)}</td><td className="num">{brl(x.saldo_atual_centavos)}</td>
              <td><Badge status="info">{rotulo(x.modalidade_cobranca)}</Badge></td><td><Badge status={x.status_financeiro} /></td></tr>
          ))}</tbody>
        </table>{!det.dividas.length && <Vazio titulo="Nenhuma dívida para este devedor" />}</div>
      </div>
      {editar && <FormModal titulo="Editar devedor" campos={CAMPOS_DEVEDOR} inicial={d} onClose={() => setEditar(false)} onSubmit={async (v) => { await hs('salvarDevedor', { ...v, id: d.id }); toast.ok('Devedor atualizado'); recarregar(); }} />}
      {novaDivida && <FormModal titulo="Nova dívida" campos={CAMPOS_DIVIDA} onClose={() => setNovaDivida(false)} onSubmit={async (v) => { await hs('salvarDivida', { ...v, devedor_id: d.id }); toast.ok('Dívida cadastrada'); recarregar(); }} />}
    </div>
  );
}

function NovaDivida({ onClose, onCriada }) {
  const [devedor, setDevedor] = useState('');
  return (
    <FormModal titulo="Nova dívida" campos={CAMPOS_DIVIDA} onClose={onClose}
      onSubmit={async (v) => { if (!devedor) throw new Error('Selecione o devedor'); const x = await hs('salvarDivida', { ...v, devedor_id: devedor }); onCriada(x); }}
      aviso={<><EscolherDevedor valor={devedor} onChange={setDevedor} /><p className="small muted">Devedor ainda não cadastrado? <Link to="/devedores">Cadastre aqui</Link>.</p></>} />
  );
}

export function Dividas() {
  const s = useSessao();
  const nav = useNavigate();
  const [qs, setQs] = useSearchParams();
  const [nova, setNova] = useState(qs.get('nova') === '1');
  return (
    <div className="stack">
      <Cabecalho titulo="Dívidas" sub="Valor original, saldo atualizado e situação de cada dívida.">
        {s.pode('divida.editar') && <button className="btn prim" onClick={() => setNova(true)}>Nova dívida</button>}
      </Cabecalho>
      <Tabela acao="listarDividas" filtros={[
        { nome: 'status_financeiro', rotulo: 'Status', opcoes: ['EM_ABERTO', 'EM_ACORDO', 'PARCIALMENTE_PAGA', 'QUITADA', 'CANCELADA'] },
        { nome: 'modalidade_cobranca', rotulo: 'Modalidade', opcoes: ['AUTOCONTRATADA', 'HS_GERENCIADA'] },
        { nome: 'status_validacao', rotulo: 'Validação Acorly', opcoes: ['NAO_VALIDADA', 'EM_VALIDACAO', 'VALIDADA', 'REPROVADA'] },
        { nome: 'vencimento_de', rotulo: 'Vence de', tipo: 'data' }, { nome: 'vencimento_ate', rotulo: 'até', tipo: 'data' },
      ]} colunas={[
        { titulo: 'Devedor', render: (d) => <Link to={`/dividas/${d.id}`}>{d.devedor_nome}</Link> },
        { titulo: 'Referência', render: (d) => d.documento_referencia || d.descricao || '—' },
        { titulo: 'Vencimento', render: (d) => data(d.data_vencimento) },
        { titulo: 'Atraso', num: true, render: (d) => <span style={{ color: d.dias_atraso > 0 ? 'var(--critico)' : undefined }}>{d.dias_atraso} dias</span> },
        { titulo: 'Original', num: true, render: (d) => brl(d.valor_original_centavos) },
        { titulo: 'Saldo', num: true, render: (d) => brl(d.saldo_atual_centavos) },
        { titulo: 'Modalidade', render: (d) => rotulo(d.modalidade_cobranca) },
        { titulo: 'Status', render: (d) => <Badge status={d.status_financeiro} /> },
      ]} vazio={<Vazio titulo="Nenhuma dívida encontrada" />} />
      {nova && <NovaDivida onClose={() => { setNova(false); setQs({}); }} onCriada={(x) => nav(`/dividas/${x.id}`)} />}
    </div>
  );
}

/** Formulário para registrar pagamento recebido pelo credor (ou informado). */
export function RegistrarPagamento({ divida, parcelas = [], casoId, onClose, onFeito, podeConfirmar }) {
  const [comprovante, setComprovante] = useState(null);
  const campos = [
    { nome: 'valor_centavos', rotulo: 'Valor pago', tipo: 'dinheiro', obrigatorio: true },
    { nome: 'data_informada', rotulo: 'Data do pagamento', tipo: 'data', obrigatorio: true, padrao: hojeISO() },
    { nome: 'forma_pagamento', rotulo: 'Forma', tipo: 'select', opcoes: ['PIX', 'BOLETO', 'TRANSFERENCIA', 'CARTAO', 'DINHEIRO', 'OUTRO'], padrao: 'PIX', semVazio: true },
    { nome: 'identificador_transacao', rotulo: 'ID da transação (evita duplicidade)' },
    ...(parcelas.length ? [{ nome: 'parcela_id', rotulo: 'Parcela', tipo: 'select', full: true, opcoes: parcelas.filter((p) => p.saldo_centavos > 0 && !['CANCELADA', 'SUBSTITUIDA'].includes(p.status)).map((p) => ({ valor: p.id, rotulo: `${p.acordo_id ? 'Acordo' : 'Original'} · ${p.numero === 0 ? 'Entrada' : `Parcela ${p.numero}`} · vence ${data(p.vencimento)} · saldo ${brl(p.saldo_centavos)}` })) }] : []),
    ...(podeConfirmar ? [{ nome: 'confirmar_agora', tipo: 'checkbox', textoCheck: 'Já conferi no extrato: confirmar o recebimento agora', full: true, padrao: true }] : []),
  ];
  return (
    <FormModal titulo={podeConfirmar ? 'Registrar pagamento recebido' : 'Informar pagamento'} campos={campos} onClose={onClose}
      aviso={<div className="aviso info">O devedor paga diretamente à empresa credora. {podeConfirmar ? 'Confirme apenas valores que entraram na sua conta.' : 'O credor será notificado para conferir e confirmar.'} Saldo atual: <strong>{brl(divida.saldo_atual_centavos)}</strong>.</div>}
      onSubmit={async (v) => {
        let comprovante_file_uri;
        if (comprovante) comprovante_file_uri = (await enviarArquivo(comprovante)).file_uri;
        await hs('informarPagamento', { ...v, parcela_id: v.parcela_id || undefined, comprovante_file_uri, ...(casoId ? { caso_id: casoId } : { divida_id: divida.id }) });
        onFeito?.();
      }}>
      <div className="campo"><label>Comprovante (opcional)</label><input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setComprovante(e.target.files[0] || null)} /><span className="ajuda">O comprovante sozinho não prova a liquidação.</span></div>
    </FormModal>
  );
}

/** Quanto o Acorly cobraria (ou cobra) nesta dívida. */
function QuadroComissaoHS({ divida }) {
  const s = useSessao();
  const { data: c } = useApi('comissaoDivida', { divida_id: divida.id }, [divida.saldo_atual_centavos]);
  const [verTabela, setVerTabela] = useState(false);
  if (!c) return null;
  return (
    <div className="card stack">
      <div className="row between">
        <h2 style={{ margin: 0 }}>Cobrança pela equipe Acorly</h2>
        <button className="btn sm" onClick={() => setVerTabela(!verTabela)}>{verTabela ? 'Ocultar tabela' : 'Ver tabela de comissão'}</button>
      </div>
      {c.ja_encaminhada ? (
        <p style={{ margin: 0 }}>Esta dívida está com o Acorly. Comissão fixada no encaminhamento: <strong>{pct(c.comissao_bps)}</strong> ({c.comissao_faixa} de atraso), cobrada só sobre o que você receber. Sobre o saldo atual, seria até <strong>{brl(c.estimativa_centavos)}</strong>.</p>
      ) : (
        <p style={{ margin: 0 }}>Se encaminhar hoje, a comissão do Acorly será de <strong>{pct(c.comissao_bps)}</strong>, porque a dívida está com <strong>{c.dias_atraso} dias de atraso</strong> (faixa {c.comissao_faixa}). Ela incide <strong>somente sobre o que você efetivamente receber</strong>: se o devedor pagar todo o saldo de {brl(divida.saldo_atual_centavos)}, a comissão será de {brl(c.estimativa_centavos)}. Se nada for recebido, não há comissão.</p>
      )}
      {!c.tem_contrato && !c.ja_encaminhada && <div className="aviso alerta small">Para encaminhar ao Acorly, você precisa de um contrato de cobrança gerenciada ativo{s.pode('contrato.ler') ? <> (veja em <Link to="/contratos">Contratos</Link>)</> : ''}. A tabela mostrada é a padrão do Acorly.</div>}
      {verTabela && <TabelaComissao faixas={c.tabela} destaque={c.comissao_faixa} />}
    </div>
  );
}

function EditorParcelas({ divida, onClose, onFeito }) {
  const total = divida.valor_original_centavos + (divida.encargos_centavos || 0);
  const [n, setN] = useState(2);
  const [primeira, setPrimeira] = useState(divida.data_vencimento);
  const [linhas, setLinhas] = useState([]);
  const toast = useToast();
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    const qtd = Math.min(Math.max(1, Number(n) || 1), 360);
    const base = Math.floor(total / qtd);
    const [y, m, d] = (primeira || divida.data_vencimento).split('-').map(Number);
    setLinhas(Array.from({ length: qtd }, (_, i) => {
      const alvo = new Date(Date.UTC(y, m - 1 + i, 1));
      const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
      alvo.setUTCDate(Math.min(d, ultimo));
      return { valor: centavosParaTexto(i === qtd - 1 ? total - base * (qtd - 1) : base), vencimento: alvo.toISOString().slice(0, 10) };
    }));
  }, [n, primeira]); // eslint-disable-line react-hooks/exhaustive-deps
  const soma = linhas.reduce((a, l) => a + (reaisParaCentavos(l.valor) || 0), 0);
  const salvar = async () => {
    setEnviando(true);
    try {
      await hs('salvarParcelas', { divida_id: divida.id, parcelas: linhas.map((l) => ({ valor_centavos: reaisParaCentavos(l.valor), vencimento: l.vencimento })) });
      toast.ok('Parcelas definidas'); onFeito(); onClose();
    } catch (e) { toast.erro(e); } finally { setEnviando(false); }
  };
  return (
    <Modal titulo="Parcelas da dívida" onClose={onClose} grande rodape={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn prim" disabled={soma !== total || enviando} onClick={salvar}>Salvar parcelas</button></>}>
      <div className="stack">
        <div className="row">
          <label className="campo">Quantidade<input type="number" min="1" max="360" value={n} onChange={(e) => setN(e.target.value)} style={{ width: 100 }} /></label>
          <label className="campo">1º vencimento<input type="date" value={primeira} onChange={(e) => setPrimeira(e.target.value)} /></label>
        </div>
        <div className={`aviso ${soma === total ? 'ok' : 'critico'}`}>Soma: {brl(soma)} de {brl(total)} (valor original + encargos)</div>
        <table><thead><tr><th>#</th><th>Valor (R$)</th><th>Vencimento</th></tr></thead><tbody>
          {linhas.map((l, i) => <tr key={i}><td>{i + 1}</td>
            <td><input inputMode="decimal" value={l.valor} onChange={(e) => setLinhas(linhas.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)))} /></td>
            <td><input type="date" value={l.vencimento} onChange={(e) => setLinhas(linhas.map((x, j) => (j === i ? { ...x, vencimento: e.target.value } : x)))} /></td></tr>)}
        </tbody></table>
      </div>
    </Modal>
  );
}

export function DividaDetalhe() {
  const { id } = useParams();
  const s = useSessao();
  const nav = useNavigate();
  const toast = useToast();
  const confirmar = useConfirm();
  const { executar } = useExecutar();
  const { data: d, carregando, erro, recarregar } = useApi('detalheDivida', { divida_id: id });
  const [aba, setAba] = useState('parcelas');
  const [modal, setModal] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const arquivo = useRef();
  const [tipoDoc, setTipoDoc] = useState('NOTA_FISCAL');
  if (erro) return <ErroCarga erro={erro} onRetry={recarregar} />;
  if (carregando && !d) return <Carregando />;
  const dv = d.divida;
  const casoAtivo = d.casos.find((c) => !['RECUPERADO_INTEGRALMENTE', 'SEM_SUCESSO'].includes(c.status_operacional));
  const parcelas = d.parcelas.filter((p) => p.status !== 'SUBSTITUIDA');
  const aberta = dv.saldo_atual_centavos > 0 && dv.status_financeiro !== 'CANCELADA';

  const anexar = async (file) => {
    if (!file) return;
    setEnviando(true);
    try {
      const { file_uri } = await enviarArquivo(file);
      await hs('anexarDocumento', { divida_id: dv.id, file_uri, nome_arquivo: file.name, tipo_documento: tipoDoc });
      toast.ok('Documento anexado'); recarregar();
    } catch (e) { toast.erro(e); } finally { setEnviando(false); arquivo.current.value = ''; }
  };
  const cancelar = async () => {
    const r = await confirmar({ titulo: 'Cancelar dívida', perigo: true, pedirMotivo: true, botao: 'Cancelar dívida', mensagem: 'A dívida deixa de ser cobrada e sai dos indicadores de saldo.' });
    if (r) { await executar('cancelarDivida', { divida_id: dv.id, motivo: r.motivo }, 'Dívida cancelada'); recarregar(); }
  };
  const retirar = async () => {
    const r = await confirmar({ titulo: 'Retirar da cobrança Acorly', pedirMotivo: true, mensagem: 'O caso no Acorly será encerrado e a dívida volta para a cobrança própria. Não é possível com acordo ou pagamento em andamento.' });
    if (r) { await executar('alterarModalidade', { divida_id: dv.id, para: 'AUTOCONTRATADA', motivo: r.motivo }, 'Dívida retirada do Acorly'); recarregar(); }
  };
  const iniciar = async () => {
    const c = await executar('abrirCobrancaPropria', { divida_id: dv.id }, 'Cobrança iniciada');
    nav(`/casos/${c.id}`);
  };

  return (
    <div className="stack">
      <Cabecalho titulo={dv.descricao || dv.documento_referencia || 'Dívida'} sub={<>Devedor: <Link to={`/devedores/${d.devedor.id}`}>{d.devedor.nome}</Link> · {mascaraDoc(d.devedor.cpf_cnpj)}</>} voltar="/dividas">
        {s.pode('divida.editar') && aberta && <button className="btn" onClick={() => setModal('editar')}>Editar</button>}
        {s.pode('pagamento.informar') && aberta && <button className="btn ok" onClick={() => setModal('pagamento')}>Registrar pagamento</button>}
        {s.pode('interacao.registrar') && aberta && !casoAtivo && dv.modalidade_cobranca === 'AUTOCONTRATADA' && <button className="btn prim" onClick={iniciar}>Iniciar cobrança própria</button>}
        {s.pode('carteira.encaminhar_hs') && aberta && !casoAtivo && dv.modalidade_cobranca === 'AUTOCONTRATADA' && <Link className="btn prim" to={`/cobranca-hs/encaminhar?divida=${dv.id}`}>Encaminhar ao Acorly</Link>}
        {s.pode('carteira.encaminhar_hs') && dv.modalidade_cobranca === 'HS_GERENCIADA' && casoAtivo && <button className="btn" onClick={retirar}>Retirar do Acorly</button>}
        {casoAtivo && <Link className="btn" to={`/casos/${casoAtivo.id}`}>Ver caso</Link>}
      </Cabecalho>
      {aberta && <QuadroComissaoHS divida={dv} />}
      {dv.status_validacao === 'REPROVADA' && <div className="aviso critico">O Acorly devolveu esta dívida para correção: {dv.pendencia_validacao}. Corrija os dados e reative o caso.</div>}
      <div className="grid g4">
        <Stat rotulo="Valor original" valor={brl(dv.valor_original_centavos)} ajuda={dv.encargos_centavos ? `+ encargos ${brl(dv.encargos_centavos)}` : undefined} />
        <Stat rotulo="Saldo atual" valor={brl(dv.saldo_atual_centavos)} tom={dv.saldo_atual_centavos ? 'critico' : 'ok'} />
        <Stat rotulo="Vencimento" valor={data(dv.data_vencimento)} />
        <div className="card stat"><span className="rot">Situação</span><div className="row"><Badge status={dv.status_financeiro} /><Badge status="info">{rotulo(dv.modalidade_cobranca)}</Badge><Badge status={dv.status_validacao}>Acorly: {rotulo(dv.status_validacao)}</Badge></div></div>
      </div>
      <div className="card">
        <Abas ativa={aba} onChange={setAba} abas={[
          { id: 'parcelas', rotulo: 'Parcelas', contador: parcelas.length }, { id: 'documentos', rotulo: 'Documentos', contador: d.documentos.length },
          { id: 'pagamentos', rotulo: 'Pagamentos', contador: d.pagamentos.length }, { id: 'historico', rotulo: 'Histórico financeiro' }, { id: 'casos', rotulo: 'Cobranças', contador: d.casos.length },
        ]} />
        {aba === 'parcelas' && (
          <div className="stack">
            {s.pode('divida.editar') && aberta && !d.pagamentos.some((p) => p.status_confirmacao !== 'REJEITADO') && <div><button className="btn sm" onClick={() => setModal('parcelas')}>Definir parcelas originais</button></div>}
            {parcelas.length ? <table><thead><tr><th>Origem</th><th>#</th><th>Vencimento</th><th className="num">Valor</th><th className="num">Saldo</th><th>Status</th></tr></thead>
              <tbody>{parcelas.map((p) => <tr key={p.id}><td>{p.acordo_id ? <Link to={`/acordos?acordo=${p.acordo_id}`}>Acordo</Link> : 'Original'}</td><td>{p.numero === 0 ? 'Entrada' : p.numero}</td><td>{data(p.vencimento)}</td><td className="num">{brl(p.valor_original_centavos)}</td><td className="num">{brl(p.saldo_centavos)}</td><td><Badge status={p.status} /></td></tr>)}</tbody></table>
              : <Vazio titulo="Dívida sem parcelamento">Pagamento em parcela única.</Vazio>}
          </div>
        )}
        {aba === 'documentos' && (
          <div className="stack">
            {s.pode('documento.enviar') && (
              <div className="row">
                <select value={tipoDoc} onChange={(e) => setTipoDoc(e.target.value)} style={{ width: 'auto' }} aria-label="Tipo do documento">{['CONTRATO', 'NOTA_FISCAL', 'BOLETO', 'CONFISSAO_DIVIDA', 'COMPROVANTE_ENTREGA', 'OUTRO'].map((t) => <option key={t} value={t}>{rotulo(t)}</option>)}</select>
                <input ref={arquivo} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => anexar(e.target.files[0])} disabled={enviando} style={{ maxWidth: 320 }} />
                {enviando && <Spinner />}<span className="small muted">PDF ou imagem, até 10 MB. Arquivos privados.</span>
              </div>
            )}
            {d.documentos.length ? <table><thead><tr><th>Arquivo</th><th>Tipo</th><th>Enviado em</th><th></th></tr></thead><tbody>
              {d.documentos.map((x) => <tr key={x.id}><td>{x.nome_arquivo}</td><td>{rotulo(x.tipo_documento)}</td><td>{dataHora(x.data_upload)}</td><td className="right"><button className="btn sm" onClick={() => abrirLink(hs('urlDocumento', { documento_id: x.id })).catch(toast.erro)}>Abrir</button></td></tr>)}
            </tbody></table> : <Vazio titulo="Nenhum documento">O Acorly exige documentação mínima para cobrança gerenciada.</Vazio>}
          </div>
        )}
        {aba === 'pagamentos' && (d.pagamentos.length ? <table><thead><tr><th>Data</th><th className="num">Informado</th><th className="num">Confirmado</th><th>Forma</th><th>Status</th><th></th></tr></thead><tbody>
          {d.pagamentos.map((p) => <tr key={p.id}><td>{data(p.data_informada)}</td><td className="num">{brl(p.valor_centavos)}</td><td className="num">{brl(p.valor_confirmado_centavos)}</td><td>{rotulo(p.forma_pagamento)}</td><td><Badge status={p.status_confirmacao} /></td>
            <td className="right">{['INFORMADO', 'EM_CONFIRMACAO'].includes(p.status_confirmacao) && s.pode('pagamento.confirmar') && <Link className="btn sm" to="/pagamentos">Conferir</Link>}</td></tr>)}
        </tbody></table> : <Vazio titulo="Nenhum pagamento registrado" />)}
        {aba === 'historico' && <table><thead><tr><th>Data</th><th>Lançamento</th><th className="num">Valor</th><th className="num">Saldo após</th><th>Observação</th></tr></thead><tbody>
          {[...d.lancamentos].sort((a, b) => (a.data_hora || '').localeCompare(b.data_hora || '') || (a.created_date || '').localeCompare(b.created_date || '')).map((l) => <tr key={l.id}><td>{dataHora(l.data_hora)}</td><td>{rotulo(l.tipo)}</td><td className="num">{brl(l.valor_centavos)}</td><td className="num">{brl(l.saldo_posterior_centavos)}</td><td>{l.observacao || '—'}</td></tr>)}
        </tbody></table>}
        {aba === 'casos' && (d.casos.length ? <table><thead><tr><th>Caso</th><th>Modalidade</th><th>Recebido</th><th>Status</th></tr></thead><tbody>
          {d.casos.map((c) => <tr key={c.id}><td><Link to={`/casos/${c.id}`}>Abrir caso</Link></td><td>{rotulo(c.modalidade_cobranca)}</td><td>{dataHora(c.data_recebimento)}</td><td><Badge status={c.status_operacional} /></td></tr>)}
        </tbody></table> : <Vazio titulo="Nenhuma cobrança iniciada" />)}
        {s.pode('divida.editar') && aberta && <div style={{ marginTop: 16 }}><button className="btn sm perigo" onClick={cancelar}>Cancelar dívida</button></div>}
      </div>
      {modal === 'pagamento' && <RegistrarPagamento divida={dv} parcelas={parcelas} podeConfirmar={s.pode('pagamento.confirmar')} onClose={() => setModal(null)} onFeito={() => { toast.ok('Pagamento registrado'); recarregar(); }} />}
      {modal === 'parcelas' && <EditorParcelas divida={dv} onClose={() => setModal(null)} onFeito={recarregar} />}
      {modal === 'editar' && <FormModal titulo="Editar dívida" inicial={dv} onClose={() => setModal(null)}
        campos={[...CAMPOS_DIVIDA.filter((c) => c.nome !== 'encargos_centavos'), { nome: 'motivo_correcao', rotulo: 'Motivo (obrigatório se mudar o valor original)', full: true }]}
        aviso={<div className="aviso info">O valor original só pode ser corrigido antes de qualquer pagamento e fora da cobrança Acorly. A correção fica registrada no histórico.</div>}
        onSubmit={async (v) => { await hs('salvarDivida', { ...v, id: dv.id }); toast.ok('Dívida atualizada'); recarregar(); }} />}
    </div>
  );
}

export function Parcelas() {
  return (
    <div className="stack">
      <Cabecalho titulo="Parcelas" sub="Parcelas originais e de acordos, em ordem de vencimento." />
      <Tabela acao="listarParcelas" busca={false} filtros={[{ nome: 'status', rotulo: 'Status', opcoes: ['EM_ABERTO', 'PARCIALMENTE_PAGA', 'PAGA', 'CANCELADA'] }]} colunas={[
        { titulo: 'Devedor', render: (p) => <Link to={`/dividas/${p.divida_id}`}>{p.devedor_nome}</Link> },
        { titulo: 'Origem', render: (p) => (p.acordo_id ? 'Acordo' : 'Original') },
        { titulo: 'Parcela', render: (p) => (p.numero === 0 ? 'Entrada' : p.numero) },
        { titulo: 'Vencimento', render: (p) => <span style={{ color: p.saldo_centavos > 0 && p.vencimento < hojeISO() ? 'var(--critico)' : undefined }}>{data(p.vencimento)}</span> },
        { titulo: 'Valor', num: true, render: (p) => brl(p.valor_original_centavos) },
        { titulo: 'Saldo', num: true, render: (p) => brl(p.saldo_centavos) },
        { titulo: 'Status', render: (p) => <Badge status={p.status} /> },
      ]} vazio={<Vazio titulo="Nenhuma parcela" />} />
    </div>
  );
}

const MODELO_CSV = 'nome;tipo_pessoa;cpf_cnpj;telefone;whatsapp;email;endereco;origem;descricao;documento_referencia;valor_original;data_vencimento;encargos\nMaria da Silva;PF;52998224725;11999990000;11999990000;maria@email.com;Rua A, 10 - São Paulo/SP;Venda;Compra loja;NF-1001;1.250,00;10/08/2026;0\n';

export function Importar() {
  const toast = useToast();
  const [csv, setCsv] = useState(null);
  const [nome, setNome] = useState('');
  const [previa, setPrevia] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const ler = async (file) => {
    setPrevia(null); setResultado(null);
    if (!file) return;
    if (/\.xlsx?$/i.test(file.name)) { toast.erro(new Error('Salve a planilha como CSV (Arquivo › Salvar como › CSV) e envie novamente.')); return; }
    const texto = await file.text();
    setCsv(texto); setNome(file.name);
    setEnviando(true);
    try { setPrevia(await hs('importarPlanilha', { csv: texto, dryRun: true })); } catch (e) { toast.erro(e); } finally { setEnviando(false); }
  };
  const importar = async () => {
    setEnviando(true);
    try { setResultado(await hs('importarPlanilha', { csv, dryRun: false })); toast.ok('Importação concluída'); } catch (e) { toast.erro(e); } finally { setEnviando(false); }
  };
  return (
    <div className="stack">
      <Cabecalho titulo="Importar planilha" sub="Cadastre devedores e dívidas em lote a partir de um arquivo CSV (separado por ; ou ,)." />
      <div className="card stack">
        <div className="row">
          <input type="file" accept=".csv,text/csv" onChange={(e) => ler(e.target.files[0])} style={{ maxWidth: 360 }} />
          <button className="btn" onClick={() => { try { baixarArquivo('modelo-importacao-hs.csv', '﻿' + MODELO_CSV, 'text/csv;charset=utf-8'); } catch (e) { toast.erro(e); } }}>Baixar modelo CSV</button>
          {enviando && <Spinner />}
        </div>
        <p className="small muted">Valores no formato 1.234,56 ou 1234.56; datas em DD/MM/AAAA ou AAAA-MM-DD. Devedores repetidos (mesmo CPF/CNPJ) são reaproveitados e dívidas idênticas são ignoradas. Máximo de 5.000 linhas. Planilhas Excel: salve como CSV antes.</p>
      </div>
      {previa && !resultado && (
        <div className="card stack">
          <h2>Prévia: {nome}</h2>
          <div className="grid g3"><Stat rotulo="Linhas" valor={previa.total} /><Stat rotulo="Válidas" valor={previa.validas} tom="ok" /><Stat rotulo="Com erro (serão ignoradas)" valor={previa.com_erro} tom={previa.com_erro ? 'critico' : ''} /></div>
          {previa.erros.length > 0 && <table><thead><tr><th>Linha</th><th>Problemas</th></tr></thead><tbody>{previa.erros.slice(0, 200).map((e) => <tr key={e.linha}><td>{e.linha}</td><td>{e.erros.join('; ')}</td></tr>)}</tbody></table>}
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn prim" disabled={!previa.validas || enviando} onClick={importar}>Importar {previa.validas} registros</button></div>
        </div>
      )}
      {resultado && (
        <div className="card stack">
          <h2>Importação concluída</h2>
          <div className="grid g3"><Stat rotulo="Devedores novos" valor={resultado.devedores_novos} tom="ok" /><Stat rotulo="Dívidas criadas" valor={resultado.dividas_criadas} tom="ok" /><Stat rotulo="Duplicadas ignoradas" valor={resultado.duplicadas_ignoradas} /></div>
          <div className="row"><Link className="btn prim" to="/dividas">Ver dívidas</Link></div>
        </div>
      )}
    </div>
  );
}
