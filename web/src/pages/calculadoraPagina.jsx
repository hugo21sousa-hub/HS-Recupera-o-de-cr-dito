// Página própria da calculadora (acorly.com.br/calculadora), para links em e-mails e redes sociais.
import { Link } from 'react-router-dom';
import { Marca } from '../layout.jsx';
import { WhatsAppFlutuante } from '../whatsapp.jsx';
import { Calculadora } from '../calculadora.jsx';

export function CalculadoraPagina() {
  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 16px' }} className="stack">
      <div className="row between"><Link to="/" aria-label="Voltar ao site"><Marca escura /></Link><Link className="btn sm" to="/">Conhecer a Acorly</Link></div>
      <div className="stack" style={{ gap: 6, textAlign: 'center', alignItems: 'center' }}>
        <h1 style={{ margin: '12px 0 0' }}>Quanto a inadimplência está custando para a sua escola?</h1>
        <p className="muted" style={{ margin: 0, maxWidth: '60ch' }}>Informe três números e veja, em segundos, quanto dinheiro está parado em mensalidades atrasadas e quanto pode voltar ao caixa.</p>
      </div>
      <Calculadora />
      <WhatsAppFlutuante texto="Olá! Usei a calculadora de inadimplência da Acorly e queria entender melhor." />
    </div>
  );
}
