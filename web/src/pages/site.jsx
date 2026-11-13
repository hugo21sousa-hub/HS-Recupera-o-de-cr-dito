import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { publico } from '../api.js';
import { Marca } from '../layout.jsx';
import { brl, rotulo, mascaraFone, pct } from '../format.js';

const SERVICOS = [
  {
    nome: 'Acorly Plataforma',
    resumo: 'Sua equipe cobra pelo sistema.',
    preco: 'Assinatura mensal, sem comissão sobre o que você recuperar.',
    itens: [
      'Cadastro de clientes devedores e dívidas, ou importação por planilha',
      'Histórico de contatos, tarefas e retornos agendados',
      'Simulador de negociação, acordos e parcelas',
      'Conferência e confirmação dos pagamentos recebidos',
      'Dashboard e relatórios em PDF e planilha',
    ],
  },
  {
    nome: 'Acorly Cobrança Gerenciada',
    resumo: 'A equipe Acorly cobra por você.',
    preco: 'Contrato próprio, por carteira, pacote de casos ou carteira completa.',
    itens: [
      'Você escolhe quais dívidas encaminhar e autoriza os limites',
      'O Acorly valida a carteira e distribui entre os operadores',
      'Contatos por WhatsApp, telefone e e-mail, dentro das regras',
      'Propostas fora do limite chegam para a sua aprovação',
      'Você acompanha tudo em tempo real pelo seu painel',
    ],
  },
];

const PASSOS = [
  ['Cadastre', 'Inclua os clientes devedores e as dívidas, com documentos, ou importe uma planilha.'],
  ['Cobre ou encaminhe', 'Conduza a cobrança com a sua equipe ou envie à equipe Acorly, com autorização expressa e limites definidos por você.'],
  ['Negocie', 'Simule desconto, entrada e parcelas. Propostas fora do limite autorizado só seguem com a sua aprovação.'],
  ['Confirme o recebimento', 'O devedor paga direto para a sua empresa. Você confere no extrato e confirma, e o saldo é atualizado.'],
];

const GARANTIAS = [
  ['O dinheiro vai direto para você', 'O Acorly não recebe valores de devedores, não guarda saldo e não faz repasses.'],
  ['Números reais', 'Só pagamentos confirmados por você contam como recuperados. Propostas e acordos aparecem separados.'],
  ['Cobrança respeitosa', 'O sistema bloqueia mensagens com ameaça ou exposição, limita tentativas diárias e respeita quem pede para não ser contatado (CDC).'],
  ['Dados protegidos (LGPD)', 'Cada empresa enxerga só os próprios dados. Há registro de autorizações, atendimento ao titular e retenção configurável.'],
  ['Acesso seguro', 'Senhas protegidas, verificação em duas etapas para a equipe Acorly e trilha de auditoria de cada alteração.'],
  ['Sem instalar nada', 'Funciona no navegador do computador e do celular, com conexão protegida (HTTPS).'],
];

const DUVIDAS = [
  ['O Acorly recebe o dinheiro das dívidas?', 'Não. O devedor paga diretamente para a sua empresa, pelos meios que você já usa (Pix, boleto, transferência). Você confirma o recebimento no sistema.'],
  ['Preciso contratar a cobrança gerenciada para usar o Acorly?', 'Não. Você pode usar só a plataforma e cobrar com a sua equipe, contratar a cobrança gerenciada ou usar as duas formas ao mesmo tempo.'],
  ['Quanto custa a cobrança gerenciada?', 'Você paga uma comissão apenas sobre o que for efetivamente recebido, com percentual conforme o tempo de atraso da dívida (veja a tabela de referência em Planos). Se nada for recebido, não há comissão. Os percentuais finais são combinados com cada empresa e ficam no contrato. A contratação é feita por contrato próprio, por carteira específica, pacote de casos ou carteira completa.'],
  ['Outras empresas podem ver os meus dados?', 'Não. Cada empresa tem um ambiente isolado. A equipe Acorly só acessa os casos que você encaminhar e autorizar.'],
  ['Como a equipe Acorly negocia em meu nome?', 'Dentro dos limites que você define: desconto máximo, número de parcelas, entrada mínima, canais e horários de contato. Fora disso, a proposta vai para a sua aprovação.'],
  ['Posso importar a minha lista de devedores?', 'Sim. Basta uma planilha CSV (o Excel salva nesse formato). O sistema mostra uma prévia com os erros antes de importar.'],
];

export function Site() {
  const [dados, setDados] = useState(null);
  const [menu, setMenu] = useState(false);
  useEffect(() => { publico().then(setDados).catch(() => setDados({ planos: [], contato: {} })); }, []);
  const ano = new Date().getFullYear();
  const contato = dados?.contato || {};
  const ir = (id) => (e) => { e.preventDefault(); setMenu(false); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const links = [['como-funciona', 'Como funciona'], ['servicos', 'Serviços'], ['planos', 'Planos'], ['seguranca', 'Segurança'], ['duvidas', 'Dúvidas']];

  return (
    <div className="site">
      <header className="site-topo">
        <div className="site-largura site-topo-in">
          <Marca escura />
          <nav className={`site-nav ${menu ? 'aberto' : ''}`} aria-label="Seções">
            {links.map(([id, r]) => <a key={id} href={`#${id}`} onClick={ir(id)}>{r}</a>)}
          </nav>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <Link className="btn" to="/entrar">Entrar</Link>
            <Link className="btn prim site-oculta-cel" to="/cadastro">Criar conta</Link>
            <button className="btn icone site-menu" aria-label="Abrir menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>☰</button>
          </div>
        </div>
      </header>

      <section className="site-hero">
        <div className="site-largura site-hero-in">
          <div className="site-hero-texto">
            <span className="site-selo">Recuperação de crédito para empresas</span>
            <h1>Recupere o que é seu, com organização e respeito ao seu cliente.</h1>
            <p>O Acorly reúne em um só lugar o cadastro de dívidas, a cobrança, as negociações e a confirmação de pagamentos. Use a plataforma com a sua equipe ou deixe a cobrança com a equipe Acorly, acompanhando tudo pelo seu painel.</p>
            <div className="row">
              <Link className="btn prim site-btn-grande" to="/cadastro">Criar conta da empresa</Link>
              <Link className="btn site-btn-grande site-btn-claro" to="/entrar">Acessar o sistema</Link>
            </div>
            <p className="site-nota">O devedor paga direto para a sua empresa. Sem comissão no uso da plataforma.</p>
          </div>
          <div className="site-previa" aria-label="Exemplo de painel do sistema">
            <div className="site-previa-barra"><span /><span /><span /><em>Painel da empresa (exemplo)</em></div>
            <div className="site-previa-corpo">
              <div className="site-previa-kpi destaque"><small>Recebido e confirmado</small><strong>R$ 18.420,00</strong></div>
              <div className="site-previa-kpi"><small>Em negociação</small><strong>R$ 6.310,00</strong></div>
              <div className="site-previa-kpi"><small>Saldo pendente</small><strong>R$ 42.980,00</strong></div>
              <ul className="site-previa-lista">
                <li><span>Maria S.</span><b className="badge ok">Pagamento confirmado</b></li>
                <li><span>João P.</span><b className="badge alerta">Acordo em 3x</b></li>
                <li><span>Pedro A.</span><b className="badge info">Em contato</b></li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section id="como-funciona" className="site-secao">
        <div className="site-largura">
          <h2 className="site-titulo">Como funciona</h2>
          <ol className="site-passos">
            {PASSOS.map(([t, d], i) => <li key={t}><span className="site-num">{i + 1}</span><h3>{t}</h3><p>{d}</p></li>)}
          </ol>
        </div>
      </section>

      <section id="servicos" className="site-secao site-secao-alt">
        <div className="site-largura">
          <h2 className="site-titulo">Dois jeitos de recuperar</h2>
          <p className="site-sub">Comece com um e mude quando quiser. Também dá para usar os dois ao mesmo tempo: parte das dívidas com a sua equipe e parte com o Acorly.</p>
          <div className="site-servicos">
            {SERVICOS.map((s) => (
              <article key={s.nome} className="site-cartao">
                <h3>{s.nome}</h3>
                <p className="site-resumo">{s.resumo}</p>
                <ul className="site-check">{s.itens.map((i) => <li key={i}>{i}</li>)}</ul>
                <p className="site-preco-nota">{s.preco}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="planos" className="site-secao">
        <div className="site-largura">
          <h2 className="site-titulo">Planos da plataforma</h2>
          <p className="site-sub">Preço mensal fixo. Não cobramos porcentagem sobre o que você recuperar.</p>
          <div className="site-planos">
            {!dados ? <p className="muted">Carregando planos…</p> : dados.planos.length ? dados.planos.map((p, i) => (
              <article key={p.nome} className={`site-cartao site-plano ${i === 1 ? 'recomendado' : ''}`}>
                {i === 1 && <span className="site-selo-plano">Mais escolhido</span>}
                <h3>{p.nome}</h3>
                <div className="site-valor">{brl(p.preco_mensal_centavos)}<small>/mês</small></div>
                <p className="small muted">{p.limite_devedores ? `Até ${p.limite_devedores.toLocaleString('pt-BR')} devedores` : 'Devedores ilimitados'} · {p.limite_usuarios ? `${p.limite_usuarios} usuários` : 'usuários ilimitados'}</p>
                <ul className="site-check">{p.funcionalidades.map((f) => <li key={f}>{rotulo(f)}</li>)}</ul>
                <Link className={`btn ${i === 1 ? 'prim' : ''}`} to="/cadastro">Começar com este plano</Link>
              </article>
            )) : <p className="muted">Fale conosco para conhecer os planos.</p>}
          </div>
          <div className="site-cartao site-comissao">
            <div>
              <h3>Cobrança gerenciada pela equipe Acorly</h3>
              <p className="site-resumo">Você só paga sobre o que recuperar.</p>
              <p className="small muted" style={{ margin: 0 }}>A comissão é um percentual sobre os valores <strong>efetivamente recebidos e confirmados</strong> por você, conforme o tempo de atraso da dívida no dia em que ela é encaminhada. Se nada for recebido, não há comissão. A tabela ao lado é a referência do Acorly: as condições finais são combinadas com cada empresa e ficam no contrato. Você vê o percentual de cada dívida antes de encaminhar.</p>
            </div>
            {dados?.comissao?.length > 0 && (
              <table className="site-tabela-comissao">
                <thead><tr><th>Atraso da dívida</th><th className="num">Comissão de referência</th></tr></thead>
                <tbody>{dados.comissao.map((f) => <tr key={f.faixa}><td>{f.faixa}</td><td className="num"><strong>{pct(f.bps)}</strong></td></tr>)}</tbody>
              </table>
            )}
          </div>
          <p className="site-nota-centro">A cobrança gerenciada é contratada à parte da assinatura, com contrato próprio para a sua carteira.</p>
        </div>
      </section>

      <section id="seguranca" className="site-secao site-secao-escura">
        <div className="site-largura">
          <h2 className="site-titulo">Feito para dar confiança a você e ao seu cliente</h2>
          <div className="site-garantias">
            {GARANTIAS.map(([t, d]) => <div key={t}><h3>{t}</h3><p>{d}</p></div>)}
          </div>
        </div>
      </section>

      <section id="duvidas" className="site-secao">
        <div className="site-largura site-estreita">
          <h2 className="site-titulo">Dúvidas frequentes</h2>
          <div className="site-faq">
            {DUVIDAS.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
          </div>
        </div>
      </section>

      <section className="site-secao site-chamada">
        <div className="site-largura site-estreita" style={{ textAlign: 'center' }}>
          <h2 className="site-titulo">Pronto para organizar a sua recuperação de crédito?</h2>
          <p className="site-sub">Crie a conta da sua empresa em poucos minutos e comece a cadastrar as dívidas.</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Link className="btn prim site-btn-grande" to="/cadastro">Criar conta da empresa</Link>
            <Link className="btn site-btn-grande" to="/entrar">Já tenho conta</Link>
          </div>
        </div>
      </section>

      <footer className="site-rodape">
        <div className="site-largura site-rodape-in">
          <div className="stack" style={{ gap: 6 }}>
            <Marca escura />
            <span className="small muted">© {ano} Acorly · uma plataforma da HS Recuperação de Crédito</span>
          </div>
          <div className="stack small" style={{ gap: 6 }}>
            <Link to="/termos">Termos de Uso</Link>
            <Link to="/privacidade">Política de Privacidade</Link>
          </div>
          {(contato.email || contato.whatsapp) && (
            <div className="stack small" style={{ gap: 6 }}>
              <strong>Fale conosco</strong>
              {contato.email && <span style={{ userSelect: 'all' }}>{contato.email}</span>}
              {contato.whatsapp && <a href={`https://wa.me/${String(contato.whatsapp).replace(/\D/g, '')}`} target="_blank" rel="noreferrer">WhatsApp {mascaraFone(contato.whatsapp)}</a>}
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
