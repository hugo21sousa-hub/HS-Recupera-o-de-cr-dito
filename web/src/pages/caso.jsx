import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { hs, abrirLink } from '../api.js';
import { useSessao } from '../sessao.jsx';
import { Badge, Cabecalho, FormModal, Modal, useApi, useToast, useConfirm, Carregando, ErroCarga, Vazio, Stat, Spinner, Dl, Abas, useExecutar } from '../ui.jsx';
import { brl, data, dataHora, rotulo, pct, mascaraFone, mascaraDoc, hojeISO, reaisParaCentavos, pctParaBps } from '../format.js';
import { RegistrarPagamento } from './cadastros.jsx';
import { AcoesPagamento, DecisaoNegociacao } from './financeiro.jsx';

const TIPOS = ['MENSAGEM_ENVIADA', 'LIGACAO', 'TENTATIVA_CONTATO', 'RESPOSTA_DEVEDOR', 'SEM_RESPOSTA', 'RETORNO_AGENDADO', 'NOTA_INTERNA'];
const RESULTADOS = ['SEM_RESPOSTA', 'RESPONDEU', 'NUMERO_INVALIDO', 'PROMESSA_PAGAMENTO', 'RECUSA', 'CONTESTOU', 'SOLICITOU_INTERRUPCAO', 'OUTRO'];
const CANAIS = ['WHATSAPP', 'TELEFONE', 'EMAIL', 'SMS', 'CARTA', 'PRESENCIAL', 'INTERNO'];
const STATUS_MANUAIS = ['EM_CONTATO', 'DEVEDOR_RESPONDEU', 'EM_NEGOCIACAO', 'SEM_SUCESSO', 'CONTESTACAO'];
const TERMINAIS = ['RECUPERADO_INTEGRALMENTE', 'SEM_SUCESSO'];

function PrepararWhatsApp({ caso, onClose, onRegistrado, api }) {
  const modelos = useApi('listarModelosMensagem', { caso_id: caso.id });
  const [modelo, setModelo] = useState('');
  const [texto, setTexto] = useState('');
  const [preparado, setPreparado] = useState(null);
  const { executar, enviando } = useExecutar();
  const preparar = async () => {
    const r = await executar('prepararWhatsApp', { caso_id: caso.id, modelo_id: modelo || undefined, mensagem: modelo ? undefined : texto });
    setPreparado(r);
    window.open(r.link, '_blank', 'noopener');
  };
  const enviarApi = async () => {
    await executar('enviarWhatsApp', { caso_id: caso.id, modelo_id: modelo || undefined, mensagem: modelo ? undefined : texto }, 'Mensagem enviada pelo WhatsApp Business');
    onRegistrado(); onClose();
  };
  const registrar = async () => {
    await executar('registrarInteracao', { caso_id: caso.id, canal: 'WHATSAPP', tipo_interacao: 'MENSAGEM_ENVIADA', mensagem: preparado.mensagem }, 'Envio registrado no histórico');
    onRegistrado(); onClose();
  };
  return (
    <Modal titulo="Mensagem por WhatsApp" onClose={onClose} rodape={preparado ? <><button className="btn" onClick={onClose}>Não enviei</button><button className="btn prim" disabled={enviando} onClick={registrar}>Sim, enviei: registrar</button></> : <><button className="btn" onClick={onClose}>Cancelar</button><button className={`btn ${api ? '' : 'prim'}`} disabled={enviando || (!modelo && !texto.trim())} onClick={preparar}>Abrir no meu WhatsApp</button>{api && <button className="btn prim" disabled={enviando || (!modelo && !texto.trim())} onClick={enviarApi}>Enviar pelo WhatsApp Business</button>}</>}>
      <div className="stack">
        {api ? <div className="aviso info">Integração oficial ativa. Fora da janela de 24 h desde a última resposta do devedor, só modelos aprovados pela Meta podem ser enviados.</div>
          : <div className="aviso alerta">Envio manual: a integração oficial do WhatsApp Business não está ativa para este caso. O WhatsApp abre com o texto pronto; você envia e confirma aqui.</div>}
        {!preparado ? (
          <>
            <div className="campo"><label>Modelo</label><select value={modelo} onChange={(e) => setModelo(e.target.value)}><option value="">Escrever mensagem livre</option>{(modelos.data || []).filter((m) => m.canal === 'WHATSAPP').map((m) => <option key={m.id} value={m.id}>{m.nome}{m.aprovado_meta ? ' (aprovado na Meta)' : ''}</option>)}</select></div>
            {!modelo && <div className="campo"><label>Mensagem</label><textarea value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={1500} placeholder="Escreva de forma respeitosa e objetiva." /></div>}
            <p className="small muted">Mensagens com ameaça, constrangimento ou exposição são bloqueadas pelo sistema.</p>
          </>
        ) : (
          <>
            <div className="card" style={{ whiteSpace: 'pre-wrap' }}>{preparado.mensagem}</div>
            <p>A mensagem foi enviada no WhatsApp?</p>
            <a href={preparado.link} target="_blank" rel="noreferrer" className="small">Abrir o WhatsApp novamente</a>
          </>
        )}
      </div>
    </Modal>
  );
}

function Simulador({ caso, saldo, onProposta }) {
  const [v, setV] = useState({ desconto: '0', entrada: '', parcelas: '1', primeira: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), dataEntrada: hojeISO(), condicoes: '', justificativa: '' });
  const [sim, setSim] = useState(null);
  const [erro, setErro] = useState(null);
  const { executar, enviando } = useExecutar();
  const payload = () => {
    const entrada = v.entrada ? reaisParaCentavos(v.entrada) : 0;
    return { caso_id: caso.id, desconto_bps: pctParaBps(v.desconto || '0'), entrada_centavos: entrada, quantidade_parcelas: Number(v.parcelas) || 0, primeira_data_vencimento: v.primeira || undefined };
  };
  useEffect(() => {
    const t = setTimeout(async () => {
      const p = payload();
      if (Number.isNaN(p.desconto_bps) || Number.isNaN(p.entrada_centavos)) { setErro('Valores inválidos'); setSim(null); return; }
      if (p.quantidade_parcelas > 0 && !p.primeira_data_vencimento) { setErro('Informe o 1º vencimento das parcelas'); setSim(null); return; }
      try { setSim(await hs('simularNegociacao', p)); setErro(null); } catch (e) { setSim(null); setErro(e.message); }
    }, 400);
    return () => clearTimeout(t);
  }, [v.desconto, v.entrada, v.parcelas, v.primeira]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const propor = async () => {
    const r = await executar('proporNegociacao', { ...payload(), data_entrada: v.entrada ? v.dataEntrada : undefined, condicoes: v.condicoes, justificativa: v.justificativa }, 'Proposta registrada');
    onProposta(r);
  };
  return (
    <div className="grid g2">
      <div className="stack">
        <div className="form-grid">
          <div className="campo"><label>Saldo atualizado</label><input value={brl(saldo)} disabled /></div>
          <div className="campo"><label>Desconto (%)</label><input inputMode="decimal" value={v.desconto} onChange={set('desconto')} /></div>
          <div className="campo"><label>Entrada (R$)</label><input inputMode="decimal" value={v.entrada} onChange={set('entrada')} placeholder="0,00" /></div>
          <div className="campo"><label>Vencimento da entrada</label><input type="date" value={v.dataEntrada} onChange={set('dataEntrada')} /></div>
          <div className="campo"><label>Parcelas (sem a entrada)</label><input type="number" min="0" max="120" value={v.parcelas} onChange={set('parcelas')} /></div>
          <div className="campo"><label>1º vencimento</label><input type="date" value={v.primeira} onChange={set('primeira')} /></div>
          <div className="campo full"><label>Condições da proposta</label><textarea value={v.condicoes} onChange={set('condicoes')} /></div>
          {sim && !sim.dentro_alcada && <div className="campo full"><label>Justificativa para o credor</label><textarea value={v.justificativa} onChange={set('justificativa')} /></div>}
        </div>
      </div>
      <div className="stack">
        {erro && <div className="aviso critico">{erro}</div>}
        {sim && (
          <div className="card stack">
            <Dl itens={[['Desconto', `${pct(sim.desconto_bps)} (${brl(sim.desconto_centavos)})`], ['Valor proposto', <strong key="v">{brl(sim.valor_proposto_centavos)}</strong>], ['Entrada', brl(sim.entrada_centavos)], ['Parcelas', sim.quantidade_parcelas ? `${sim.quantidade_parcelas}x de ${brl(sim.valor_parcela_centavos)}` : 'À vista']]} />
            {sim.parcelas.length > 0 && <table><thead><tr><th>#</th><th>Vencimento</th><th className="num">Valor</th></tr></thead><tbody>{sim.parcelas.map((p) => <tr key={p.numero}><td>{p.numero}</td><td>{data(p.vencimento)}</td><td className="num">{brl(p.valor_centavos)}</td></tr>)}</tbody></table>}
            {sim.dentro_alcada ? <div className="aviso ok">Dentro da alçada autorizada.</div> : <div className="aviso alerta">Precisa de aprovação do credor{sim.violacoes?.length ? `: ${sim.violacoes.join('; ')}` : '.'}</div>}
            {sim.limites && <p className="small muted">Limites do credor: desconto até {pct(sim.limites.limite_desconto_bps)}, até {sim.limites.limite_parcelamento}x, entrada mínima {pct(sim.limites.entrada_minima_bps)}.</p>}
            <button className="btn prim" disabled={enviando} onClick={propor}>{enviando && <Spinner />}{sim.dentro_alcada ? 'Registrar proposta' : 'Enviar para aprovação do credor'}</button>
          </div>
        )}
      </div>
    </div>
  );
}

export function CasoDetalhe() {
  const { id } = useParams();
  const s = useSessao();
  const toast = useToast();
  const confirmar = useConfirm();
  const { executar } = useExecutar();
  const { data: d, carregando, erro, recarregar } = useApi('detalheCaso', { caso_id: id });
  const [aba, setAba] = useState('historico');
  const [modal, setModal] = useState(null);
  const ops = useApi(s.pode('caso.distribuir') ? 'listarOperadores' : null);
  if (erro) return <ErroCarga erro={erro} onRetry={recarregar} />;
  if (carregando && !d) return <Carregando linhas={8} />;
  const c = d.caso, dv = d.divida, dev = d.devedor;
  const hsCaso = c.modalidade_cobranca === 'HS_GERENCIADA';
  const ativo = !TERMINAIS.includes(c.status_operacional);
  const operavel = ativo && c.status_operacional !== 'SUSPENSO' && s.pode('interacao.registrar') && (s.ehHS ? hsCaso : !hsCaso);
  const bloqueadoContato = dev.nao_contatar;
  const podeSuspender = ativo && (s.ehHS ? s.pode('caso.suspender') : s.pode('caso.suspender_proprio'));
  const proxima = d.tarefas.filter((t) => t.status === 'PENDENTE').sort((a, b) => (a.data_prazo > b.data_prazo ? 1 : -1))[0];

  const mudarStatus = async (status) => {
    const r = await confirmar({ titulo: status === 'REATIVAR' ? 'Reativar caso' : `Alterar para "${rotulo(status)}"`, pedirMotivo: true, perigo: status === 'SUSPENSO' || status === 'SEM_SUCESSO', mensagem: status === 'SUSPENSO' ? 'O caso fica parado e o operador perde o acesso até a reativação.' : status === 'SEM_SUCESSO' ? 'O caso será encerrado sem recuperação.' : 'Registre o motivo da alteração.' });
    if (!r) return;
    await executar('alterarStatusCaso', { caso_id: c.id, status, motivo: r.motivo }, 'Status atualizado');
    recarregar();
  };

  return (
    <div className="stack">
      <Cabecalho titulo={dev.nome} sub={<>Credor: <strong>{d.credor.nome}</strong> · {rotulo(c.modalidade_cobranca)} · {s.ehHS ? 'Dívida' : <Link to={`/dividas/${dv.id}`}>Ver dívida</Link>} {dv.documento_referencia}</>} voltar={s.ehHS ? '/hs/meus' : hsCaso ? '/cobranca-hs' : '/cobrancas'}>
        <Badge status={c.status_operacional} />
      </Cabecalho>
      {bloqueadoContato && <div className="aviso critico"><strong>Devedor pediu interrupção de contato.</strong> As ações de contato estão bloqueadas. {dev.motivo_nao_contatar}</div>}
      {c.status_operacional === 'SUSPENSO' && <div className="aviso critico">Caso suspenso: {c.motivo_status}</div>}
      {c.status_operacional === 'CONTESTACAO' && <div className="aviso alerta">Dívida contestada pelo devedor: {c.motivo_status}. O credor deve analisar antes de prosseguir.</div>}

      <div className="grid g4">
        <Stat rotulo="Valor original" valor={brl(dv.valor_original_centavos)} />
        <Stat rotulo="Saldo atualizado" valor={brl(dv.saldo_atual_centavos)} tom={dv.saldo_atual_centavos ? 'critico' : 'ok'} />
        <Stat rotulo="Tempo de atraso" valor={`${dv.dias_atraso} dias`} ajuda={`Vencimento ${data(dv.data_vencimento)}`} />
        <Stat rotulo="Responsável" valor={d.operador?.nome || (hsCaso ? 'Sem operador' : 'Empresa')} ajuda={`Último contato: ${dataHora(c.ultima_interacao)}${proxima ? ` · Próxima tarefa: ${data(proxima.data_prazo)}` : ''}`} />
      </div>

      <div className="card row">
        {operavel && <button className="btn prim" disabled={bloqueadoContato} onClick={() => setModal('whatsapp')}>Preparar WhatsApp</button>}
        {operavel && <button className="btn" onClick={() => setModal('contato')}>Registrar contato</button>}
        {operavel && <button className="btn" onClick={() => setModal('tarefa')}>Nova tarefa</button>}
        {operavel && s.pode('pagamento.informar') && <button className="btn ok" onClick={() => setModal('pagamento')}>Informar pagamento</button>}
        {operavel && <select style={{ width: 'auto' }} value="" onChange={(e) => e.target.value && mudarStatus(e.target.value)} aria-label="Alterar status"><option value="">Alterar status…</option>{STATUS_MANUAIS.filter((x) => x !== c.status_operacional).map((x) => <option key={x} value={x}>{rotulo(x)}</option>)}</select>}
        {podeSuspender && c.status_operacional !== 'SUSPENSO' && <button className="btn perigo" onClick={() => mudarStatus('SUSPENSO')}>Suspender</button>}
        {c.status_operacional === 'SUSPENSO' && (s.ehHS ? s.pode('caso.suspender') : s.pode('caso.suspender_proprio')) && <button className="btn" onClick={() => mudarStatus('REATIVAR')}>Reativar</button>}
        {s.pode('caso.distribuir') && hsCaso && ativo && !['AGUARDANDO_VALIDACAO', 'SUSPENSO'].includes(c.status_operacional) && (
          <select style={{ width: 'auto' }} value="" aria-label="Atribuir operador" onChange={async (e) => { if (!e.target.value) return; await executar('atribuirCaso', { caso_id: c.id, operador_id: e.target.value, forcar: true }, 'Caso atribuído'); recarregar(); }}>
            <option value="">{c.operador_id ? 'Reatribuir a…' : 'Atribuir a…'}</option>{(ops.data || []).filter((o) => o.status === 'ATIVO').map((o) => <option key={o.id} value={o.id}>{o.nome} ({o.carga_atual}/{o.capacidade_casos})</option>)}
          </select>
        )}
        {!operavel && !s.ehHS && hsCaso && <span className="muted small">Caso conduzido pela equipe Acorly. Você acompanha, aprova propostas e confirma pagamentos.</span>}
      </div>

      <div className="grid g2">
        <div className="card">
          <h2>Devedor</h2>
          <Dl itens={[['Documento', mascaraDoc(dev.cpf_cnpj)], ['WhatsApp', mascaraFone(dev.whatsapp)], ['Telefone', mascaraFone(dev.telefone)], ['E-mail', dev.email || '—'], ['Canal preferido', rotulo(dev.canal_preferido)], ['Endereço', dev.endereco || '—']]} />
        </div>
        <div className="card">
          <h2>Limites autorizados</h2>
          {d.autorizacao ? <Dl itens={[['Desconto máximo', pct(d.autorizacao.limite_desconto_bps)], ['Parcelamento', `até ${d.autorizacao.limite_parcelamento}x`], ['Entrada mínima', pct(d.autorizacao.entrada_minima_bps)], ['Canais', (d.autorizacao.canais_autorizados || []).map(rotulo).join(', ')], ['Horário', d.autorizacao.horario_contato], ['Aprovação sempre', d.autorizacao.exige_aprovacao_sempre ? 'Sim' : 'Não'], c.comissao_bps != null && ['Comissão Acorly', `${pct(c.comissao_bps)} (${c.comissao_faixa}) sobre o recebido`], ['Condições', d.autorizacao.condicoes || '—'], ['Autorização', <Badge key="a" status={d.autorizacao.status}>v{d.autorizacao.versao} · {rotulo(d.autorizacao.status)}</Badge>]]} />
            : <p className="muted">Cobrança própria: as condições são definidas pela própria empresa.</p>}
        </div>
      </div>

      <div className="card">
        <Abas ativa={aba} onChange={setAba} abas={[
          { id: 'historico', rotulo: 'Histórico', contador: d.interacoes.length },
          { id: 'negociar', rotulo: 'Negociação', contador: d.negociacoes.length },
          { id: 'acordos', rotulo: 'Acordos', contador: d.acordos.length },
          { id: 'pagamentos', rotulo: 'Pagamentos', contador: d.pagamentos.length },
          { id: 'tarefas', rotulo: 'Tarefas', contador: d.tarefas.filter((t) => t.status === 'PENDENTE').length },
          { id: 'documentos', rotulo: 'Documentos', contador: d.documentos.length },
          ...(hsCaso ? [{ id: 'atribuicoes', rotulo: 'Atribuições' }] : []),
        ]} />

        {aba === 'historico' && (d.interacoes.length ? (
          <ul className="timeline">{d.interacoes.map((i) => (
            <li key={i.id} className={['MENSAGEM_ENVIADA', 'LIGACAO', 'TENTATIVA_CONTATO'].includes(i.tipo_interacao) ? 'saida' : i.tipo_interacao === 'RESPOSTA_DEVEDOR' ? 'resposta' : ''}>
              <div className="row small muted"><span>{dataHora(i.data_hora)}</span><Badge status="info">{rotulo(i.canal)}</Badge><span>{rotulo(i.tipo_interacao)}</span>{i.resultado && <Badge status={['RESPONDEU', 'PROMESSA_PAGAMENTO'].includes(i.resultado) ? 'CONFIRMADO' : ['RECUSA', 'CONTESTOU', 'SOLICITOU_INTERRUPCAO', 'NUMERO_INVALIDO'].includes(i.resultado) ? 'REJEITADO' : 'PENDENTE'}>{rotulo(i.resultado)}</Badge>}{!i.envio_automatico && ['MENSAGEM_ENVIADA'].includes(i.tipo_interacao) && <span>(envio manual)</span>}{i.envio_automatico && <span>(WhatsApp Business{i.status_entrega ? ` · ${{ sent: 'enviada', delivered: 'entregue', read: 'lida', failed: 'falhou' }[i.status_entrega] || i.status_entrega}` : ''})</span>}{i.recebida_por_integracao && <span>(recebida automaticamente)</span>}</div>
              {i.mensagem && <div style={{ whiteSpace: 'pre-wrap' }}>{i.mensagem}</div>}
              {i.resposta && <div style={{ whiteSpace: 'pre-wrap' }}><strong>Resposta:</strong> {i.resposta}</div>}
              {i.observacoes && <div className="small muted">{i.observacoes}</div>}
              {i.proxima_acao && <div className="small">Próxima ação: {i.proxima_acao}</div>}
            </li>
          ))}</ul>
        ) : <Vazio titulo="Nenhuma interação registrada" />)}

        {aba === 'negociar' && (
          <div className="stack">
            {d.negociacoes.length > 0 && (
              <div className="tabela-wrap"><table><thead><tr><th>Data</th><th className="num">Proposto</th><th className="num">Desconto</th><th>Condição</th><th>Status</th><th></th></tr></thead><tbody>
                {[...d.negociacoes].sort((a, b) => (a.data_proposta < b.data_proposta ? 1 : -1)).map((n) => (
                  <tr key={n.id}><td>{dataHora(n.data_proposta)}</td><td className="num">{brl(n.valor_proposto_centavos)}</td><td className="num">{pct(n.desconto_bps)}</td>
                    <td>{n.entrada_centavos ? `Entrada ${brl(n.entrada_centavos)} + ` : ''}{n.quantidade_parcelas ? `${n.quantidade_parcelas}x ${brl(n.valor_parcela_centavos)}` : 'à vista'}{n.violacoes_alcada?.length ? <div className="small" style={{ color: 'var(--alerta)' }}>{n.violacoes_alcada.join('; ')}</div> : null}</td>
                    <td><Badge status={n.status} /></td>
                    <td className="right"><div className="row" style={{ justifyContent: 'flex-end' }}>
                      {['APROVADA_ALCADA', 'APROVADA_CREDOR'].includes(n.status) && operavel && <button className="btn sm prim" onClick={() => setModal({ tipo: 'acordo', neg: n })}>Formalizar acordo</button>}
                      {['APROVADA_ALCADA', 'APROVADA_CREDOR', 'AGUARDANDO_APROVACAO_CREDOR'].includes(n.status) && operavel && <button className="btn sm" onClick={async () => { const r = await confirmar({ titulo: 'Cancelar proposta', pedirMotivo: true }); if (r) { await executar('cancelarNegociacao', { negociacao_id: n.id, motivo: r.motivo }, 'Proposta cancelada'); recarregar(); } }}>Cancelar</button>}
                      {n.status === 'AGUARDANDO_APROVACAO_CREDOR' && s.pode('negociacao.aprovar_empresa') && <DecisaoNegociacao negociacao={n} onFeito={recarregar} />}
                    </div></td></tr>
                ))}</tbody></table></div>
            )}
            {operavel && s.pode('negociacao.propor') && dv.saldo_atual_centavos > 0 && !['CONTESTACAO'].includes(c.status_operacional) && !d.negociacoes.some((n) => ['AGUARDANDO_APROVACAO_CREDOR', 'APROVADA_ALCADA', 'APROVADA_CREDOR'].includes(n.status)) && !d.acordos.some((a) => a.status === 'ATIVO') && (
              <><h3>Simulador de negociação</h3><Simulador caso={c} saldo={dv.saldo_atual_centavos} onProposta={() => recarregar()} /></>
            )}
            {!d.negociacoes.length && !operavel && <Vazio titulo="Nenhuma proposta" />}
            {d.acordos.some((a) => a.status === 'ATIVO') && <div className="aviso info">Há um acordo ativo. Para renegociar, marque o acordo como rompido na aba Acordos.</div>}
          </div>
        )}

        {aba === 'acordos' && (d.acordos.length ? (
          <table><thead><tr><th>Aceite</th><th className="num">Valor acordado</th><th className="num">Desconto</th><th>Pagamentos</th><th>Status</th><th></th></tr></thead><tbody>
            {d.acordos.map((a) => {
              const ps = d.parcelas.filter((p) => p.acordo_id === a.id);
              return <tr key={a.id}><td>{data(a.data_aceite)} · {rotulo(a.meio_aceite)}</td><td className="num">{brl(a.valor_acordado_centavos)}</td><td className="num">{brl(a.desconto_centavos)}</td>
                <td>{ps.filter((p) => p.status === 'PAGA').length}/{ps.length} pagas</td><td><Badge status={a.status} /></td>
                <td className="right">{a.status === 'ATIVO' && (s.ehHS ? operavel : s.pode('negociacao.aprovar_empresa')) && <button className="btn sm perigo" onClick={async () => { const r = await confirmar({ titulo: 'Marcar acordo como rompido', perigo: true, pedirMotivo: true }); if (r) { await executar('encerrarAcordo', { acordo_id: a.id, status: 'ROMPIDO', motivo: r.motivo }, 'Acordo encerrado'); recarregar(); } }}>Rompido</button>}</td></tr>;
            })}
          </tbody></table>
        ) : <Vazio titulo="Nenhum acordo formalizado" />)}
        {aba === 'acordos' && d.parcelas.some((p) => p.acordo_id) && (
          <div style={{ marginTop: 12 }}><h3>Parcelas de acordo</h3><table><thead><tr><th>#</th><th>Vencimento</th><th className="num">Valor</th><th className="num">Saldo</th><th>Status</th></tr></thead><tbody>
            {d.parcelas.filter((p) => p.acordo_id).map((p) => <tr key={p.id}><td>{p.numero === 0 ? 'Entrada' : p.numero}</td><td>{data(p.vencimento)}</td><td className="num">{brl(p.valor_original_centavos)}</td><td className="num">{brl(p.saldo_centavos)}</td><td><Badge status={p.status} /></td></tr>)}
          </tbody></table></div>
        )}

        {aba === 'pagamentos' && (
          <div className="stack">
            <div className="aviso info">O devedor paga diretamente ao credor. Só o credor confirma o recebimento; pagamentos informados não reduzem o saldo.</div>
            {d.pagamentos.length ? <table><thead><tr><th>Data</th><th className="num">Informado</th><th className="num">Confirmado</th><th>Forma</th><th>Status</th><th></th></tr></thead><tbody>
              {d.pagamentos.map((p) => <tr key={p.id}><td>{data(p.data_informada)}</td><td className="num">{brl(p.valor_centavos)}</td><td className="num">{brl(p.valor_confirmado_centavos)}</td><td>{rotulo(p.forma_pagamento)}</td><td><Badge status={p.status_confirmacao} />{p.motivo_rejeicao && <div className="small muted">{p.motivo_rejeicao}</div>}</td>
                <td className="right"><div className="row" style={{ justifyContent: 'flex-end' }}>
                  {p.comprovante && <button className="btn sm" onClick={() => abrirLink(hs('urlComprovante', { pagamento_id: p.id })).catch(toast.erro)}>Comprovante</button>}
                  {!s.ehHS && s.pode('pagamento.confirmar') && <AcoesPagamento pagamento={p} onFeito={recarregar} />}
                </div></td></tr>)}
            </tbody></table> : <Vazio titulo="Nenhum pagamento informado" />}
          </div>
        )}

        {aba === 'tarefas' && (d.tarefas.length ? <table><thead><tr><th>Prazo</th><th>Descrição</th><th>Prioridade</th><th>Status</th><th></th></tr></thead><tbody>
          {[...d.tarefas].sort((a, b) => (a.data_prazo > b.data_prazo ? 1 : -1)).map((t) => <tr key={t.id}><td style={{ color: t.status === 'PENDENTE' && t.data_prazo < hojeISO() ? 'var(--critico)' : undefined }}>{data(t.data_prazo)}</td><td>{t.descricao}</td><td>{rotulo(t.prioridade)}</td><td><Badge status={t.status} /></td>
            <td className="right">{t.status === 'PENDENTE' && s.pode('tarefa.gerenciar') && <button className="btn sm" onClick={async () => { await executar('concluirTarefa', { tarefa_id: t.id }, 'Tarefa concluída'); recarregar(); }}>Concluir</button>}</td></tr>)}
        </tbody></table> : <Vazio titulo="Nenhuma tarefa" />)}

        {aba === 'documentos' && (d.documentos.length ? <table><thead><tr><th>Arquivo</th><th>Tipo</th><th>Enviado em</th><th></th></tr></thead><tbody>
          {d.documentos.map((x) => <tr key={x.id}><td>{x.nome_arquivo}</td><td>{rotulo(x.tipo_documento)}</td><td>{dataHora(x.data_upload)}</td><td className="right"><button className="btn sm" onClick={() => abrirLink(hs('urlDocumento', { documento_id: x.id })).catch(toast.erro)}>Abrir</button></td></tr>)}
        </tbody></table> : <Vazio titulo="Nenhum documento anexado" />)}

        {aba === 'atribuicoes' && (d.atribuicoes.length ? <table><thead><tr><th>Data</th><th>Status</th><th>Operador</th><th>Atribuído por</th></tr></thead><tbody>
          {[...d.atribuicoes].sort((a, b) => (a.data_atribuicao < b.data_atribuicao ? 1 : -1)).map((a) => <tr key={a.id}><td>{dataHora(a.data_atribuicao)}</td><td><Badge status={a.status} /></td><td>{a.operador_nome}</td><td>{a.atribuido_por_nome}</td></tr>)}
        </tbody></table> : <Vazio titulo="Sem atribuições" />)}
      </div>

      {modal === 'whatsapp' && <PrepararWhatsApp caso={c} api={d.integracao_whatsapp === 'API'} onClose={() => setModal(null)} onRegistrado={recarregar} />}
      {modal === 'contato' && <FormModal titulo="Registrar contato" onClose={() => setModal(null)} campos={[
        { nome: 'canal', rotulo: 'Canal', tipo: 'select', opcoes: CANAIS, obrigatorio: true, padrao: 'TELEFONE', semVazio: true },
        { nome: 'tipo_interacao', rotulo: 'Tipo', tipo: 'select', opcoes: TIPOS, obrigatorio: true, padrao: 'LIGACAO', semVazio: true },
        { nome: 'resultado', rotulo: 'Resultado', tipo: 'select', opcoes: RESULTADOS },
        { nome: 'mensagem', rotulo: 'Mensagem / resumo do contato', tipo: 'textarea' },
        { nome: 'resposta', rotulo: 'Resposta do devedor', tipo: 'textarea' },
        { nome: 'proxima_acao', rotulo: 'Próxima ação', full: true },
        { nome: 'proxima_acao_data', rotulo: 'Data do retorno', tipo: 'data' },
        { nome: 'observacoes', rotulo: 'Observações internas', tipo: 'textarea' },
      ]} aviso={bloqueadoContato ? <div className="aviso critico">Só é possível registrar respostas recebidas e notas internas.</div> : <div className="aviso info">Até 3 tentativas de contato por dia, nos canais e horários autorizados. "Contestou" e "Solicitou interrupção" notificam o credor.</div>}
        onSubmit={async (v) => { await hs('registrarInteracao', { ...v, caso_id: c.id, resultado: v.resultado || undefined, proxima_acao_data: v.proxima_acao_data || undefined }); toast.ok('Contato registrado'); recarregar(); }} />}
      {modal === 'tarefa' && <FormModal titulo="Nova tarefa" onClose={() => setModal(null)} campos={[
        { nome: 'descricao', rotulo: 'Descrição', obrigatorio: true, full: true }, { nome: 'data_prazo', rotulo: 'Prazo', tipo: 'data', obrigatorio: true },
        { nome: 'prioridade', rotulo: 'Prioridade', tipo: 'select', opcoes: ['URGENTE', 'ALTA', 'NORMAL', 'BAIXA'], padrao: 'NORMAL', semVazio: true },
      ]} onSubmit={async (v) => { await hs('salvarTarefa', { ...v, caso_id: c.id }); toast.ok('Tarefa criada'); recarregar(); }} />}
      {modal === 'pagamento' && <RegistrarPagamento divida={dv} parcelas={d.parcelas} casoId={c.id} podeConfirmar={!s.ehHS && s.pode('pagamento.confirmar')} onClose={() => setModal(null)} onFeito={() => { toast.ok('Pagamento informado'); recarregar(); }} />}
      {modal?.tipo === 'acordo' && <FormModal titulo="Formalizar acordo" onClose={() => setModal(null)} botao="Formalizar" campos={[
        { nome: 'aceite_devedor', tipo: 'checkbox', obrigatorio: true, textoCheck: 'O devedor aceitou expressamente estas condições', full: true },
        { nome: 'data_aceite', rotulo: 'Data do aceite', tipo: 'data', obrigatorio: true, padrao: hojeISO() },
        { nome: 'meio_aceite', rotulo: 'Meio do aceite', tipo: 'select', opcoes: ['WHATSAPP', 'TELEFONE', 'EMAIL', 'PRESENCIAL', 'DOCUMENTO_ASSINADO'], padrao: 'WHATSAPP', semVazio: true },
      ]} aviso={<div className="aviso info">Valor acordado: <strong>{brl(modal.neg.valor_proposto_centavos)}</strong> ({modal.neg.entrada_centavos ? `entrada de ${brl(modal.neg.entrada_centavos)} + ` : ''}{modal.neg.quantidade_parcelas ? `${modal.neg.quantidade_parcelas}x de ${brl(modal.neg.valor_parcela_centavos)}` : 'à vista'}). Acordo não é dinheiro recuperado: o saldo só cai quando o credor confirmar os pagamentos.</div>}
        onSubmit={async (v) => { await hs('formalizarAcordo', { ...v, negociacao_id: modal.neg.id }); toast.ok('Acordo formalizado'); recarregar(); }} />}
    </div>
  );
}
