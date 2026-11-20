// Pedidos de diagnóstico gratuito (leads do site): acompanhamento comercial da equipe.
import { useEffect, useState } from 'react';
import { hs, abrirLink, baixarArquivo } from '../api.js';
import { Tabela, Badge, Cabecalho, Modal, Vazio, Abas, Carregando, useApi, useExecutar, useToast } from '../ui.jsx';
import { brl, dataHora, mascaraFone, mascaraDoc, pct } from '../format.js';
import { useSessao } from '../sessao.jsx';
import { roteiro } from '../roteiros.js';
import { lerPlanilha, contatosDaPlanilha, MODELO_PLANILHA_CAMPANHA } from '../planilha.js';

const SEGMENTOS = { ESCOLA_CURSO: 'Escola ou curso', SAUDE: 'Saúde', ACADEMIA: 'Academia', CONDOMINIO: 'Condomínio', VAREJO: 'Varejo', DISTRIBUIDORA: 'Distribuidora', SERVICOS: 'Serviços', IMOBILIARIA: 'Imobiliária', OUTRO: 'Outro' };
const SEGMENTOS_PROSPECT = { ...SEGMENTOS, CONTABILIDADE: 'Contabilidade' };
const CANAL = { EMAIL: 'E-mail', WHATSAPP: 'WhatsApp', TELEFONE: 'Ligação' };
const STATUS = { NOVO: 'Novo', EM_CONTATO: 'Em contato', DIAGNOSTICO_ENVIADO: 'Diagnóstico enviado', CONVERTIDO: 'Virou cliente', PERDIDO: 'Perdido' };
const TOM = { NOVO: 'PENDENTE', EM_CONTATO: 'info', DIAGNOSTICO_ENVIADO: 'info', CONVERTIDO: 'ATIVA', PERDIDO: 'CANCELADA' };

function Analise({ a }) {
  if (!a) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="grid g4">
        <div className="card stat"><span className="rot">Devedores</span><span className="val">{a.devedores}</span></div>
        <div className="card stat"><span className="rot">Vencido</span><span className="val">{brl(a.vencido_centavos)}</span></div>
        <div className="card stat"><span className="rot">Atraso médio</span><span className="val">{a.atraso_medio_dias} dias</span></div>
        <div className="card stat"><span className="rot">Comissão se tudo for recuperado</span><span className="val">{brl(a.comissao_estimada_centavos)}</span></div>
      </div>
      <table><thead><tr><th>Atraso</th><th className="num">Dívidas</th><th className="num">Valor</th><th className="num">Comissão</th></tr></thead><tbody>
        {a.por_faixa.map((f) => <tr key={f.faixa}><td>{f.faixa} ({pct(f.bps)})</td><td className="num">{f.quantidade}</td><td className="num">{brl(f.valor_centavos)}</td><td className="num">{brl(f.comissao_centavos)}</td></tr>)}
      </tbody></table>
      <p className="small muted" style={{ margin: 0 }}>{a.validas} linha(s) analisada(s){a.ignoradas ? `, ${a.ignoradas} sem valor ou vencimento` : ''}{a.a_vencer_centavos ? `; ${brl(a.a_vencer_centavos)} ainda a vencer` : ''}. Pela tabela de comissão padrão.</p>
    </div>
  );
}

const AJUDA_MARCACOES = 'Marcações: "## Título", "- item de lista", "**negrito**", "[[botao:Texto|https://...]]", "[[link:Texto|https://...]]". Variáveis: {{nome}}, {{empresa}}, {{segmento}}, {{remetente}}, {{whatsapp_linha}}.';

const GRATUITOS = /@(gmail|hotmail|outlook|yahoo|live|bol|uol|icloud|terra|ig)\./i;
/** Sugere o nome da empresa pelo domínio do e-mail (contato@colegio-sophia.com.br → Colegio Sophia). */
function empresaDoEmail(email) {
  const m = /@([^@\s]+)$/.exec(String(email || '').trim());
  if (!m || GRATUITOS.test(email)) return '';
  const nome = m[1].toLowerCase().replace(/^www\./, '').split('.')[0];
  return nome.split(/[-_]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/** Envio de e-mail de apresentação (prospecção), com prévia. */
function Abordar({ lead, prospect, onClose, onFeito }) {
  const modelos = useApi('listarModelosComerciais', {});
  const epoca = useApi('epocaComercial', {});
  const base = lead || (prospect ? { email: prospect.email, nome: prospect.contato_nome, empresa: prospect.empresa, segmento: prospect.segmento === 'CONTABILIDADE' ? 'SERVICOS' : prospect.segmento, whatsapp: prospect.whatsapp || prospect.telefone } : null);
  const [v, setV] = useState({ para: base?.email || '', nome: base?.nome || '', empresa: base?.empresa || '', segmento: base?.segmento || '', whatsapp: base?.whatsapp || '', modelo_id: '', assunto: '', corpo: '' });
  const [previa, setPrevia] = useState(null);
  const [editar, setEditar] = useState(false);
  const { executar, enviando } = useExecutar();
  const [editado, setEditado] = useState(false);
  const [empresaManual, setEmpresaManual] = useState(false);
  const set = (k) => (e) => {
    if (k === 'assunto' || k === 'corpo') setEditado(true);
    if (k === 'empresa') setEmpresaManual(true);
    const novo = { ...v, [k]: e.target.value };
    if (k === 'para' && !empresaManual) novo.empresa = empresaDoEmail(e.target.value);
    setV(novo);
  };
  const ativos = (modelos.data || []).filter((m) => m.ativo !== false);
  const modeloDoSegmento = (seg) => ativos.find((x) => x.nome === (seg === 'ESCOLA_CURSO' ? 'Escolas e cursos' : seg === 'SAUDE' ? 'Clínicas e consultórios' : 'Apresentação dos serviços'));
  const travado = !!lead || !!prospect;
  const mudarSegmento = (e) => {
    const seg = e.target.value;
    const m = !editado && !lead?.ultimo_email_em ? modeloDoSegmento(seg) : null;
    setV({ ...v, segmento: seg, ...(m ? { modelo_id: m.id, assunto: m.assunto, corpo: m.corpo } : {}) });
  };
  useEffect(() => {
    if (!v.modelo_id && ativos.length && (epoca.data || epoca.erro)) {
      const m = ativos.find((x) => (lead?.status === 'EM_CONTATO' && lead?.ultimo_email_em ? x.nome.startsWith('Retorno') : false)) || (prospect?.segmento === 'CONTABILIDADE' ? ativos.find((x) => /parceria|contab/i.test(x.nome)) : null) || ativos.find((x) => x.nome === 'Piloto Sem Risco') || (epoca.data?.decimo_terceiro && prospect?.segmento !== 'CONTABILIDADE' ? ativos.find((x) => x.nome.startsWith('13º')) : null) || ativos.find((x) => x.nome === (v.segmento === 'ESCOLA_CURSO' ? 'Escolas e cursos' : v.segmento === 'SAUDE' ? 'Clínicas e consultórios' : 'Apresentação dos serviços')) || ativos[0];
      setV((x) => ({ ...x, modelo_id: m.id, assunto: m.assunto, corpo: m.corpo }));
    }
  }, [ativos.length, epoca.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!v.assunto || !v.corpo) return undefined;
    const t = setTimeout(() => { hs('previaEmailComercial', { assunto: v.assunto, corpo: v.corpo, nome: v.nome, empresa: v.empresa, segmento: v.segmento }).then(setPrevia).catch(() => setPrevia(null)); }, 350);
    return () => clearTimeout(t);
  }, [v.assunto, v.corpo, v.nome, v.empresa, v.segmento]);
  const escolher = (id) => { const m = ativos.find((x) => x.id === id); if (m) { setEditado(false); setV({ ...v, modelo_id: id, assunto: m.assunto, corpo: m.corpo }); } };
  const enviar = async () => {
    try {
      const r = await executar('enviarEmailComercial', { lead_id: lead?.id, prospect_id: prospect?.id, para: v.para, nome: v.nome, empresa: v.empresa, segmento: v.segmento || undefined, whatsapp: v.whatsapp, modelo_id: v.modelo_id || undefined, assunto: v.assunto, corpo: v.corpo }, 'E-mail enviado');
      onFeito?.(r); onClose();
    } catch { /* aviso já mostrado */ }
  };
  return (
    <Modal grande titulo={base ? `E-mail para ${base.empresa}` : 'Enviar e-mail marketing'} onClose={onClose} rodape={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn prim" disabled={enviando || !v.para || !v.empresa} onClick={enviar}>Enviar e-mail</button></>}>
      <div className="stack">
        <div className="form-grid">
          <div className="campo"><label>E-mail do contato *</label><input type="email" value={v.para} onChange={set('para')} disabled={travado} /></div>
          <div className="campo"><label>Nome do contato</label><input value={v.nome} onChange={set('nome')} /></div>
          <div className="campo"><label>Empresa *</label><input value={v.empresa} onChange={set('empresa')} placeholder={!travado && v.para && GRATUITOS.test(v.para) ? 'Digite o nome da empresa' : 'Preenchido pelo e-mail'} /></div>
          <div className="campo"><label>Segmento</label><select value={v.segmento} onChange={mudarSegmento}><option value="">—</option>{Object.entries(SEGMENTOS).map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select></div>
          {!travado && <div className="campo"><label>WhatsApp (opcional)</label><input value={v.whatsapp} onChange={set('whatsapp')} /></div>}
          <div className="campo"><label>Modelo</label><select value={v.modelo_id} onChange={(e) => escolher(e.target.value)}>{ativos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</select></div>
        </div>
        <div className="row between"><span className="small muted">O e-mail sai de contato@acorly.com.br, com a marca Acorly e o link "não quero mais receber". Respostas chegam no webmail.</span><button type="button" className="btn sm" onClick={() => setEditar(!editar)}>{editar ? 'Ver prévia' : 'Ajustar texto deste envio'}</button></div>
        {editar ? (
          <>
            <div className="campo"><label>Assunto</label><input value={v.assunto} onChange={set('assunto')} /></div>
            <div className="campo"><label>Mensagem</label><textarea rows={14} value={v.corpo} onChange={set('corpo')} /><span className="small muted">{AJUDA_MARCACOES}</span></div>
          </>
        ) : previa ? (
          <div className="stack" style={{ gap: 6 }}>
            <div className="small"><strong>Assunto:</strong> {previa.assunto}</div>
            <div className="previa-email" dangerouslySetInnerHTML={{ __html: previa.html }} />
          </div>
        ) : <Carregando />}
      </div>
    </Modal>
  );
}

function Modelos() {
  const { data, carregando, recarregar } = useApi('listarModelosComerciais', {});
  const [ed, setEd] = useState(null);
  const { executar, enviando } = useExecutar();
  if (carregando && !data) return <Carregando />;
  const salvar = async () => { try { await executar('salvarModeloComercial', ed, 'Modelo salvo'); setEd(null); recarregar(); } catch { /* aviso já mostrado */ } };
  return (
    <div className="stack">
      <div className="row between"><p className="small muted" style={{ margin: 0 }}>Modelos de e-mail de apresentação. {AJUDA_MARCACOES}</p><button className="btn prim" onClick={() => setEd({ nome: '', assunto: '', corpo: '', ativo: true })}>Novo modelo</button></div>
      <div className="grid g2">{(data || []).map((m) => (
        <div key={m.id} className="card stack" style={{ gap: 6 }}>
          <div className="row between"><strong>{m.nome}</strong>{m.ativo === false && <Badge status="CANCELADA">Inativo</Badge>}</div>
          <span className="small"><strong>Assunto:</strong> {m.assunto}</span>
          <span className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{m.corpo.slice(0, 220)}…</span>
          <div><button className="btn sm" onClick={() => setEd({ ...m })}>Editar</button></div>
        </div>
      ))}</div>
      {ed && (
        <Modal grande titulo={ed.id ? 'Editar modelo' : 'Novo modelo'} onClose={() => setEd(null)} rodape={<><button className="btn" onClick={() => setEd(null)}>Cancelar</button><button className="btn prim" disabled={enviando} onClick={salvar}>Salvar</button></>}>
          <div className="stack">
            <div className="form-grid"><div className="campo"><label>Nome</label><input value={ed.nome} onChange={(e) => setEd({ ...ed, nome: e.target.value })} /></div>
              <div className="campo"><label>Situação</label><select value={ed.ativo === false ? 'n' : 's'} onChange={(e) => setEd({ ...ed, ativo: e.target.value === 's' })}><option value="s">Ativo</option><option value="n">Inativo</option></select></div></div>
            <div className="campo"><label>Assunto</label><input value={ed.assunto} onChange={(e) => setEd({ ...ed, assunto: e.target.value })} /></div>
            <div className="campo"><label>Mensagem</label><textarea rows={16} value={ed.corpo} onChange={(e) => setEd({ ...ed, corpo: e.target.value })} /><span className="small muted">{AJUDA_MARCACOES}</span></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Envia ao cliente o diagnóstico (números da planilha ou do valor informado, estimativa e convite ao Piloto Sem Risco). */
function EnviarDiagnostico({ lead, onClose, onFeito }) {
  const temAnalise = !!lead.analise?.vencido_centavos;
  const [v, setV] = useState({ taxa_recuperacao: '20', prazo_dias: '90', valor_em_atraso: '', qtd_dividas: '', mensagem: '' });
  const [previa, setPrevia] = useState(null);
  const [erroPrevia, setErroPrevia] = useState(null);
  const { executar, enviando } = useExecutar();
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  useEffect(() => {
    const t = setTimeout(() => {
      hs('previaDiagnosticoLead', { id: lead.id, ...v }).then((p) => { setPrevia(p); setErroPrevia(null); }).catch((e) => { setPrevia(null); setErroPrevia(e.message); });
    }, 400);
    return () => clearTimeout(t);
  }, [v.taxa_recuperacao, v.prazo_dias, v.valor_em_atraso, v.qtd_dividas, v.mensagem]); // eslint-disable-line react-hooks/exhaustive-deps
  const enviar = async () => { try { await executar('enviarDiagnosticoLead', { id: lead.id, ...v }, 'Diagnóstico enviado ao cliente'); onFeito(); onClose(); } catch { /* aviso já mostrado */ } };
  return (
    <Modal grande titulo={`Enviar diagnóstico: ${lead.empresa}`} onClose={onClose} rodape={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn prim" disabled={enviando || !previa} onClick={enviar}>Enviar para {lead.email}</button></>}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>{temAnalise ? 'Os números vêm da planilha analisada.' : 'Sem planilha analisada: informe o valor total em atraso (ou o sistema usa o valor que o cliente informou no pedido).'} A estimativa é sua: o e-mail deixa claro que não é garantia de resultado.</p>
        <div className="form-grid">
          <div className="campo"><label>Estimativa conservadora de recuperação (%)</label><input inputMode="decimal" value={v.taxa_recuperacao} onChange={set('taxa_recuperacao')} /><span className="small muted">Comece baixo. Depois dos primeiros pilotos, use a taxa real em "Resultados da cobrança".</span></div>
          <div className="campo"><label>Prazo da estimativa (dias)</label><input inputMode="numeric" value={v.prazo_dias} onChange={set('prazo_dias')} /></div>
          {!temAnalise && <div className="campo"><label>Valor total em atraso (R$)</label><input inputMode="decimal" value={v.valor_em_atraso} onChange={set('valor_em_atraso')} placeholder={lead.valor_aberto_centavos ? brl(lead.valor_aberto_centavos) : '20.000,00'} /></div>}
          {!temAnalise && <div className="campo"><label>Quantidade de dívidas (opcional)</label><input inputMode="numeric" value={v.qtd_dividas} onChange={set('qtd_dividas')} placeholder={lead.qtd_devedores || ''} /></div>}
        </div>
        <div className="campo"><label>Mensagem pessoal (opcional)</label><textarea rows={2} value={v.mensagem} onChange={set('mensagem')} placeholder="Ex.: Posso te ligar amanhã às 10h para explicar?" /></div>
        {erroPrevia && <div className="aviso alerta small">{erroPrevia}</div>}
        {previa && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="grid g3">
              <div className="card stat"><span className="rot">Em atraso</span><span className="val">{brl(previa.numeros.vencido_centavos)}</span></div>
              <div className="card stat"><span className="rot">Estimativa de recuperação</span><span className="val">{brl(previa.estimado_centavos)}</span></div>
              <div className="card stat"><span className="rot">Comissão nesse cenário</span><span className="val">{brl(previa.comissao_centavos)}</span></div>
            </div>
            <div className="small"><strong>Assunto:</strong> {previa.assunto}</div>
            <div className="previa-email" dangerouslySetInnerHTML={{ __html: previa.html }} />
          </div>
        )}
      </div>
    </Modal>
  );
}

function Cadencia({ lead, onMudou, onEmail }) {
  const epoca = useApi('epocaComercial', {});
  const { executar, enviando } = useExecutar();
  const toast = useToast();
  const [registrar, setRegistrar] = useState(false);
  const [canal, setCanal] = useState('WHATSAPP');
  const [obs, setObs] = useState('');
  const passos = epoca.data?.passos || [];
  const etapa = Number(lead.cadencia_etapa || 0);
  const ativa = !!lead.proximo_followup && !['CONVERTIDO', 'PERDIDO', 'DIAGNOSTICO_ENVIADO'].includes(lead.status);
  const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const acao = (nome, dados, msg) => executar(nome, dados, msg).then(onMudou).catch(() => {});
  const whats = async () => {
    const janela = window.open('about:blank', '_blank');
    try { const w = await hs('whatsappLead', { id: lead.id }); if (janela && !janela.closed) janela.location.replace(w.link); else window.open(w.link, '_blank', 'noopener'); setCanal('WHATSAPP'); setRegistrar(true); } catch (e) { janela?.close(); toast.erro(e); }
  };
  if (!ativa) {
    return (
      <div className="card stack" style={{ gap: 6 }}>
        <div className="row between"><strong>Follow-up</strong>{!['CONVERTIDO', 'PERDIDO', 'DIAGNOSTICO_ENVIADO'].includes(lead.status) && <button className="btn sm" disabled={enviando} onClick={() => acao('iniciarCadenciaLead', { id: lead.id }, 'Cadência iniciada: próximo contato em 3 dias')}>{lead.cadencia_inicio ? 'Reiniciar cadência' : 'Iniciar cadência (dias 3, 7 e 14)'}</button>}</div>
        <span className="small muted">{lead.cadencia_fim ? `Cadência encerrada: ${lead.cadencia_fim}.` : 'Sem cadência ativa. Ela começa sozinha na primeira abordagem (e-mail, WhatsApp ou ligação).'}</span>
      </div>
    );
  }
  const passo = passos[etapa] || {};
  const atrasado = lead.proximo_followup <= hoje;
  return (
    <div className="card stack" style={{ gap: 8, borderLeft: `4px solid ${atrasado ? 'var(--laranja)' : 'var(--azul)'}` }}>
      <div className="row between">
        <strong>Follow-up {etapa + 1} de 3: {passo.titulo}</strong>
        <Badge status={atrasado ? 'PENDENTE' : 'info'}>{lead.proximo_followup === hoje ? 'hoje' : atrasado ? `atrasado (${lead.proximo_followup.split('-').reverse().join('/')})` : `em ${lead.proximo_followup.split('-').reverse().join('/')}`}</Badge>
      </div>
      <span className="small muted">{passo.descricao} Cadência: dias {passos.map((x) => x.dia).join(', ')} depois da primeira abordagem.</span>
      <div className="row" style={{ gap: 6 }}>
        {(lead.whatsapp || lead.decisor_contato) && <button className="btn sm prim" onClick={whats}>WhatsApp com a mensagem pronta</button>}
        {!lead.nao_receber_comercial && lead.email && <button className="btn sm" onClick={() => onEmail(lead)}>E-mail de retorno</button>}
        <button className="btn sm" onClick={() => { setCanal('TELEFONE'); setRegistrar(true); }}>Liguei</button>
        <button className="btn sm" disabled={enviando} onClick={() => { const m = window.prompt('Por que encerrar? (ex.: respondeu, sem interesse)', 'Respondeu'); if (m !== null) acao('encerrarCadenciaLead', { id: lead.id, motivo: m }, 'Cadência encerrada'); }}>Encerrar cadência</button>
      </div>
      {registrar && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="form-grid">
            <div className="campo"><label>Follow-up feito por</label><select value={canal} onChange={(e) => setCanal(e.target.value)}><option value="WHATSAPP">WhatsApp</option><option value="TELEFONE">Ligação</option><option value="EMAIL">E-mail por fora do sistema</option></select></div>
            <div className="campo"><label>Anotação (opcional)</label><input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: visualizou, pediu para ligar sexta" /></div>
          </div>
          <div className="row" style={{ gap: 6 }}><button className="btn sm prim" disabled={enviando} onClick={() => acao('registrarFollowupLead', { id: lead.id, canal, observacao: obs }, 'Follow-up registrado').then(() => setRegistrar(false))}>Registrar follow-up</button><button className="btn sm" onClick={() => setRegistrar(false)}>Ainda não fiz</button></div>
        </div>
      )}
    </div>
  );
}

function Detalhe({ lead: inicial, onClose, onFeito, onEmail }) {
  const [lead, setLead] = useState(inicial);
  const envios = useApi('enviosDoLead', { lead_id: lead.id });
  const parceiros = useApi('listarParceiros', {});
  const [status, setStatus] = useState(lead.status);
  const [obs, setObs] = useState(lead.observacoes || '');
  const [dec, setDec] = useState({ decisor_nome: lead.decisor_nome || '', decisor_cargo: lead.decisor_cargo || '', decisor_contato: lead.decisor_contato || '', parceiro_id: lead.parceiro_id || '' });
  const [verRoteiro, setVerRoteiro] = useState(false);
  const [diag, setDiag] = useState(false);
  const { executar, enviando } = useExecutar();
  const toast = useToast();
  const recarregarLead = async () => {
    try { const r = await hs('listarLeads', { busca: lead.email || lead.empresa, pageSize: 50 }); const novo = r.itens.find((x) => x.id === lead.id); if (novo) { setLead(novo); setObs(novo.observacoes || ''); setStatus(novo.status); } } catch { /* mantém */ }
    onFeito();
  };
  const salvar = async () => {
    try { await executar('atualizarLead', { id: lead.id, status, observacoes: obs, ...dec }, 'Contato atualizado'); onFeito(); onClose(); } catch { /* aviso já mostrado */ }
  };
  const nome = lead.nome.split(' ')[0];
  const textoWhats = `Olá, ${nome}! Aqui é da HS Recuperação de Crédito (Acorly). Recebemos o seu pedido de diagnóstico da carteira da ${lead.empresa}. Podemos conversar sobre o resultado?`;
  const setD = (k) => (e) => setDec({ ...dec, [k]: e.target.value });
  return (
    <Modal grande titulo={lead.empresa} onClose={onClose} rodape={<><button className="btn" onClick={() => setVerRoteiro(true)}>Roteiro de abordagem</button><div style={{ flex: 1 }} /><button className="btn" onClick={onClose}>Fechar</button><button className="btn prim" disabled={enviando} onClick={salvar}>Salvar</button></>}>
      <div className="stack">
        <div className="grid g2">
          <div className="stack" style={{ gap: 4 }}>
            <strong>{lead.nome}</strong>
            <a href={`mailto:${lead.email}`}>{lead.email}</a>
            {lead.whatsapp && <a href={`https://wa.me/${lead.whatsapp.length <= 11 ? '55' : ''}${lead.whatsapp}?text=${encodeURIComponent(textoWhats)}`} target="_blank" rel="noreferrer">WhatsApp {mascaraFone(lead.whatsapp)}</a>}
            {lead.parceiro_id && <span className="small" style={{ color: 'var(--azul)' }}>Indicado por {(parceiros.data || []).find((x) => x.id === lead.parceiro_id)?.nome || 'parceiro'}</span>}
            <span className="small muted">{SEGMENTOS[lead.segmento] || '—'}{lead.cidade ? ` · ${lead.cidade}` : ''}{lead.cnpj ? ` · CNPJ ${mascaraDoc(lead.cnpj)}` : ''}</span>
            <span className="small muted">Recebido em {dataHora(lead.recebido_em)}</span>
          </div>
          <div className="stack" style={{ gap: 4 }}>
            <span>Inadimplentes informados: <strong>{lead.qtd_devedores || '—'}</strong></span>
            <span>Valor em aberto informado: <strong>{lead.valor_aberto_centavos ? brl(lead.valor_aberto_centavos) : '—'}</strong></span>
            {lead.arquivo_uri && <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => abrirLink(hs('urlPlanilhaLead', { id: lead.id })).catch(toast.erro)}>Baixar planilha ({lead.arquivo_nome})</button>}
          </div>
        </div>
        {lead.mensagem && <div className="card small" style={{ whiteSpace: 'pre-wrap' }}>{lead.mensagem}</div>}
        {lead.analise ? <><h3 style={{ margin: 0 }}>Análise automática da planilha</h3><Analise a={lead.analise} /></>
          : lead.arquivo_uri ? <div className="aviso info small">{lead.erro_analise ? `A análise automática não foi possível (${lead.erro_analise}).` : 'A análise automática só é feita em planilhas CSV.'} Baixe o arquivo para analisar. Se quiser, importe a planilha numa empresa de teste para ver os números no sistema.</div> : null}
        <div className="stack" style={{ gap: 6 }}>
          <div className="row between"><h3 style={{ margin: 0 }}>E-mails enviados</h3>{!lead.nao_receber_comercial && <button className="btn sm prim" onClick={() => { onClose(); onEmail(lead); }}>Enviar e-mail de apresentação</button>}</div>
          {lead.nao_receber_comercial && <div className="aviso alerta small">Este contato pediu para não receber e-mails comerciais.</div>}
          {(envios.data || []).length ? <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{envios.data.map((e) => <li key={e.id}>{dataHora(e.enviado_em)} · {e.assunto}</li>)}</ul> : <span className="small muted">Nenhum e-mail enviado ainda.</span>}
        </div>
        <div className="card row between" style={{ gap: 8 }}>
          <div className="stack" style={{ gap: 2 }}>
            <strong>Diagnóstico</strong>
            <span className="small muted">{lead.diagnostico_enviado_em ? `Enviado em ${dataHora(lead.diagnostico_enviado_em)}${lead.diagnostico_resumo?.estimado_centavos ? ` · estimativa ${brl(lead.diagnostico_resumo.estimado_centavos)}` : ''}` : 'Ainda não enviado. O site promete a resposta em até 2 dias úteis.'}</span>
          </div>
          {lead.email && !lead.nao_receber_comercial && <button className={`btn sm${lead.diagnostico_enviado_em ? '' : ' prim'}`} onClick={() => setDiag(true)}>{lead.diagnostico_enviado_em ? 'Reenviar diagnóstico' : 'Enviar diagnóstico'}</button>}
        </div>
        <Cadencia lead={lead} onMudou={recarregarLead} onEmail={(l) => { onClose(); onEmail(l); }} />
        <div className="stack" style={{ gap: 6 }}>
          <h3 style={{ margin: 0 }}>Quem decide</h3>
          <div className="form-grid">
            <div className="campo"><label>Nome</label><input value={dec.decisor_nome} onChange={setD('decisor_nome')} placeholder="Quem decide sobre a cobrança" /></div>
            <div className="campo"><label>Cargo</label><input value={dec.decisor_cargo} onChange={setD('decisor_cargo')} placeholder="Ex.: mantenedora, sócio, diretor financeiro" /></div>
            <div className="campo"><label>Contato direto (WhatsApp ou e-mail)</label><input value={dec.decisor_contato} onChange={setD('decisor_contato')} /></div>
            <div className="campo"><label>Indicado por (parceiro)</label><select value={dec.parceiro_id} onChange={setD('parceiro_id')}><option value="">Ninguém</option>{(parceiros.data || []).map((x) => <option key={x.id} value={x.id}>{x.nome}{x.empresa ? ` · ${x.empresa}` : ''}</option>)}</select></div>
          </div>
          <span className="small muted">Com o contato direto de quem decide, o WhatsApp do follow-up vai para essa pessoa.</span>
        </div>
        <div className="form-grid">
          <div className="campo"><label>Situação</label><select value={status} onChange={(e) => setStatus(e.target.value)}>{Object.entries(STATUS).map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select></div>
        </div>
        <div className="campo"><label>Anotações da equipe</label><textarea rows={4} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Contatos feitos, proposta enviada, próximos passos…" /></div>
      </div>
      {diag && <EnviarDiagnostico lead={lead} onClose={() => setDiag(false)} onFeito={recarregarLead} />}
      {verRoteiro && <RoteiroModal segmento={lead.segmento} empresa={lead.empresa} onClose={() => setVerRoteiro(false)} />}
    </Modal>
  );
}

/** Roteiro de ligação e respostas às objeções do segmento. */
function RoteiroModal({ segmento, empresa, onClose }) {
  const s = useSessao();
  const epoca = useApi('epocaComercial', {});
  const r = roteiro(segmento, { nomeRemetente: (s.usuario?.nome || 'Hugo').split(' ')[0], decimoTerceiro: !!epoca.data?.decimo_terceiro });
  const Bloco = ({ t, children }) => <div className="stack" style={{ gap: 4 }}><strong>{t}</strong><div style={{ whiteSpace: 'pre-wrap' }}>{children}</div></div>;
  return (
    <Modal grande titulo={`Roteiro de abordagem${empresa ? `: ${empresa}` : ''}`} onClose={onClose} rodape={<button className="btn prim" onClick={onClose}>Fechar</button>}>
      <div className="stack">
        {epoca.data && <div className="aviso info small"><strong>Época: {epoca.data.tema}.</strong> {epoca.data.dica}</div>}
        <div className="grid g2">
          <Bloco t="Quem decide">{r.quem}</Bloco>
          <Bloco t="Porta de entrada">{r.porta}</Bloco>
        </div>
        <Bloco t="1. Ligação para a porta de entrada (descobrir quem decide)"><div className="card small" style={{ padding: 12 }}>{r.secretaria}</div></Bloco>
        <Bloco t="2. Abertura com quem decide"><div className="card small" style={{ padding: 12 }}>{r.abertura}</div></Bloco>
        <Bloco t="3. Perguntas para entender a carteira"><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{r.perguntas.map((q) => <li key={q}>{q}</li>)}</ul></Bloco>
        <Bloco t="4. Fechamento"><div className="card small" style={{ padding: 12 }}>{r.fechamento}</div></Bloco>
        <div className="stack" style={{ gap: 6 }}>
          <strong>Objeções e respostas</strong>
          <table className="small"><tbody>{r.objecoes.map(([o, resp]) => <tr key={o}><td style={{ width: '32%', verticalAlign: 'top' }}><strong>{o}</strong></td><td>{resp}</td></tr>)}</tbody></table>
        </div>
        <span className="small muted">Depois: anote nome e cargo de quem decide no contato e siga a cadência (dias 3, 7 e 14). Fale com até 15 empresas por dia, com calma: qualidade rende mais que volume.</span>
      </div>
    </Modal>
  );
}

/** Registrar abordagem feita por WhatsApp ou ligação: o contato sai da lista e vira lead. */
function RegistrarAbordagem({ p, canalInicial, onClose, onFeito }) {
  const [canal, setCanal] = useState(canalInicial || 'WHATSAPP');
  const [obs, setObs] = useState('');
  const { executar, enviando } = useExecutar();
  const salvar = async () => {
    try { await executar('registrarAbordagemProspect', { id: p.id, canal, observacao: obs }, 'Abordagem registrada: o contato foi para "Pedidos e contatos"'); onFeito(); onClose(); } catch { /* aviso já mostrado */ }
  };
  return (
    <Modal titulo={`Registrar abordagem: ${p.empresa}`} onClose={onClose} rodape={<><button className="btn" onClick={onClose}>Ainda não abordei</button><button className="btn prim" disabled={enviando} onClick={salvar}>Registrar</button></>}>
      <div className="stack">
        <div className="campo"><label>Como foi o contato</label><select value={canal} onChange={(e) => setCanal(e.target.value)}><option value="WHATSAPP">WhatsApp</option><option value="TELEFONE">Ligação</option><option value="EMAIL">E-mail enviado por fora do sistema</option></select></div>
        <div className="campo"><label>Anotação (opcional)</label><textarea rows={3} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: falei com a secretária, pediu para enviar a apresentação ao financeiro" /></div>
        <p className="small muted" style={{ margin: 0 }}>Ao registrar, o contato sai da Lista do dia e vira um lead em "Pedidos e contatos", com a anotação e a fonte.</p>
      </div>
    </Modal>
  );
}

/** Lista do dia: contatos encontrados pela busca diária que ainda não foram abordados. */
function ListaDoDia({ recarregar, onMudou, onEmail }) {
  const [r, setR] = useState(0);
  const [info, setInfo] = useState(null);
  const [registrar, setRegistrar] = useState(null);
  const [roteiroDe, setRoteiroDe] = useState(null);
  const { executar } = useExecutar();
  const toast = useToast();
  const mudou = () => { setR(r + 1); onMudou(); };
  const whatsapp = async (p) => {
    const janela = window.open('about:blank', '_blank');
    try { const w = await hs('whatsappProspect', { id: p.id }); if (janela && !janela.closed) janela.location.replace(w.link); else window.open(w.link, '_blank', 'noopener'); setRegistrar({ p, canal: 'WHATSAPP' }); } catch (e) { janela?.close(); toast.erro(e); }
  };
  const descartar = async (p) => {
    const motivo = window.prompt(`Descartar ${p.empresa} da lista? Informe o motivo (opcional):`, 'Não é o perfil');
    if (motivo === null) return;
    try { await executar('descartarProspect', { id: p.id, motivo }, 'Contato descartado'); mudou(); } catch { /* aviso já mostrado */ }
  };
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>
        Empresas com contato público (site, diretórios) encontradas todos os dias. Quem não foi abordado continua aqui; ao abordar por e-mail, WhatsApp ou ligação, o contato sai da lista e vira lead em "Pedidos e contatos".
        {info ? <> <strong>{info.total} para abordar{info.novos_hoje ? `, ${info.novos_hoje} novo(s) hoje` : ''}.</strong></> : null}
      </p>
      {info?.epoca && <div className="aviso info small"><strong>Época: {info.epoca.tema}.</strong> {info.epoca.dica} Os segmentos prioritários aparecem primeiro, marcados com <em>prioridade</em>.</div>}
      <Tabela acao="listarProspects" recarregar={recarregar + r} aoCarregar={setInfo} filtros={[{ nome: 'segmento', rotulo: 'Segmento', opcoes: Object.entries(SEGMENTOS_PROSPECT).map(([valor, rotulo]) => ({ valor, rotulo })) }]} colunas={[
        { titulo: 'Encontrado', render: (p) => <>{(p.lote || '').split('-').reverse().join('/')}{info && p.lote === new Date().toISOString().slice(0, 10) && <div><Badge status="info">novo</Badge></div>}{p.prioridade && <div><Badge status="PENDENTE">prioridade</Badge></div>}</> },
        { titulo: 'Empresa', render: (p) => <><strong>{p.empresa}</strong><div className="small muted">{SEGMENTOS_PROSPECT[p.segmento] || '—'}{p.bairro || p.cidade ? ` · ${[p.bairro, p.cidade].filter(Boolean).join(', ')}` : ''}</div>{p.observacao && <div className="small muted">{p.observacao}</div>}</> },
        { titulo: 'Contato', render: (p) => <>{p.contato_nome && <div>{p.contato_nome}{p.contato_cargo ? <span className="small muted"> · {p.contato_cargo}</span> : ''}</div>}{p.email && <div className="small">{p.email}</div>}{(p.whatsapp || p.telefone) && <div className="small">{mascaraFone(p.whatsapp || p.telefone)}{p.whatsapp ? ' (WhatsApp)' : ''}</div>}<div className="small">{p.site && <a href={p.site} target="_blank" rel="noreferrer">site</a>}{p.site && ' · '}<a href={p.fonte_url} target="_blank" rel="noreferrer">fonte</a></div></> },
        { titulo: 'Abordar', render: (p) => (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {p.email && <button className="btn sm prim" onClick={() => onEmail(p)}>E-mail</button>}
            {(p.whatsapp || p.telefone) && <button className="btn sm" onClick={() => whatsapp(p)}>WhatsApp</button>}
            {p.telefone && <button className="btn sm" onClick={() => setRegistrar({ p, canal: 'TELEFONE' })}>Liguei</button>}
            <button className="btn sm" title="Já abordei por outro meio" onClick={() => setRegistrar({ p })}>Registrar</button>
            <button className="btn sm" onClick={() => setRoteiroDe(p)}>Roteiro</button>
            <button className="btn sm" onClick={() => descartar(p)}>Descartar</button>
          </div>
        ) },
      ]} vazio={<Vazio titulo="Nenhum contato para abordar">A busca diária adiciona novos contatos toda manhã. Os já abordados estão em "Pedidos e contatos".</Vazio>} />
      {roteiroDe && <RoteiroModal segmento={roteiroDe.segmento} empresa={roteiroDe.empresa} onClose={() => setRoteiroDe(null)} />}
      {registrar && <RegistrarAbordagem p={registrar.p} canalInicial={registrar.canal} onClose={() => setRegistrar(null)} onFeito={mudou} />}
    </div>
  );
}

/** Programa de indicação: parceiros (ex.: contadores) com link próprio e controle das comissões pagas. */
function Parceiros() {
  const { data, carregando, recarregar } = useApi('listarParceiros', {});
  const [ed, setEd] = useState(null);
  const [ver, setVer] = useState(null);
  const { executar, enviando } = useExecutar();
  const toast = useToast();
  const copiar = (t, msg) => { try { navigator.clipboard.writeText(t).then(() => toast.ok(msg), () => window.prompt('Copie:', t)); } catch { window.prompt('Copie:', t); } };
  const salvar = async () => { try { await executar('salvarParceiro', ed, 'Parceiro salvo'); setEd(null); recarregar(); } catch { /* aviso já mostrado */ } };
  const set = (k) => (e) => setEd({ ...ed, [k]: e.target.value });
  if (carregando && !data) return <Carregando />;
  return (
    <div className="stack">
      <div className="row between">
        <p className="small muted" style={{ margin: 0, maxWidth: '75ch' }}>Cada parceiro tem um link próprio para o diagnóstico gratuito. Quem pedir pelo link fica marcado como indicado por ele. Contadores são os melhores parceiros: cada escritório atende dezenas de empresas.</p>
        <button className="btn prim" onClick={() => setEd({ nome: '', empresa: '', email: '', whatsapp: '', tipo: 'CONTABILIDADE', regra_comissao: '', chave_pix: '', status: 'ATIVO', observacoes: '' })}>Novo parceiro</button>
      </div>
      {(data || []).length ? (
        <table><thead><tr><th>Parceiro</th><th>Link de indicação</th><th className="num">Indicados</th><th className="num">Viraram clientes</th><th className="num">Comissões pagas</th><th /></tr></thead><tbody>
          {data.map((p) => (
            <tr key={p.id}>
              <td><strong>{p.nome}</strong>{p.status === 'INATIVO' && <> <Badge status="CANCELADA">Inativo</Badge></>}<div className="small muted">{p.empresa}{p.whatsapp ? ` · ${mascaraFone(p.whatsapp)}` : ''}</div></td>
              <td><div className="small" style={{ wordBreak: 'break-all' }}>{p.link}</div><div className="row" style={{ gap: 4, marginTop: 4 }}><button className="btn sm" onClick={() => copiar(p.link, 'Link copiado')}>Copiar link</button><button className="btn sm" onClick={() => copiar(p.texto_divulgacao, 'Texto copiado: o parceiro pode repassar aos clientes')}>Copiar texto para divulgar</button>{p.whatsapp && <a className="btn sm" target="_blank" rel="noreferrer" href={`https://wa.me/${p.whatsapp.length <= 11 ? '55' : ''}${p.whatsapp}?text=${encodeURIComponent(`Olá, ${p.nome.split(' ')[0]}! Segue o seu link de indicação da Acorly: ${p.link}\n\nTexto pronto para repassar aos seus clientes:\n\n${p.texto_divulgacao}`)}`}>Enviar ao parceiro</a>}</div></td>
              <td className="num">{p.indicados}</td><td className="num">{p.convertidos}</td><td className="num">{brl(p.pago_centavos)}</td>
              <td><div className="row" style={{ gap: 4 }}><button className="btn sm" onClick={() => setVer(p)}>Indicações</button><button className="btn sm" onClick={() => setEd({ ...p })}>Editar</button></div></td>
            </tr>
          ))}
        </tbody></table>
      ) : <Vazio titulo="Nenhum parceiro ainda">Cadastre o primeiro contador parceiro. A Lista do dia traz escritórios de contabilidade para abordar, com o modelo de e-mail "Contadores (parceria)".</Vazio>}
      {ed && (
        <Modal grande titulo={ed.id ? `Editar ${ed.nome}` : 'Novo parceiro'} onClose={() => setEd(null)} rodape={<><button className="btn" onClick={() => setEd(null)}>Cancelar</button><button className="btn prim" disabled={enviando} onClick={salvar}>Salvar</button></>}>
          <div className="stack">
            <div className="form-grid">
              <div className="campo"><label>Nome *</label><input value={ed.nome} onChange={set('nome')} /></div>
              <div className="campo"><label>Escritório/empresa</label><input value={ed.empresa} onChange={set('empresa')} /></div>
              <div className="campo"><label>E-mail</label><input type="email" value={ed.email} onChange={set('email')} /></div>
              <div className="campo"><label>WhatsApp</label><input value={ed.whatsapp} onChange={set('whatsapp')} /></div>
              <div className="campo"><label>Tipo</label><select value={ed.tipo} onChange={set('tipo')}><option value="CONTABILIDADE">Escritório de contabilidade</option><option value="OUTRO">Outro</option></select></div>
              <div className="campo"><label>Código do link</label><input value={ed.codigo || ''} onChange={set('codigo')} placeholder="Gerado pelo nome do escritório" /></div>
              <div className="campo"><label>Chave Pix (para pagar a comissão)</label><input value={ed.chave_pix} onChange={set('chave_pix')} /></div>
              <div className="campo"><label>Situação</label><select value={ed.status} onChange={set('status')}><option value="ATIVO">Ativo</option><option value="INATIVO">Inativo (o link para de valer)</option></select></div>
            </div>
            <div className="campo"><label>Regra de comissão combinada</label><textarea rows={2} value={ed.regra_comissao} onChange={set('regra_comissao')} placeholder="Se vazio: 10% do valor que a HS receber do cliente indicado nos primeiros 12 meses, pago até o dia 10 do mês seguinte ao recebimento." /></div>
            <div className="campo"><label>Anotações</label><textarea rows={2} value={ed.observacoes} onChange={set('observacoes')} /></div>
          </div>
        </Modal>
      )}
      {ver && <IndicacoesParceiro p={ver} onClose={() => setVer(null)} onMudou={recarregar} />}
    </div>
  );
}

function IndicacoesParceiro({ p, onClose, onMudou }) {
  const { data, recarregar } = useApi('indicacoesDoParceiro', { id: p.id });
  const [pg, setPg] = useState({ lead_id: '', valor: '', pago_em: new Date().toISOString().slice(0, 10), descricao: '' });
  const { executar, enviando } = useExecutar();
  const pagar = async () => {
    try { await executar('registrarPagamentoParceiro', { parceiro_id: p.id, ...pg, lead_id: pg.lead_id || undefined }, 'Pagamento registrado'); setPg({ ...pg, valor: '', descricao: '' }); recarregar(); onMudou(); } catch { /* aviso já mostrado */ }
  };
  return (
    <Modal grande titulo={`Indicações de ${p.nome}`} onClose={onClose} rodape={<button className="btn prim" onClick={onClose}>Fechar</button>}>
      <div className="stack">
        <div className="aviso info small"><strong>Regra combinada:</strong> {p.regra_comissao}{p.chave_pix ? <> · <strong>Pix:</strong> {p.chave_pix}</> : ''}</div>
        <h3 style={{ margin: 0 }}>Empresas indicadas</h3>
        {(data?.leads || []).length ? <table className="small"><thead><tr><th>Empresa</th><th>Recebido</th><th>Situação</th></tr></thead><tbody>{data.leads.map((l) => <tr key={l.id}><td>{l.empresa}</td><td>{dataHora(l.recebido_em)}</td><td><Badge status={TOM[l.status]}>{STATUS[l.status]}</Badge></td></tr>)}</tbody></table> : <span className="small muted">Nenhuma indicação ainda.</span>}
        <h3 style={{ margin: 0 }}>Comissões pagas</h3>
        {(data?.pagamentos || []).length ? <table className="small"><thead><tr><th>Data</th><th>Descrição</th><th className="num">Valor</th></tr></thead><tbody>{data.pagamentos.map((x) => <tr key={x.id}><td>{(x.pago_em || '').split('-').reverse().join('/')}</td><td>{x.descricao || '—'}</td><td className="num">{brl(x.valor_centavos)}</td></tr>)}</tbody></table> : <span className="small muted">Nenhum pagamento registrado.</span>}
        <div className="card stack" style={{ gap: 6 }}>
          <strong>Registrar comissão paga</strong>
          <div className="form-grid">
            <div className="campo"><label>Cliente indicado</label><select value={pg.lead_id} onChange={(e) => setPg({ ...pg, lead_id: e.target.value })}><option value="">—</option>{(data?.leads || []).map((l) => <option key={l.id} value={l.id}>{l.empresa}</option>)}</select></div>
            <div className="campo"><label>Valor (R$)</label><input value={pg.valor} onChange={(e) => setPg({ ...pg, valor: e.target.value })} placeholder="150,00" /></div>
            <div className="campo"><label>Data do pagamento</label><input type="date" value={pg.pago_em} onChange={(e) => setPg({ ...pg, pago_em: e.target.value })} /></div>
            <div className="campo"><label>Descrição</label><input value={pg.descricao} onChange={(e) => setPg({ ...pg, descricao: e.target.value })} placeholder="Ex.: comissão de novembro" /></div>
          </div>
          <div><button className="btn prim sm" disabled={enviando || !pg.valor} onClick={pagar}>Registrar pagamento</button></div>
        </div>
      </div>
    </Modal>
  );
}

const STATUS_CAMPANHA = { AGUARDANDO: ['Aguardando a vez', 'PENDENTE'], ATIVA: ['Enviando', 'info'], PAUSADA: ['Pausada', 'PENDENTE'], CONCLUIDA: ['Concluída', 'ATIVA'], CANCELADA: ['Cancelada', 'CANCELADA'] };
const STATUS_DEST = { PENDENTE: ['Na fila', 'PENDENTE'], ENVIADO: ['Enviado', 'ATIVA'], FALHA: ['Falhou', 'CANCELADA'], IGNORADO: ['Não enviado', 'CANCELADA'] };

/** Disparo de e-mail marketing a partir de planilha (fila diária, até 50 por dia). */
function Campanhas({ onMudou }) {
  const { data, carregando, recarregar } = useApi('listarCampanhas', {});
  const [nova, setNova] = useState(false);
  const [ver, setVer] = useState(null);
  const { executar, enviando } = useExecutar();
  const acao = (nome, dados, msg) => executar(nome, dados, msg).then(() => { recarregar(); onMudou(); }).catch(() => {});
  if (carregando && !data) return <Carregando />;
  return (
    <div className="stack">
      <div className="row between">
        <p className="small muted" style={{ margin: 0, maxWidth: '78ch' }}>
          Envie uma planilha com e-mails de empresas e escolha o modelo. O sistema confere a lista e envia aos poucos: até {data?.limite_diario || 50} e-mails por dia, em lotes de hora em hora no horário comercial, para proteger o domínio. Uma campanha por vez: a próxima começa sozinha quando a anterior termina. Cada destinatário vira um contato com follow-up.
          {data && <> <strong>Hoje: {data.enviados_hoje} de {data.limite_diario} e-mails usados.</strong></>}
        </p>
        <button className="btn prim" onClick={() => setNova(true)}>Nova campanha</button>
      </div>
      {(data?.itens || []).length ? (
        <table><thead><tr><th>Campanha</th><th>Progresso</th><th className="num">Na fila</th><th className="num">Pediram para sair</th><th>Situação</th><th /></tr></thead><tbody>
          {data.itens.map((c) => {
            const feito = c.enviados + c.falhas + c.ignorados;
            const tot = Math.max(1, feito + c.pendentes);
            return (
              <tr key={c.id}>
                <td><strong>{c.nome}</strong><div className="small muted">{c.modelo_nome} · {dataHora(c.criada_em)}{c.arquivo_nome ? ` · ${c.arquivo_nome}` : ''}</div></td>
                <td style={{ minWidth: 180 }}>
                  <div style={{ background: 'var(--borda)', borderRadius: 99, height: 8, overflow: 'hidden' }}><div style={{ width: `${Math.round((feito / tot) * 100)}%`, background: 'var(--azul)', height: 8 }} /></div>
                  <div className="small muted">{c.enviados} enviado(s){c.falhas ? ` · ${c.falhas} falha(s)` : ''}{c.ignorados ? ` · ${c.ignorados} não enviado(s)` : ''}</div>
                </td>
                <td className="num">{c.pendentes}{c.pendentes && ['ATIVA', 'AGUARDANDO'].includes(c.status) ? <div className="small muted">≈ {c.dias_restantes} dia(s){c.status === 'AGUARDANDO' ? ' depois de começar' : ''}</div> : null}</td>
                <td className="num">{c.sairam}</td>
                <td><Badge status={STATUS_CAMPANHA[c.status][1]}>{STATUS_CAMPANHA[c.status][0]}</Badge>{c.posicao_fila ? <div className="small muted">{c.posicao_fila === 1 ? 'em andamento' : `${c.posicao_fila}º na fila`}</div> : null}</td>
                <td><div className="row" style={{ gap: 4 }}>
                  <button className="btn sm" onClick={() => setVer(c)}>Destinatários</button>
                  {c.status === 'ATIVA' && c.pendentes > 0 && <button className="btn sm" disabled={enviando} onClick={() => acao('enviarLoteCampanha', { id: c.id }, 'Lote enviado')}>Enviar próximo lote</button>}
                  {c.status === 'ATIVA' && <button className="btn sm" disabled={enviando} onClick={() => acao('alterarCampanha', { id: c.id, acao: 'pausar' }, 'Campanha pausada')}>Pausar</button>}
                  {c.status === 'PAUSADA' && <button className="btn sm" disabled={enviando} onClick={() => acao('alterarCampanha', { id: c.id, acao: 'retomar' }, 'Campanha retomada')}>Retomar</button>}
                  {['ATIVA', 'PAUSADA', 'AGUARDANDO'].includes(c.status) && <button className="btn sm" disabled={enviando} onClick={() => { if (window.confirm(`Cancelar a campanha "${c.nome}"? Os ${c.pendentes} e-mail(s) que ainda estão na fila não serão enviados.`)) acao('alterarCampanha', { id: c.id, acao: 'cancelar' }, 'Campanha cancelada'); }}>Cancelar</button>}
                </div></td>
              </tr>
            );
          })}
        </tbody></table>
      ) : <Vazio titulo="Nenhuma campanha ainda">Clique em "Nova campanha" e envie uma planilha (CSV ou Excel) com os e-mails das empresas.</Vazio>}
      {nova && <NovaCampanha onClose={() => setNova(false)} onCriada={() => { setNova(false); recarregar(); onMudou(); }} />}
      {ver && <DestinatariosCampanha c={ver} onClose={() => setVer(null)} />}
    </div>
  );
}

function NovaCampanha({ onClose, onCriada }) {
  const modelos = useApi('listarModelosComerciais', {});
  const epoca = useApi('epocaComercial', {});
  const [nome, setNome] = useState('');
  const [modeloId, setModeloId] = useState('');
  const [arquivo, setArquivo] = useState(null);
  const [lidos, setLidos] = useState(null);
  const [previa, setPrevia] = useState(null);
  const [amostra, setAmostra] = useState(0);
  const [lendo, setLendo] = useState(false);
  const { executar, enviando } = useExecutar();
  const toast = useToast();
  const ativos = (modelos.data || []).filter((m) => m.ativo !== false);
  useEffect(() => {
    if (!modeloId && ativos.length && (epoca.data || epoca.erro)) setModeloId((ativos.find((m) => m.nome === 'Piloto Sem Risco') || (epoca.data?.decimo_terceiro && ativos.find((m) => m.nome.startsWith('13º'))) || ativos[0]).id);
  }, [ativos.length, epoca.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!lidos?.contatos.length || !modeloId) return;
    setPrevia(null);
    hs('previaCampanha', { contatos: lidos.contatos, modelo_id: modeloId }).then((p) => { setPrevia(p); setAmostra(0); }).catch((e) => toast.erro(e));
  }, [lidos, modeloId]); // eslint-disable-line react-hooks/exhaustive-deps
  const escolher = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setArquivo(f); setLidos(null); setPrevia(null); setLendo(true);
    try {
      const r = contatosDaPlanilha(await lerPlanilha(f));
      if (!r.colunas.email) throw new Error('Não encontrei a coluna de e-mail. Use um cabeçalho "email" (veja o modelo de planilha).');
      if (!r.contatos.length) throw new Error('A planilha não tem contatos.');
      setLidos(r);
      if (!nome) setNome(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 80));
    } catch (err) { toast.erro(err); setArquivo(null); } finally { setLendo(false); e.target.value = ''; }
  };
  const criar = async () => {
    try {
      const r = await executar('criarCampanha', { nome, modelo_id: modeloId, contatos: lidos.contatos, arquivo_nome: arquivo?.name }, null);
      toast.ok(r.aguardando ? `Campanha criada: ${r.posicao}ª da fila. Ela começa quando as anteriores terminarem.` : `Campanha criada: ${r.enviados_agora} e-mail(s) enviado(s) agora, ${r.na_fila - r.enviados_agora} na fila.`);
      onCriada();
    } catch { /* aviso já mostrado */ }
  };
  const a = previa?.amostra?.[amostra];
  return (
    <Modal grande titulo="Nova campanha por planilha" onClose={onClose} rodape={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn prim" disabled={enviando || !previa?.validos || nome.trim().length < 3} onClick={criar}>{previa?.validos ? `Iniciar campanha (${previa.validos} e-mail${previa.validos > 1 ? 's' : ''})` : 'Iniciar campanha'}</button></>}>
      <div className="stack">
        <div className="form-grid">
          <div className="campo"><label>Planilha (CSV ou Excel .xlsx)</label><input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={escolher} /><span className="small muted">Colunas: <strong>email</strong> (obrigatória), empresa, nome, segmento, whatsapp. <button type="button" className="btn link small" onClick={() => { try { baixarArquivo('modelo-campanha-acorly.csv', '\uFEFF' + MODELO_PLANILHA_CAMPANHA, 'text/csv;charset=utf-8'); } catch (err) { toast.erro(err); } }}>Baixar modelo de planilha</button></span></div>
          <div className="campo"><label>Modelo de e-mail</label><select value={modeloId} onChange={(e) => setModeloId(e.target.value)}>{ativos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</select><span className="small muted">Para ajustar o texto, edite o modelo na aba "Modelos de e-mail".</span></div>
          <div className="campo"><label>Nome da campanha</label><input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Escolas de Salvador, novembro" /></div>
        </div>
        {lendo && <Carregando />}
        {lidos && (
          <div className="small muted">
            {lidos.contatos.length} linha(s) lida(s) de {arquivo?.name}. Colunas usadas: e-mail = "{lidos.colunas.email}"{lidos.colunas.empresa ? `, empresa = "${lidos.colunas.empresa}"` : ', empresa pelo domínio do e-mail'}{lidos.colunas.nome ? `, nome = "${lidos.colunas.nome}"` : ''}{lidos.colunas.segmento ? `, segmento = "${lidos.colunas.segmento}"` : ''}.
          </div>
        )}
        {lidos && !previa && <Carregando />}
        {previa && (
          <>
            <div className="grid g4">
              <div className="card stat"><span className="rot">Serão enviados</span><span className="val" style={{ color: 'var(--ok)' }}>{previa.validos}</span></div>
              <div className="card stat"><span className="rot">Retirados da lista</span><span className="val">{previa.total_ignorados}</span></div>
              <div className="card stat"><span className="rot">Com erro</span><span className="val" style={{ color: previa.total_invalidos ? 'var(--critico)' : undefined }}>{previa.total_invalidos}</span></div>
              <div className="card stat"><span className="rot">Tempo de envio</span><span className="val">{previa.validos ? `${previa.dias_estimados} dia(s)` : '—'}</span></div>
            </div>
            <span className="small muted">Até {previa.limite_diario} por dia{previa.livres_hoje < previa.limite_diario ? ` (hoje ainda cabem ${previa.livres_hoje})` : ''}. Se não houver outra campanha em andamento, os 10 primeiros saem assim que você iniciar; senão, ela entra na fila e começa quando as anteriores terminarem. O envio segue de hora em hora, das 9h às 18h.</span>
            {previa.total_ignorados > 0 && <details className="small"><summary>Ver os {previa.total_ignorados} retirados (repetidos, pediram para sair, receberam há menos de 30 dias)</summary><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{previa.ignorados.map((x) => <li key={`${x.linha}${x.email}`}>Linha {x.linha}: {x.email} — {x.motivo}</li>)}</ul></details>}
            {previa.total_invalidos > 0 && <details className="small" open={previa.total_invalidos <= 5}><summary>Ver as {previa.total_invalidos} linhas com erro</summary><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{previa.invalidos.map((x) => <li key={`${x.linha}${x.email}`}>Linha {x.linha}: {x.email} — {x.motivo}</li>)}</ul></details>}
            {a && (
              <div className="stack" style={{ gap: 6 }}>
                <div className="row between"><strong className="small">Prévia: como {a.empresa} vai receber</strong><div className="row" style={{ gap: 4 }}>{previa.amostra.map((x, i) => <button key={x.email} className={`btn sm${i === amostra ? ' prim' : ''}`} onClick={() => setAmostra(i)}>{i + 1}</button>)}</div></div>
                <div className="small"><strong>Para:</strong> {a.email} · <strong>Assunto:</strong> {a.assunto}</div>
                <div className="previa-email" dangerouslySetInnerHTML={{ __html: a.html }} />
              </div>
            )}
          </>
        )}
        <span className="small muted">Use listas próprias (contatos públicos de empresas, Lista do dia, parceiros). Listas compradas trazem e-mails pessoais e armadilhas de spam e podem bloquear o domínio. Todo e-mail sai com a identificação da HS e o link "não quero mais receber".</span>
      </div>
    </Modal>
  );
}

function DestinatariosCampanha({ c, onClose }) {
  const [status, setStatus] = useState('');
  const { data, carregando } = useApi('destinatariosCampanha', { id: c.id, status: status || undefined }, [status]);
  return (
    <Modal grande titulo={`Destinatários: ${c.nome}`} onClose={onClose} rodape={<button className="btn prim" onClick={onClose}>Fechar</button>}>
      <div className="stack">
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 260 }}><option value="">Todos</option>{Object.entries(STATUS_DEST).map(([k, [t]]) => <option key={k} value={k}>{t}</option>)}</select>
        {carregando && !data ? <Carregando /> : (
          <table className="small"><thead><tr><th>E-mail</th><th>Empresa</th><th>Situação</th><th>Quando / motivo</th></tr></thead><tbody>
            {(data || []).map((d) => <tr key={d.id}><td>{d.email}</td><td>{d.empresa}{d.nome ? <div className="muted">{d.nome}</div> : null}</td><td><Badge status={STATUS_DEST[d.status][1]}>{STATUS_DEST[d.status][0]}</Badge></td><td>{d.enviado_em ? dataHora(d.enviado_em) : d.motivo || '—'}</td></tr>)}
          </tbody></table>
        )}
      </div>
    </Modal>
  );
}

export function Leads() {
  const [r, setR] = useState(0);
  const [aberto, setAberto] = useState(null);
  const [email, setEmail] = useState(null);
  const [aba, setAba] = useState('dia');
  const [infoLeads, setInfoLeads] = useState(null);
  const [prospect, setProspect] = useState(null);
  return (
    <div className="stack">
      <Cabecalho titulo="Diagnósticos e prospecção" sub="Lista do dia com empresas para abordar, pedidos de diagnóstico do site e contatos já abordados. Responda os pedidos em até 2 dias úteis, como prometido.">
        <button className="btn prim" onClick={() => setEmail({})}>Enviar e-mail marketing</button>
      </Cabecalho>
      <div className="card">
      <Abas ativa={aba} onChange={setAba} abas={[{ id: 'dia', rotulo: 'Lista do dia' }, { id: 'leads', rotulo: `Pedidos e contatos${infoLeads?.followups_hoje ? ` (${infoLeads.followups_hoje} follow-up hoje)` : ''}` }, { id: 'campanhas', rotulo: 'Campanhas por planilha' }, { id: 'parceiros', rotulo: 'Parceiros (indicação)' }, { id: 'modelos', rotulo: 'Modelos de e-mail' }]} />
      {aba === 'dia' ? <ListaDoDia recarregar={r} onMudou={() => setR(r + 1)} onEmail={setProspect} /> : aba === 'modelos' ? <Modelos /> : aba === 'parceiros' ? <Parceiros /> : aba === 'campanhas' ? <Campanhas onMudou={() => setR(r + 1)} /> : <Tabela acao="listarLeads" recarregar={r} aoCarregar={setInfoLeads} filtros={[{ nome: 'status', rotulo: 'Situação', opcoes: Object.keys(STATUS) }, { nome: 'followup', rotulo: 'Follow-up', opcoes: [{ valor: 'HOJE', rotulo: 'Para hoje (e atrasados)' }, { valor: 'ATIVA', rotulo: 'Com cadência ativa' }] }]} colunas={[
        { titulo: 'Recebido', render: (l) => dataHora(l.recebido_em) },
        { titulo: 'Empresa', render: (l) => <button className="btn link" onClick={() => setAberto(l)}><strong>{l.empresa}</strong></button> },
        { titulo: 'Contato', render: (l) => <><div>{l.nome}</div><div className="small muted">{l.email}{l.whatsapp ? ` · ${mascaraFone(l.whatsapp)}` : ''}</div>{l.origem === 'PROSPECCAO' && <div className="small" style={{ color: 'var(--azul)' }}>Abordado por e-mail{l.ultimo_email_em ? ` · ${dataHora(l.ultimo_email_em)}` : ''}</div>}</> },
        { titulo: 'Segmento', render: (l) => SEGMENTOS[l.segmento] || '—' },
        { titulo: 'Carteira', num: true, render: (l) => (l.analise ? <>{brl(l.analise.vencido_centavos)}<div className="small muted">{l.analise.devedores} devedor(es)</div></> : l.valor_aberto_centavos ? <span className="muted">≈ {brl(l.valor_aberto_centavos)}</span> : '—') },
        { titulo: 'Situação', render: (l) => <Badge status={TOM[l.status]}>{STATUS[l.status]}</Badge> },
        { titulo: 'Próximo follow-up', render: (l) => (l.proximo_followup && !['CONVERTIDO', 'PERDIDO', 'DIAGNOSTICO_ENVIADO'].includes(l.status)
          ? <>{infoLeads?.hoje && l.proximo_followup <= infoLeads.hoje ? <Badge status="PENDENTE">{l.proximo_followup === infoLeads.hoje ? 'hoje' : 'atrasado'}</Badge> : l.proximo_followup.split('-').reverse().join('/')}<div className="small muted">{Number(l.cadencia_etapa || 0) + 1}º de 3</div></>
          : <span className="muted">—</span>) },
        { titulo: '', render: (l) => <button className="btn sm" onClick={() => setAberto(l)}>Abrir</button> },
      ]} vazio={<Vazio titulo="Nenhum pedido ainda">Os pedidos feitos em acorly.com.br/diagnostico e os contatos abordados por e-mail aparecem aqui.</Vazio>} />}
      </div>
      {aberto && <Detalhe lead={aberto} onClose={() => setAberto(null)} onFeito={() => setR(r + 1)} onEmail={(l) => setEmail(l)} />}
      {email && <Abordar lead={email.id ? email : null} onClose={() => setEmail(null)} onFeito={() => setR(r + 1)} />}
      {prospect && <Abordar lead={null} prospect={prospect} onClose={() => setProspect(null)} onFeito={() => setR(r + 1)} />}
    </div>
  );
}
