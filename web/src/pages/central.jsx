// Central de mensagens: fila de contatos do dia e histórico de mensagens.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSessao } from '../sessao.jsx';
import { Tabela, Cabecalho, useApi, Carregando, ErroCarga, Vazio, Abas, Badge } from '../ui.jsx';
import { brl, dataHora, rotulo } from '../format.js';
import { EnviarMensagem, RegistrarResposta } from '../mensagens.jsx';

function FilaDoDia() {
  const s = useSessao();
  const { data: d, carregando, erro, recarregar } = useApi('filaDoDia', {});
  const [modal, setModal] = useState(null);
  if (erro) return <ErroCarga erro={erro} onRetry={recarregar} />;
  if (carregando && !d) return <Carregando linhas={6} />;
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>Quem contatar hoje: retornos agendados, parcelas de acordo vencendo, primeiro contato e casos sem contato há 3 dias ou mais. Devedores que pediram para não ser contatados ou que já receberam {d.limite_diario} contatos hoje não aparecem.</p>
      {d.itens.length ? (
        <div className="tabela-wrap"><table>
          <thead><tr><th>Devedor</th>{s.ehHS && <th>Credor</th>}<th>Por que contatar</th><th className="num">Saldo</th><th>Hoje</th><th></th></tr></thead>
          <tbody>{d.itens.map((i) => (
            <tr key={i.caso_id}>
              <td><Link to={`/casos/${i.caso_id}`}><strong>{i.devedor_nome}</strong></Link><div className="small muted">{rotulo(i.status_operacional)}</div></td>
              {s.ehHS && <td>{i.credor}</td>}
              <td>{i.motivos.map((m) => <div key={m} className="small">{m}</div>)}</td>
              <td className="num">{i.saldo_atual_centavos != null ? brl(i.saldo_atual_centavos) : '—'}</td>
              <td><Badge status={i.contatos_hoje ? 'PENDENTE' : 'info'}>{i.contatos_hoje}/{d.limite_diario}</Badge></td>
              <td className="right"><div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                {i.tem_whatsapp && <button className="btn sm prim" onClick={() => setModal({ tipo: 'enviar', caso: i.caso_id, canal: 'WHATSAPP' })}>WhatsApp</button>}
                {i.tem_email && <button className="btn sm" onClick={() => setModal({ tipo: 'enviar', caso: i.caso_id, canal: 'EMAIL' })}>E-mail</button>}
                <button className="btn sm" onClick={() => setModal({ tipo: 'resposta', caso: i.caso_id })}>Resposta</button>
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <Vazio titulo="Nenhum contato pendente para hoje">Os casos aparecem aqui conforme os retornos agendados, as parcelas e o tempo sem contato.</Vazio>}
      {modal?.tipo === 'enviar' && <EnviarMensagem casoId={modal.caso} canalInicial={modal.canal} emailDisponivel={d.email_cobranca} apiWhatsApp={d.whatsapp_api} onClose={() => { setModal(null); recarregar(); }} onEnviado={() => {}} />}
      {modal?.tipo === 'resposta' && <RegistrarResposta casoId={modal.caso} onClose={() => setModal(null)} onFeito={recarregar} />}
    </div>
  );
}

function Historico() {
  const s = useSessao();
  return (
    <Tabela acao="listarInteracoes" busca={false} colunas={[
      { titulo: 'Data', render: (i) => dataHora(i.data_hora) },
      ...(s.ehHS ? [{ titulo: 'Credor', campo: 'credor' }] : []),
      { titulo: 'Devedor', render: (i) => <Link to={`/casos/${i.caso_id}`}>{i.devedor_nome}</Link> },
      { titulo: 'Canal', render: (i) => rotulo(i.canal) },
      { titulo: 'Tipo', render: (i) => <>{rotulo(i.tipo_interacao)}{i.cancelada && <div className="small muted">envio desfeito</div>}</> },
      { titulo: 'Quem', campo: 'operador_nome' },
      { titulo: 'Mensagem', render: (i) => <span className="small">{(i.resposta || i.mensagem || '').slice(0, 110)}</span> },
    ]} vazio={<Vazio titulo="Nenhuma mensagem registrada" />} />
  );
}

export function CentralMensagens() {
  const [aba, setAba] = useState('fila');
  return (
    <div className="stack">
      <Cabecalho titulo="Central de mensagens" sub="Contatos do dia, envio por WhatsApp e e-mail e histórico de tudo o que foi enviado e respondido." />
      <div className="card">
        <Abas ativa={aba} onChange={setAba} abas={[{ id: 'fila', rotulo: 'Fila do dia' }, { id: 'historico', rotulo: 'Histórico' }]} />
        {aba === 'fila' ? <FilaDoDia /> : <Historico />}
      </div>
    </div>
  );
}
