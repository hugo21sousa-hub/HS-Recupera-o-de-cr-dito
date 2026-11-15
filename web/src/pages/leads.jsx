// Pedidos de diagnóstico gratuito (leads do site): acompanhamento comercial da equipe.
import { useEffect, useState } from 'react';
import { hs, abrirLink } from '../api.js';
import { Tabela, Badge, Cabecalho, Modal, Vazio, Abas, Carregando, useApi, useExecutar, useToast } from '../ui.jsx';
import { brl, dataHora, mascaraFone, mascaraDoc, pct } from '../format.js';

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

/** Envio de e-mail de apresentação (prospecção), com prévia. */
function Abordar({ lead, prospect, onClose, onFeito }) {
  const modelos = useApi('listarModelosComerciais', {});
  const base = lead || (prospect ? { email: prospect.email, nome: prospect.contato_nome, empresa: prospect.empresa, segmento: prospect.segmento === 'CONTABILIDADE' ? 'SERVICOS' : prospect.segmento, whatsapp: prospect.whatsapp || prospect.telefone } : null);
  const [v, setV] = useState({ para: base?.email || '', nome: base?.nome || '', empresa: base?.empresa || '', segmento: base?.segmento || '', whatsapp: base?.whatsapp || '', modelo_id: '', assunto: '', corpo: '' });
  const [previa, setPrevia] = useState(null);
  const [editar, setEditar] = useState(false);
  const { executar, enviando } = useExecutar();
  const [editado, setEditado] = useState(false);
  const set = (k) => (e) => { if (k === 'assunto' || k === 'corpo') setEditado(true); setV({ ...v, [k]: e.target.value }); };
  const ativos = (modelos.data || []).filter((m) => m.ativo !== false);
  const modeloDoSegmento = (seg) => ativos.find((x) => x.nome === (seg === 'ESCOLA_CURSO' ? 'Escolas e cursos' : seg === 'SAUDE' ? 'Clínicas e consultórios' : 'Apresentação dos serviços'));
  const travado = !!lead || !!prospect;
  const mudarSegmento = (e) => {
    const seg = e.target.value;
    const m = !editado && !lead?.ultimo_email_em ? modeloDoSegmento(seg) : null;
    setV({ ...v, segmento: seg, ...(m ? { modelo_id: m.id, assunto: m.assunto, corpo: m.corpo } : {}) });
  };
  useEffect(() => {
    if (!v.modelo_id && ativos.length) {
      const m = ativos.find((x) => (lead?.status === 'EM_CONTATO' && lead?.ultimo_email_em ? x.nome.startsWith('Retorno') : false)) || ativos.find((x) => x.nome === (v.segmento === 'ESCOLA_CURSO' ? 'Escolas e cursos' : v.segmento === 'SAUDE' ? 'Clínicas e consultórios' : 'Apresentação dos serviços')) || ativos[0];
      setV((x) => ({ ...x, modelo_id: m.id, assunto: m.assunto, corpo: m.corpo }));
    }
  }, [ativos.length]); // eslint-disable-line react-hooks/exhaustive-deps
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
    <Modal grande titulo={base ? `E-mail para ${base.empresa}` : 'Nova abordagem por e-mail'} onClose={onClose} rodape={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn prim" disabled={enviando || !v.para || !v.empresa} onClick={enviar}>Enviar e-mail</button></>}>
      <div className="stack">
        <div className="form-grid">
          <div className="campo"><label>E-mail do contato *</label><input type="email" value={v.para} onChange={set('para')} disabled={travado} /></div>
          <div className="campo"><label>Nome do contato</label><input value={v.nome} onChange={set('nome')} /></div>
          <div className="campo"><label>Empresa *</label><input value={v.empresa} onChange={set('empresa')} /></div>
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

function Detalhe({ lead, onClose, onFeito, onEmail }) {
  const envios = useApi('enviosDoLead', { lead_id: lead.id });
  const [status, setStatus] = useState(lead.status);
  const [obs, setObs] = useState(lead.observacoes || '');
  const { executar, enviando } = useExecutar();
  const toast = useToast();
  const salvar = async () => {
    try { await executar('atualizarLead', { id: lead.id, status, observacoes: obs }, 'Pedido atualizado'); onFeito(); onClose(); } catch { /* aviso já mostrado */ }
  };
  const nome = lead.nome.split(' ')[0];
  const textoWhats = `Olá, ${nome}! Aqui é da HS Recuperação de Crédito (Acorly). Recebemos o seu pedido de diagnóstico da carteira da ${lead.empresa}. Podemos conversar sobre o resultado?`;
  return (
    <Modal grande titulo={lead.empresa} onClose={onClose} rodape={<><button className="btn" onClick={onClose}>Fechar</button><button className="btn prim" disabled={enviando} onClick={salvar}>Salvar</button></>}>
      <div className="stack">
        <div className="grid g2">
          <div className="stack" style={{ gap: 4 }}>
            <strong>{lead.nome}</strong>
            <a href={`mailto:${lead.email}`}>{lead.email}</a>
            {lead.whatsapp && <a href={`https://wa.me/${lead.whatsapp.length <= 11 ? '55' : ''}${lead.whatsapp}?text=${encodeURIComponent(textoWhats)}`} target="_blank" rel="noreferrer">WhatsApp {mascaraFone(lead.whatsapp)}</a>}
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
        <div className="form-grid">
          <div className="campo"><label>Situação</label><select value={status} onChange={(e) => setStatus(e.target.value)}>{Object.entries(STATUS).map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select></div>
        </div>
        <div className="campo"><label>Anotações da equipe</label><textarea rows={4} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Contatos feitos, proposta enviada, próximos passos…" /></div>
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
      <Tabela acao="listarProspects" recarregar={recarregar + r} aoCarregar={setInfo} filtros={[{ nome: 'segmento', rotulo: 'Segmento', opcoes: Object.entries(SEGMENTOS_PROSPECT).map(([valor, rotulo]) => ({ valor, rotulo })) }]} colunas={[
        { titulo: 'Encontrado', render: (p) => <>{(p.lote || '').split('-').reverse().join('/')}{info && p.lote === new Date().toISOString().slice(0, 10) && <div><Badge status="info">novo</Badge></div>}</> },
        { titulo: 'Empresa', render: (p) => <><strong>{p.empresa}</strong><div className="small muted">{SEGMENTOS_PROSPECT[p.segmento] || '—'}{p.bairro || p.cidade ? ` · ${[p.bairro, p.cidade].filter(Boolean).join(', ')}` : ''}</div>{p.observacao && <div className="small muted">{p.observacao}</div>}</> },
        { titulo: 'Contato', render: (p) => <>{p.contato_nome && <div>{p.contato_nome}</div>}{p.email && <div className="small">{p.email}</div>}{(p.whatsapp || p.telefone) && <div className="small">{mascaraFone(p.whatsapp || p.telefone)}{p.whatsapp ? ' (WhatsApp)' : ''}</div>}<div className="small">{p.site && <a href={p.site} target="_blank" rel="noreferrer">site</a>}{p.site && ' · '}<a href={p.fonte_url} target="_blank" rel="noreferrer">fonte</a></div></> },
        { titulo: 'Abordar', render: (p) => (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {p.email && <button className="btn sm prim" onClick={() => onEmail(p)}>E-mail</button>}
            {(p.whatsapp || p.telefone) && <button className="btn sm" onClick={() => whatsapp(p)}>WhatsApp</button>}
            {p.telefone && <button className="btn sm" onClick={() => setRegistrar({ p, canal: 'TELEFONE' })}>Liguei</button>}
            <button className="btn sm" title="Já abordei por outro meio" onClick={() => setRegistrar({ p })}>Registrar</button>
            <button className="btn sm" onClick={() => descartar(p)}>Descartar</button>
          </div>
        ) },
      ]} vazio={<Vazio titulo="Nenhum contato para abordar">A busca diária adiciona novos contatos toda manhã. Os já abordados estão em "Pedidos e contatos".</Vazio>} />
      {registrar && <RegistrarAbordagem p={registrar.p} canalInicial={registrar.canal} onClose={() => setRegistrar(null)} onFeito={mudou} />}
    </div>
  );
}

export function Leads() {
  const [r, setR] = useState(0);
  const [aberto, setAberto] = useState(null);
  const [email, setEmail] = useState(null);
  const [aba, setAba] = useState('dia');
  const [prospect, setProspect] = useState(null);
  return (
    <div className="stack">
      <Cabecalho titulo="Diagnósticos e prospecção" sub="Lista do dia com empresas para abordar, pedidos de diagnóstico do site e contatos já abordados. Responda os pedidos em até 2 dias úteis, como prometido.">
        <button className="btn prim" onClick={() => setEmail({})}>Nova abordagem por e-mail</button>
      </Cabecalho>
      <div className="card">
      <Abas ativa={aba} onChange={setAba} abas={[{ id: 'dia', rotulo: 'Lista do dia' }, { id: 'leads', rotulo: 'Pedidos e contatos' }, { id: 'modelos', rotulo: 'Modelos de e-mail' }]} />
      {aba === 'dia' ? <ListaDoDia recarregar={r} onMudou={() => setR(r + 1)} onEmail={setProspect} /> : aba === 'modelos' ? <Modelos /> : <Tabela acao="listarLeads" recarregar={r} filtros={[{ nome: 'status', rotulo: 'Situação', opcoes: Object.keys(STATUS) }]} colunas={[
        { titulo: 'Recebido', render: (l) => dataHora(l.recebido_em) },
        { titulo: 'Empresa', render: (l) => <button className="btn link" onClick={() => setAberto(l)}><strong>{l.empresa}</strong></button> },
        { titulo: 'Contato', render: (l) => <><div>{l.nome}</div><div className="small muted">{l.email}{l.whatsapp ? ` · ${mascaraFone(l.whatsapp)}` : ''}</div>{l.origem === 'PROSPECCAO' && <div className="small" style={{ color: 'var(--azul)' }}>Abordado por e-mail{l.ultimo_email_em ? ` · ${dataHora(l.ultimo_email_em)}` : ''}</div>}</> },
        { titulo: 'Segmento', render: (l) => SEGMENTOS[l.segmento] || '—' },
        { titulo: 'Carteira', num: true, render: (l) => (l.analise ? <>{brl(l.analise.vencido_centavos)}<div className="small muted">{l.analise.devedores} devedor(es)</div></> : l.valor_aberto_centavos ? <span className="muted">≈ {brl(l.valor_aberto_centavos)}</span> : '—') },
        { titulo: 'Situação', render: (l) => <Badge status={TOM[l.status]}>{STATUS[l.status]}</Badge> },
        { titulo: '', render: (l) => <button className="btn sm" onClick={() => setAberto(l)}>Abrir</button> },
      ]} vazio={<Vazio titulo="Nenhum pedido ainda">Os pedidos feitos em acorly.com.br/diagnostico e os contatos abordados por e-mail aparecem aqui.</Vazio>} />}
      </div>
      {aberto && <Detalhe lead={aberto} onClose={() => setAberto(null)} onFeito={() => setR(r + 1)} onEmail={(l) => setEmail(l)} />}
      {email && <Abordar lead={email.id ? email : null} onClose={() => setEmail(null)} onFeito={() => setR(r + 1)} />}
      {prospect && <Abordar lead={null} prospect={prospect} onClose={() => setProspect(null)} onFeito={() => setR(r + 1)} />}
    </div>
  );
}
