// Envio de mensagens ao devedor (WhatsApp assistido e e-mail) e registro de respostas.
import { useEffect, useState } from 'react';
import { hs } from './api.js';
import { Modal, useApi, useExecutar } from './ui.jsx';
import { rotulo, dataHora } from './format.js';

const RESULTADOS_RESPOSTA = ['RESPONDEU', 'PROMESSA_PAGAMENTO', 'RECUSA', 'CONTESTOU', 'SOLICITOU_INTERRUPCAO', 'OUTRO'];

/**
 * Janela de envio. WhatsApp: abre o WhatsApp com o texto pronto e registra no histórico (com opção de desfazer).
 * E-mail: envia pelo sistema (remetente do domínio; respostas vão para quem enviou).
 */
export function EnviarMensagem({ casoId, canalInicial = 'WHATSAPP', emailDisponivel = false, apiWhatsApp = false, onClose, onEnviado }) {
  const [canal, setCanal] = useState(canalInicial);
  const modelos = useApi('listarModelosMensagem', { caso_id: casoId });
  const [modelo, setModelo] = useState('');
  const [texto, setTexto] = useState('');
  const [assunto, setAssunto] = useState('');
  const [previa, setPrevia] = useState(null);
  const [erroPrevia, setErroPrevia] = useState(null);
  const [feito, setFeito] = useState(null);
  const { executar, enviando } = useExecutar();
  const doCanal = (modelos.data || []).filter((m) => m.canal === canal);
  const temConteudo = modelo || texto.trim();

  useEffect(() => { setModelo(''); setPrevia(null); setErroPrevia(null); }, [canal]);
  useEffect(() => {
    if (!temConteudo) { setPrevia(null); setErroPrevia(null); return undefined; }
    const t = setTimeout(async () => {
      try { setPrevia(await hs('prepararMensagem', { caso_id: casoId, canal, modelo_id: modelo || undefined, mensagem: modelo ? undefined : texto, assunto: assunto || undefined })); setErroPrevia(null); } catch (e) { setPrevia(null); setErroPrevia(e.message); }
    }, 350);
    return () => clearTimeout(t);
  }, [canal, modelo, texto, assunto]); // eslint-disable-line react-hooks/exhaustive-deps

  const payload = () => ({ caso_id: casoId, modelo_id: modelo || undefined, mensagem: modelo ? undefined : texto, assunto: assunto || undefined });

  const abrirWhatsApp = async () => {
    // A janela precisa ser aberta no clique (senão o navegador bloqueia); o endereço chega depois.
    const janela = window.open('about:blank', '_blank');
    try {
      const r = await executar('enviarWhatsAppAssistido', payload(), 'Mensagem registrada no histórico');
      if (janela && !janela.closed) janela.location.replace(r.link); else window.open(r.link, '_blank', 'noopener');
      setFeito({ tipo: 'whatsapp', ...r });
      onEnviado?.();
    } catch { janela?.close(); }
  };
  const enviarApi = async () => {
    try { await executar('enviarWhatsApp', payload(), 'Mensagem enviada pelo WhatsApp Business'); } catch { return; }
    onEnviado?.(); onClose();
  };
  const enviarEmail = async () => {
    let r;
    try { r = await executar('enviarEmailDevedor', payload(), 'E-mail enviado'); } catch { return; }
    setFeito({ tipo: 'email', ...r });
    onEnviado?.();
  };
  const desfazer = async () => {
    try { await executar('desfazerEnvio', { interacao_id: feito.interacao_id }, 'Envio desfeito'); } catch { return; }
    onEnviado?.(); onClose();
  };

  if (feito) {
    return (
      <Modal titulo={feito.tipo === 'email' ? 'E-mail enviado' : 'WhatsApp aberto'} onClose={onClose} rodape={<button className="btn prim" onClick={onClose}>Concluir</button>}>
        {feito.tipo === 'email' ? (
          <div className="stack"><div className="aviso ok">E-mail enviado para <strong>{feito.para}</strong> e registrado no histórico. Se o devedor responder, a resposta chega no seu e-mail. Registre-a aqui com "Registrar resposta".</div></div>
        ) : (
          <div className="stack">
            <div className="aviso ok">A mensagem foi registrada no histórico e o WhatsApp abriu com o texto pronto. Confira e aperte <strong>Enviar</strong> no WhatsApp.</div>
            <div className="card small" style={{ whiteSpace: 'pre-wrap' }}>{feito.mensagem}</div>
            <div className="row between">
              <a href={feito.link} target="_blank" rel="noreferrer" className="btn sm">Abrir o WhatsApp de novo</a>
              <button className="btn sm perigo" disabled={enviando} onClick={desfazer}>Não consegui enviar: desfazer</button>
            </div>
            <p className="small muted" style={{ margin: 0 }}>Dá para desfazer até {dataHora(feito.desfazer_ate)}.</p>
          </div>
        )}
      </Modal>
    );
  }

  return (
    <Modal titulo="Enviar mensagem ao devedor" onClose={onClose} rodape={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      {canal === 'WHATSAPP' && <button className={`btn ${apiWhatsApp ? '' : 'prim'}`} disabled={enviando || !previa} onClick={abrirWhatsApp}>Abrir no WhatsApp</button>}
      {canal === 'WHATSAPP' && apiWhatsApp && <button className="btn prim" disabled={enviando || !previa} onClick={enviarApi}>Enviar pelo WhatsApp Business</button>}
      {canal === 'EMAIL' && <button className="btn prim" disabled={enviando || !previa || !emailDisponivel} onClick={enviarEmail}>Enviar e-mail</button>}
    </>}>
      <div className="stack">
        <div className="abas" role="tablist">
          {['WHATSAPP', 'EMAIL'].map((c) => <button key={c} type="button" role="tab" aria-selected={canal === c} className={canal === c ? 'ativa' : ''} onClick={() => setCanal(c)}>{c === 'EMAIL' ? 'E-mail' : 'WhatsApp'}</button>)}
        </div>
        {canal === 'WHATSAPP' && <div className="aviso info small">O WhatsApp abre no computador ou no celular com o texto pronto. Você só aperta Enviar. O envio fica registrado no histórico e conta no limite de 3 contatos por dia.</div>}
        {canal === 'EMAIL' && !emailDisponivel && <div className="aviso alerta small">O envio de e-mail aos devedores será liberado quando o domínio próprio estiver configurado.</div>}
        {canal === 'EMAIL' && emailDisponivel && <div className="aviso info small">O e-mail sai com o nome do credor (ou da HS, na cobrança gerenciada). As respostas do devedor chegam no seu e-mail. Inclui um link para o devedor deixar de receber e-mails.</div>}
        <div className="campo"><label>Modelo</label>
          <select value={modelo} onChange={(e) => setModelo(e.target.value)}>
            <option value="">Escrever mensagem livre</option>
            {doCanal.map((m) => <option key={m.id} value={m.id}>{m.nome}{m.aprovado_meta ? ' (aprovado na Meta)' : ''}</option>)}
          </select>
        </div>
        {canal === 'EMAIL' && <div className="campo"><label>Assunto</label><input value={assunto} onChange={(e) => setAssunto(e.target.value)} maxLength={150} placeholder={modelo ? 'Usar o assunto do modelo' : 'Pendência financeira com {{credor}}'} /></div>}
        {!modelo && <div className="campo"><label>Mensagem</label><textarea value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={4000} rows={5} placeholder="Escreva de forma respeitosa e objetiva. Você pode usar {{nome}}, {{credor}}, {{valor}} e {{vencimento}}." /></div>}
        {erroPrevia && <div className="aviso critico small">{erroPrevia}</div>}
        {previa && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="small muted">Prévia · para {canal === 'EMAIL' ? previa.destino : `+${previa.destino}`}</div>
            {previa.assunto && <div className="small"><strong>Assunto:</strong> {previa.assunto}</div>}
            <div className="card small" style={{ whiteSpace: 'pre-wrap', background: '#f8fafc' }}>{previa.texto}</div>
          </div>
        )}
        {!modelos.carregando && !doCanal.length && <p className="small muted" style={{ margin: 0 }}>Não há modelos de {canal === 'EMAIL' ? 'e-mail' : 'WhatsApp'} cadastrados.</p>}
      </div>
    </Modal>
  );
}

/** Registra a resposta do devedor (recebida no WhatsApp, por e-mail ou telefone). */
export function RegistrarResposta({ casoId, onClose, onFeito }) {
  const [v, setV] = useState({ canal: 'WHATSAPP', resposta: '', resultado: 'RESPONDEU', proxima_acao: '', proxima_acao_data: '' });
  const { executar, enviando } = useExecutar();
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const salvar = async () => {
    try {
      await executar('registrarInteracao', { caso_id: casoId, canal: v.canal, tipo_interacao: 'RESPOSTA_DEVEDOR', resposta: v.resposta, resultado: v.resultado, proxima_acao: v.proxima_acao || undefined, proxima_acao_data: v.proxima_acao_data || undefined }, 'Resposta registrada');
    } catch { return; }
    onFeito?.(); onClose();
  };
  return (
    <Modal titulo="Registrar resposta do devedor" onClose={onClose} rodape={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn prim" disabled={enviando || !v.resposta.trim()} onClick={salvar}>Registrar</button></>}>
      <div className="stack">
        <div className="form-grid">
          <div className="campo"><label>Recebida por</label><select value={v.canal} onChange={set('canal')}>{['WHATSAPP', 'EMAIL', 'TELEFONE', 'SMS', 'PRESENCIAL'].map((c) => <option key={c} value={c}>{rotulo(c)}</option>)}</select></div>
          <div className="campo"><label>Resultado</label><select value={v.resultado} onChange={set('resultado')}>{RESULTADOS_RESPOSTA.map((c) => <option key={c} value={c}>{rotulo(c)}</option>)}</select></div>
        </div>
        <div className="campo"><label>O que o devedor respondeu</label><textarea rows={4} value={v.resposta} onChange={set('resposta')} maxLength={4000} placeholder="Cole aqui a mensagem do devedor ou resuma a conversa." /></div>
        <div className="form-grid">
          <div className="campo"><label>Próxima ação (opcional)</label><input value={v.proxima_acao} onChange={set('proxima_acao')} placeholder="Ex.: enviar proposta" /></div>
          <div className="campo"><label>Data do retorno (opcional)</label><input type="date" value={v.proxima_acao_data} onChange={set('proxima_acao_data')} /></div>
        </div>
        {v.resultado === 'CONTESTOU' && <div className="aviso alerta small">O credor será avisado e o caso fica em contestação.</div>}
        {v.resultado === 'SOLICITOU_INTERRUPCAO' && <div className="aviso alerta small">O devedor fica marcado para não receber mais contatos.</div>}
      </div>
    </Modal>
  );
}
