import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { publico } from '../api.js';
import { Marca } from '../layout.jsx';
import { WhatsAppFlutuante, linkWhatsApp } from '../whatsapp.jsx';
import { registrarVisita } from '../visitas.js';
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
    preco: 'Comissão só sobre o que entrar na sua conta, conforme o tempo de atraso (veja a tabela em Planos). Comece pelo Piloto Sem Risco: 10% nos primeiros 30 dias.',
    itens: [
      'Você escolhe quais dívidas encaminhar e autoriza os limites',
      'O Acorly valida a carteira e distribui entre os operadores',
      'Contatos por WhatsApp, telefone e e-mail, dentro das regras',
      'Propostas fora do limite chegam para a sua aprovação',
      'Você acompanha tudo em tempo real pelo seu painel',
    ],
  },
];

const PILOTO = [
  ['1. Diagnóstico grátis e anônimo', 'Você envia só o valor e a data de vencimento de cada atraso, sem nome, CPF ou telefone. Em até 2 dias úteis, recebe quanto dá para recuperar.'],
  ['2. Piloto de 30 dias', 'Até 20 devedores escolhidos por você (comece pelos que já saíram ou que você deu como perdidos). Você vê e aprova as mensagens e define os limites de desconto e parcelamento uma única vez.'],
  ['3. Você só paga se entrar', 'O devedor paga direto na conta da sua empresa. A comissão é de 10% sobre o que entrar durante os 30 dias do piloto. Se nada entrar, você não paga nada.'],
];

const GARANTIAS_PILOTO = [
  'Diagnóstico sem nenhum dado pessoal dos seus clientes',
  'Contrato com cláusulas de proteção de dados (LGPD) assinado antes de qualquer dado pessoal',
  'Mensagens com o nome da sua empresa, em tom cordial e sem ameaças',
  'Se um cliente seu reclamar, paramos o contato com ele na hora',
  'Sem mensalidade no piloto e sem fidelidade',
  'Depois dos 30 dias, vale a tabela normal por tempo de atraso (veja em Planos)',
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
  ['O que é o Piloto Sem Risco?', 'Um teste de 30 dias da cobrança gerenciada com até 20 devedores escolhidos por você. Você vê e aprova as mensagens, define os limites de desconto e parcelamento, o devedor paga direto na sua conta e você paga 10% só do que entrar nesses 30 dias. Se nada entrar, não paga nada. Depois do piloto, se você continuar, vale a tabela normal de comissão por tempo de atraso.'],
  ['Preciso mandar dados dos meus clientes para o diagnóstico?', 'Não. O diagnóstico usa só o valor e a data de vencimento de cada atraso. Se você enviar uma planilha com nomes, CPF ou telefones, essas colunas são removidas no seu próprio computador antes do envio. Dados pessoais só são compartilhados se você decidir começar o piloto, depois de assinar o contrato com as cláusulas de proteção de dados.'],
  ['Quanto custa a cobrança gerenciada?', 'Você paga uma comissão apenas sobre o que for efetivamente recebido, com percentual conforme o tempo de atraso da dívida (veja a tabela em Planos). Se nada for recebido, não há comissão. No Piloto Sem Risco, a comissão é de 10% sobre o que entrar nos 30 dias do piloto. Os percentuais ficam no contrato.'],
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
  const links = [['piloto', 'Piloto sem risco'], ['video', 'Vídeo'], ['como-funciona', 'Como funciona'], ['diagnostico', 'Diagnóstico grátis'], ['servicos', 'Serviços'], ['planos', 'Planos'], ['seguranca', 'Segurança'], ['duvidas', 'Dúvidas']];

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
            <span className="site-selo">Piloto Sem Risco</span>
            <h1>Recupere o que é seu sem perder o cliente.</h1>
            <p>Teste por 30 dias com até 20 devedores escolhidos por você. Você vê as mensagens antes, o devedor paga direto na conta da sua empresa e você <strong style={{ color: '#fff' }}>só paga 10% do que entrar nos 30 dias</strong>. Se nada entrar, não paga nada.</p>
            <div className="row">
              <Link className="btn prim site-btn-grande" to="/diagnostico">Começar pelo diagnóstico grátis</Link>
              <Link className="btn site-btn-grande site-btn-claro" to="/mensagens">Veja as mensagens</Link>
            </div>
            <p className="site-nota">Diagnóstico sem nome, CPF ou telefone dos seus clientes. Prefere cobrar com a sua equipe? <Link to="/cadastro" style={{ color: '#fff', textDecoration: 'underline' }}>Teste a plataforma grátis por {dados?.dias_teste || 7} dias</Link>, sem cartão.</p>
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

      <section id="piloto" className="site-secao">
        <div className="site-largura">
          <h2 className="site-titulo">Piloto Sem Risco: 30 dias, 20 devedores, você só paga se entrar</h2>
          <p className="site-sub">Para você conhecer a Acorly sem expor seus clientes e sem gastar nada antes do resultado.</p>
          <div className="site-piloto-passos">
            {PILOTO.map(([t, d]) => <article key={t} className="site-cartao"><h3 style={{ fontSize: 18 }}>{t}</h3><p style={{ margin: 0, lineHeight: 1.55 }}>{d}</p></article>)}
          </div>
          <ul className="site-piloto-garantias">{GARANTIAS_PILOTO.map((g) => <li key={g}>{g}</li>)}</ul>
          <div className="row" style={{ marginTop: 20 }}>
            <Link className="btn prim site-btn-grande" to="/diagnostico">Quero o diagnóstico grátis</Link>
            <Link className="btn site-btn-grande" to="/mensagens">Ver as mensagens que o devedor recebe</Link>
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>Para atender cada piloto com cuidado, abrimos poucas vagas por mês.</p>
        </div>
      </section>

      <section id="video" className="site-secao site-video">
        <div className="site-largura site-estreita" style={{ textAlign: 'center' }}>
          <h2 className="site-titulo">Veja o Acorly funcionando</h2>
          <p className="site-sub">Um passeio narrado de um minuto e meio: do cadastro da dívida ao acordo, ao boleto enviado ao devedor e à prestação de contas.</p>
          <video className="site-video-player" controls preload="none" playsInline poster="/video/acorly-demo.jpg">
            <source src="/video/acorly-demo.mp4" type="video/mp4" />
          </video>
          <p className="small muted">Prefere explorar sozinho? <a href="/demonstracao">Abra a demonstração</a>, com dados fictícios e sem cadastro.</p>
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

      <section id="diagnostico" className="site-secao site-chamada">
        <div className="site-largura site-estreita" style={{ textAlign: 'center' }}>
          <span className="site-selo" style={{ background: 'var(--azul-claro)', color: 'var(--azul)' }}>Gratuito e sem compromisso</span>
          <h2 className="site-titulo">Quanto da sua inadimplência dá para recuperar?</h2>
          <p className="site-sub">Envie só o valor e o vencimento de cada atraso, sem nome nem CPF. Em até 2 dias úteis, a equipe da HS devolve um diagnóstico: quanto pode ser recuperado, em quanto tempo e quanto custaria.</p>
          <div className="row" style={{ justifyContent: 'center' }}><Link className="btn prim site-btn-grande" to="/diagnostico">Quero meu diagnóstico gratuito</Link></div>
        </div>
      </section>

      <section id="planos" className="site-secao">
        <div className="site-largura">
          <h2 className="site-titulo">Planos da plataforma</h2>
          <p className="site-sub">Comece com {dados?.dias_teste || 7} dias grátis, sem cartão. Depois, preço mensal fixo: não cobramos porcentagem sobre o que você recuperar.</p>
          <div className="site-planos">
            {!dados ? <p className="muted">Carregando planos…</p> : dados.planos.length ? dados.planos.map((p, i) => (
              <article key={p.nome} className={`site-cartao site-plano ${i === 1 ? 'recomendado' : ''}`}>
                {i === 1 && <span className="site-selo-plano">Mais escolhido</span>}
                <h3>{p.nome}</h3>
                <div className="site-valor">{brl(p.preco_mensal_centavos)}<small>/mês</small></div>
                <p className="small muted">{p.limite_devedores ? `Até ${p.limite_devedores.toLocaleString('pt-BR')} devedores` : 'Devedores ilimitados'} · {p.limite_usuarios ? `${p.limite_usuarios} usuários` : 'usuários ilimitados'}</p>
                <ul className="site-check">{p.funcionalidades.map((f) => <li key={f}>{rotulo(f)}</li>)}</ul>
                <Link className={`btn ${i === 1 ? 'prim' : ''}`} to="/cadastro">Testar grátis por {dados?.dias_teste || 7} dias</Link>
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
          {dados?.redes && Object.keys(dados.redes).length > 0 && (
            <div className="stack small" style={{ gap: 6 }}>
              <strong>Redes sociais</strong>
              <div className="site-redes">{[['instagram', 'Instagram'], ['linkedin', 'LinkedIn'], ['facebook', 'Facebook'], ['youtube', 'YouTube'], ['tiktok', 'TikTok']].filter(([k]) => dados.redes[k]).map(([k, r]) => <a key={k} href={dados.redes[k]} target="_blank" rel="noreferrer noopener">{r}</a>)}</div>
            </div>
          )}
          {(contato.email || contato.whatsapp) && (
            <div className="stack small" style={{ gap: 6 }}>
              <strong>Fale conosco</strong>
              {contato.email && <span style={{ userSelect: 'all' }}>{contato.email}</span>}
              {contato.whatsapp && <a onClick={() => registrarVisita('WHATSAPP')} href={linkWhatsApp(contato.whatsapp, 'Olá! Vim pelo site da Acorly e gostaria de saber mais.')} target="_blank" rel="noreferrer">WhatsApp {mascaraFone(contato.whatsapp)}</a>}
            </div>
          )}
        </div>
      </footer>
      <WhatsAppFlutuante />
    </div>
  );
}
