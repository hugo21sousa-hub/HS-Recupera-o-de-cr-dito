// Atendimento WhatsApp (equipe Acorly): conversas de quem chamou no número da API.
// A IA qualifica; quando ela passa a conversa (ou a equipe assume), a resposta é feita por aqui.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Cabecalho, Carregando, Vazio, useApi, useExecutar } from '../ui.jsx';
import { dataHora, mascaraFone } from '../format.js';

const STATUS = { IA: ['🤖 Com a IA', 'info'], HUMANO: ['🙋 Com a equipe', 'PENDENTE'], ENCERRADA: ['Encerrada', 'CANCELADA'] };
const AUTOR = { CLIENTE: 'Cliente', IA: 'IA', EQUIPE: 'Equipe', SISTEMA: 'Sistema' };
const FILTROS = [['', 'Todas'], ['HUMANO', 'Com a equipe'], ['IA', 'Com a IA'], ['ENCERRADA', 'Encerradas']];

const nomeDe = (c) => c.qualificacao?.empresa || c.qualificacao?.nome || c.nome_perfil || mascaraFone(String(c.telefone).replace(/^55/, ''));

function Conversa({ id, onMudou }) {
  const { data, recarregar } = useApi('abrirConversaWhatsApp', { id }, [id]);
  const { executar, enviando } = useExecutar();
  const [texto, setTexto] = useState('');
  const fim = useRef(null);
  useEffect(() => { const t = setInterval(recarregar, 10000); return () => clearInterval(t); }, [recarregar]);
  useEffect(() => { fim.current?.scrollIntoView({ block: 'end' }); }, [data?.mensagens?.length]);
  if (!data) return <Carregando />;
  const c = data.conversa;
  const q = c.qualificacao || {};
  const acao = (a, msg) => executar('alterarConversaWhatsApp', { id, acao: a }, msg).then(() => { recarregar(); onMudou(); }).catch(() => {});
  const enviar = () => executar('responderConversaWhatsApp', { id, texto }, 'Mensagem enviada').then(() => { setTexto(''); recarregar(); onMudou(); }).catch(() => {});
  const dados = [['Nome', q.nome], ['Cargo', q.cargo], ['Empresa', q.empresa], ['Cidade', q.cidade], ['E-mail', q.email], ['Clientes em atraso', q.clientes_em_atraso], ['Valor em atraso', q.valor_em_atraso], ['Tempo de atraso', q.tempo_atraso], ['Interesse', q.interesse]].filter(([, v]) => v);
  return (
    <div className="stack" style={{ minWidth: 0 }}>
      <div className="card stack" style={{ gap: 6 }}>
        <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div>
            <strong>{nomeDe(c)}</strong> <Badge status={STATUS[c.status][1]}>{STATUS[c.status][0]}</Badge>
            <div className="small muted">+{c.telefone}{c.nome_perfil ? ` · perfil "${c.nome_perfil}"` : ''}{data.lead ? <> · <Link to="/hs/leads">contato em Pedidos e contatos</Link></> : null}</div>
          </div>
          <div className="row" style={{ gap: 4 }}>
            {c.status === 'IA' && <button className="btn sm" disabled={enviando} onClick={() => acao('assumir', 'Você assumiu a conversa: a IA parou')}>Assumir (parar a IA)</button>}
            {c.status !== 'IA' && <button className="btn sm" disabled={enviando} onClick={() => acao('devolver', 'Devolvida para a IA')}>Devolver para a IA</button>}
            {c.status !== 'ENCERRADA' && <button className="btn sm" disabled={enviando} onClick={() => acao('encerrar', 'Conversa encerrada')}>Encerrar</button>}
          </div>
        </div>
        {c.status === 'HUMANO' && c.motivo_humano && <div className="aviso alerta"><strong>Por que veio para você:</strong> {c.motivo_humano}</div>}
        {c.resumo && <div className="small"><strong>Resumo da IA:</strong> {c.resumo}</div>}
        {dados.length > 0 && <div className="small muted">{dados.map(([k, v]) => `${k}: ${v}`).join(' · ')}</div>}
      </div>
      <div className="card" style={{ maxHeight: '55vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.mensagens.map((m) => (
          <div key={m.id} style={{ alignSelf: m.de === 'CLIENTE' ? 'flex-start' : m.de === 'SISTEMA' ? 'center' : 'flex-end', maxWidth: '80%' }}>
            <div style={{ whiteSpace: 'pre-wrap', padding: '8px 12px', borderRadius: 12, background: m.de === 'CLIENTE' ? 'var(--bg)' : m.de === 'SISTEMA' ? 'transparent' : m.de === 'IA' ? '#e8efff' : '#dcf8c6', border: m.de === 'SISTEMA' ? '1px dashed var(--borda)' : 'none', fontSize: 14 }}>{m.texto}</div>
            <div className="small muted" style={{ textAlign: m.de === 'CLIENTE' ? 'left' : 'right' }}>{AUTOR[m.de]} · {dataHora(m.em)}{m.erro ? ` · ⚠️ não enviada: ${m.erro}` : ''}</div>
          </div>
        ))}
        <div ref={fim} />
      </div>
      {c.status !== 'ENCERRADA' && (c.janela_aberta ? (
        <div className="stack" style={{ gap: 6 }}>
          <textarea rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={c.status === 'IA' ? 'Escreva para assumir a conversa (a IA para de responder)…' : 'Escreva sua resposta…'} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && texto.trim()) enviar(); }} />
          <div className="row between"><span className="small muted">Ctrl+Enter envia. A janela grátis de 24 h fecha em {dataHora(new Date(Date.parse(c.ultima_cliente_em) + 24 * 3600e3).toISOString())}.</span><button className="btn prim" disabled={enviando || !texto.trim()} onClick={enviar}>Enviar</button></div>
        </div>
      ) : <div className="aviso alerta">Passaram mais de 24 horas desde a última mensagem do cliente. Pela regra da Meta, só dá para escrever com uma mensagem-modelo aprovada (paga). Quando o cliente escrever de novo, a resposta volta a ser liberada.</div>)}
    </div>
  );
}

export function AtendimentoWhatsApp() {
  const [filtro, setFiltro] = useState('');
  const [aberta, setAberta] = useState(null);
  const { data, carregando, recarregar } = useApi('listarConversasWhatsApp', { status: filtro || undefined }, [filtro]);
  useEffect(() => { const t = setInterval(recarregar, 15000); return () => clearInterval(t); }, [recarregar]);
  return (
    <div className="stack">
      <Cabecalho titulo="Atendimento WhatsApp" sub="Quem chama no WhatsApp da Acorly é atendido pela IA, que qualifica a empresa. Quando ela precisa de uma pessoa, a conversa vem para você aqui, e a IA para de responder." />
      {data && !data.whatsapp_configurado && <div className="aviso alerta">O WhatsApp da API oficial ainda não está configurado no servidor (WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID no Render).</div>}
      {data && !data.ia_configurada && <div className="aviso alerta">A IA ainda não está configurada (ANTHROPIC_API_KEY no Render). Até lá, toda conversa nova vem direto para a equipe.</div>}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {FILTROS.map(([v, r]) => <button key={v} className={`btn sm ${filtro === v ? 'prim' : ''}`} onClick={() => { setFiltro(v); setAberta(null); }}>{r}{v && data?.totais ? ` (${data.totais[v]})` : ''}</button>)}
        {data?.totais?.esperando ? <Badge status="PENDENTE">{data.totais.esperando} esperando você</Badge> : null}
      </div>
      {carregando && !data ? <Carregando /> : !data?.itens?.length ? <Vazio titulo="Nenhuma conversa">Quando alguém chamar no WhatsApp da Acorly, a conversa aparece aqui.</Vazio> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 340px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }} className="atendimento-grade">
          <div className="card" style={{ padding: 0, maxHeight: '75vh', overflowY: 'auto' }}>
            {data.itens.map((c) => (
              <button key={c.id} onClick={() => setAberta(c.id)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', border: 0, borderBottom: '1px solid var(--borda)', background: aberta === c.id ? 'var(--bg)' : 'transparent', cursor: 'pointer' }}>
                <div className="row between"><strong style={{ fontWeight: c.nao_lida ? 700 : 500 }}>{c.nao_lida ? '● ' : ''}{nomeDe(c)}</strong><span className="small muted">{dataHora(c.ultima_mensagem_em || c.criada_em)}</span></div>
                <div className="small"><Badge status={STATUS[c.status][1]}>{STATUS[c.status][0]}</Badge></div>
                <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.ultima_de === 'CLIENTE' ? '' : `${AUTOR[c.ultima_de] || ''}: `}{c.ultima}</div>
              </button>
            ))}
          </div>
          {aberta ? <Conversa id={aberta} onMudou={recarregar} /> : <Vazio titulo="Escolha uma conversa">As que estão "com a equipe" esperam a sua resposta.</Vazio>}
        </div>
      )}
    </div>
  );
}
