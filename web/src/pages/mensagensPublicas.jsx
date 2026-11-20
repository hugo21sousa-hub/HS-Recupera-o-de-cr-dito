// Página pública "Veja as mensagens": o que o cliente devedor recebe quando a Acorly cobra.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { publico } from '../api.js';
import { Marca } from '../layout.jsx';
import { WhatsAppFlutuante } from '../whatsapp.jsx';

const ORDEM = ['Primeiro contato', 'Lembrete', 'Proposta de acordo', 'Lembrete de parcela do acordo'];

export function MensagensPublicas() {
  const [dados, setDados] = useState(null);
  useEffect(() => { publico().then(setDados).catch(() => setDados({ mensagens_exemplo: [] })); }, []);
  const msgs = (dados?.mensagens_exemplo || []).slice().sort((a, b) => (ORDEM.indexOf(a.nome) + 99 * (a.canal === 'EMAIL')) - (ORDEM.indexOf(b.nome) + 99 * (b.canal === 'EMAIL')));
  const whats = msgs.filter((m) => m.canal === 'WHATSAPP');
  const emails = msgs.filter((m) => m.canal === 'EMAIL');
  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '32px 16px' }} className="stack">
      <div className="row between"><Link to="/" aria-label="Voltar ao site"><Marca escura /></Link><Link className="btn sm" to="/">Voltar ao site</Link></div>
      <div className="stack" style={{ gap: 6 }}>
        <h1 style={{ margin: 0 }}>O que o seu cliente recebe quando a Acorly cobra</h1>
        <p className="muted" style={{ margin: 0 }}>Estas são as mensagens usadas na cobrança, com dados de exemplo. Elas saem com o <strong>nome da sua empresa</strong>, em tom cordial, sem ameaça e sem expor ninguém. No Piloto Sem Risco, você vê e aprova as mensagens antes de qualquer contato e pode pedir ajustes.</p>
      </div>
      {!dados ? <p className="muted">Carregando…</p> : (
        <>
          <h2 style={{ margin: '8px 0 0' }}>No WhatsApp</h2>
          <div className="stack" style={{ gap: 10 }}>
            {whats.map((m) => (
              <div key={m.nome} className="card stack" style={{ gap: 6 }}>
                <strong className="small" style={{ color: 'var(--texto-2)' }}>{m.nome}</strong>
                <div className="msg-exemplo-whats">{m.texto}</div>
              </div>
            ))}
          </div>
          <h2 style={{ margin: '8px 0 0' }}>Por e-mail</h2>
          <div className="stack" style={{ gap: 10 }}>
            {emails.map((m) => (
              <div key={m.nome} className="card stack" style={{ gap: 6 }}>
                <strong className="small" style={{ color: 'var(--texto-2)' }}>{m.nome}</strong>
                <div className="small"><strong>Assunto:</strong> {m.assunto}</div>
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.55 }}>{m.texto}</div>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="card stack" style={{ gap: 6 }}>
        <strong>As regras que valem em toda cobrança</strong>
        <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
          <li>Contato só no horário que você autorizar (por padrão, das 8h às 20h) e com limite de tentativas por dia.</li>
          <li>O sistema bloqueia mensagens com ameaça, palavras ofensivas ou exposição do devedor (Código de Defesa do Consumidor, art. 42).</li>
          <li>A cobrança é feita só com o próprio devedor: não contatamos familiares, vizinhos ou colegas de trabalho.</li>
          <li>Quem pede para não ser contatado tem o pedido respeitado na hora. Se o seu cliente reclamar, o contato com ele para.</li>
          <li>O pagamento é feito direto na conta da sua empresa; a Acorly não recebe valores.</li>
        </ul>
      </div>
      <div className="row" style={{ justifyContent: 'center' }}><Link className="btn prim" to="/diagnostico">Quero o diagnóstico gratuito</Link><a className="btn" href="/#piloto">Conhecer o Piloto Sem Risco</a></div>
      <WhatsAppFlutuante texto="Olá! Vi as mensagens de cobrança da Acorly no site e tenho uma dúvida." />
    </div>
  );
}
