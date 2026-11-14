// Pedidos de diagnóstico gratuito (leads do site): acompanhamento comercial da equipe.
import { useState } from 'react';
import { hs, abrirLink } from '../api.js';
import { Tabela, Badge, Cabecalho, Modal, Vazio, useExecutar, useToast } from '../ui.jsx';
import { brl, dataHora, mascaraFone, mascaraDoc, pct } from '../format.js';

const SEGMENTOS = { ESCOLA_CURSO: 'Escola ou curso', SAUDE: 'Saúde', ACADEMIA: 'Academia', CONDOMINIO: 'Condomínio', VAREJO: 'Varejo', DISTRIBUIDORA: 'Distribuidora', SERVICOS: 'Serviços', IMOBILIARIA: 'Imobiliária', OUTRO: 'Outro' };
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

function Detalhe({ lead, onClose, onFeito }) {
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
        <div className="form-grid">
          <div className="campo"><label>Situação</label><select value={status} onChange={(e) => setStatus(e.target.value)}>{Object.entries(STATUS).map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select></div>
        </div>
        <div className="campo"><label>Anotações da equipe</label><textarea rows={4} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Contatos feitos, proposta enviada, próximos passos…" /></div>
      </div>
    </Modal>
  );
}

export function Leads() {
  const [r, setR] = useState(0);
  const [aberto, setAberto] = useState(null);
  return (
    <div className="stack">
      <Cabecalho titulo="Diagnósticos (leads)" sub="Pedidos de diagnóstico gratuito feitos no site. Responda em até 2 dias úteis, como prometido ao contato." />
      <Tabela acao="listarLeads" recarregar={r} filtros={[{ nome: 'status', rotulo: 'Situação', opcoes: Object.keys(STATUS) }]} colunas={[
        { titulo: 'Recebido', render: (l) => dataHora(l.recebido_em) },
        { titulo: 'Empresa', render: (l) => <button className="btn link" onClick={() => setAberto(l)}><strong>{l.empresa}</strong></button> },
        { titulo: 'Contato', render: (l) => <><div>{l.nome}</div><div className="small muted">{l.email}{l.whatsapp ? ` · ${mascaraFone(l.whatsapp)}` : ''}</div></> },
        { titulo: 'Segmento', render: (l) => SEGMENTOS[l.segmento] || '—' },
        { titulo: 'Carteira', num: true, render: (l) => (l.analise ? <>{brl(l.analise.vencido_centavos)}<div className="small muted">{l.analise.devedores} devedor(es)</div></> : l.valor_aberto_centavos ? <span className="muted">≈ {brl(l.valor_aberto_centavos)}</span> : '—') },
        { titulo: 'Situação', render: (l) => <Badge status={TOM[l.status]}>{STATUS[l.status]}</Badge> },
        { titulo: '', render: (l) => <button className="btn sm" onClick={() => setAberto(l)}>Abrir</button> },
      ]} vazio={<Vazio titulo="Nenhum pedido ainda">Os pedidos feitos em acorly.com.br/diagnostico aparecem aqui e você recebe um aviso por e-mail.</Vazio>} />
      {aberto && <Detalhe lead={aberto} onClose={() => setAberto(null)} onFeito={() => setR(r + 1)} />}
    </div>
  );
}
