// Termos de Uso e Política de Privacidade (textos aprovados pelo jurídico da HS).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { publico } from '../api.js';
import { Marca } from '../layout.jsx';
import { mascaraFone } from '../format.js';

export const VERSAO_TERMOS = '2.0';
export const VIGENCIA_TERMOS = '14/11/2026';

const HS = 'HS RECUPERAÇÃO DE CRÉDITO, CNPJ 37.573.934/0001-22, com sede na Rua Júlia Fetal, 05, casa 02, Nazaré, Salvador/BA, CEP 40040-350';

function termos({ email, whatsapp }) {
  return [
    ['1. Partes e aceite', [
      `1.1. Estes Termos regulam o uso da plataforma Acorly, de titularidade da ${HS}, e-mail ${email} ("HS").`,
      '1.2. Ao criar uma conta ou usar a plataforma, a empresa ("Cliente") e cada pessoa que a acessa em nome dela ("Usuário") declaram ter lido e aceitado estes Termos e a Política de Privacidade. O aceite é registrado eletronicamente com data, hora e identificação do usuário.',
      '1.3. Quem aceita em nome do Cliente declara ter poderes para isso.',
    ]],
    ['2. Definições', [
      'Plataforma: o sistema Acorly, acessado em acorly.com.br. Devedor: a pessoa física ou jurídica que deve ao Cliente. Cobrança própria: cobrança feita pelo Cliente com as ferramentas da Plataforma. Cobrança gerenciada: cobrança extrajudicial feita pela equipe da HS, regida por contrato específico.',
    ]],
    ['3. Serviços', [
      '3.1. A Plataforma permite cadastrar devedores e dívidas, registrar contatos, negociar, formalizar acordos, acompanhar pagamentos e emitir relatórios.',
      '3.2. A cobrança gerenciada é opcional e depende de contrato próprio, aceito eletronicamente na Plataforma. Em caso de conflito, prevalece o contrato quanto a esse serviço.',
      '3.3. A HS não garante a recuperação de nenhum crédito.',
    ]],
    ['4. Conta e segurança', [
      '4.1. O Cliente indica seus Usuários e os perfis de acesso de cada um, e responde pelos atos praticados com essas contas.',
      '4.2. O acesso exige senha pessoal e verificação em duas etapas (código enviado ao e-mail ou aplicativo autenticador). Senhas e códigos não devem ser compartilhados.',
      '4.3. O Cliente deve avisar a HS imediatamente sobre qualquer uso não autorizado.',
    ]],
    ['5. Teste grátis, planos e pagamento', [
      '5.1. Toda nova empresa tem 7 dias de teste grátis, com os limites informados na Plataforma, sem necessidade de cartão.',
      '5.2. Depois do teste, o uso continua mediante assinatura mensal do plano escolhido, paga por Pix, boleto ou cartão através do Asaas. Cada plano tem os limites e recursos informados na Plataforma.',
      '5.3. Sem assinatura após o teste, ou com mensalidade em atraso por mais de 5 dias, o acesso fica somente para consulta e exportação, até a regularização.',
      '5.4. O Cliente pode cancelar a qualquer momento, sem multa. O mês já pago não é reembolsado.',
      '5.5. Os preços podem ser reajustados com aviso de 30 dias.',
      '5.6. A cobrança gerenciada é remunerada conforme o seu contrato e é cobrada separadamente da assinatura.',
    ]],
    ['6. Obrigações do Cliente', [
      'O Cliente declara e garante que: (a) os créditos cadastrados são legítimos, existentes, exigíveis e documentados; (b) tem base legal (LGPD) para tratar e compartilhar os dados dos devedores; (c) mantém os dados corretos e atualizados; (d) usará a Plataforma de acordo com a lei, em especial o Código de Defesa do Consumidor e a LGPD.',
      'O Cliente responde sozinho por cobranças indevidas e indenizará a HS por qualquer prejuízo decorrente delas.',
    ]],
    ['7. Condutas proibidas', [
      'É proibido: ameaçar, constranger, expor ao ridículo ou usar linguagem ofensiva com devedores (CDC, arts. 42 e 71); contatar terceiros sobre a dívida; cobrar dívidas inexistentes, pagas ou prescritas; enviar mensagens em massa não solicitadas; tentar burlar a segurança ou os limites da Plataforma.',
      'A Plataforma bloqueia mensagens com termos abusivos e limita os contatos diários. A violação permite a suspensão imediata do acesso.',
    ]],
    ['8. Pagamentos dos devedores', [
      'Os devedores pagam diretamente ao Cliente. A HS não recebe, não guarda e não repassa valores de dívidas.',
      'Só pagamentos confirmados pelo Cliente contam como recuperados, observado o contrato de cobrança gerenciada quanto à confirmação por decurso de prazo.',
    ]],
    ['9. Disponibilidade e suporte', [
      'A HS empregará esforços razoáveis para manter a Plataforma disponível, com backups diários. Podem ocorrer interrupções para manutenção ou por falhas de terceiros (internet, hospedagem, e-mail, WhatsApp).',
      `O suporte é prestado por ${email}${whatsapp ? ` e pelo WhatsApp ${mascaraFone(whatsapp)}` : ''}.`,
    ]],
    ['10. Dados pessoais', [
      '10.1. Quanto aos dados dos devedores, o Cliente é o controlador e a HS atua como operadora.',
      '10.2. Quanto aos dados de cadastro do Cliente e dos Usuários, a HS é controladora.',
      '10.3. Os detalhes estão na Política de Privacidade, que integra estes Termos.',
    ]],
    ['11. Propriedade intelectual', [
      'A Plataforma, a marca Acorly, o código e os layouts pertencem à HS. O Cliente recebe licença de uso não exclusiva e intransferível enquanto durar a assinatura. Os dados inseridos pelo Cliente continuam sendo do Cliente.',
    ]],
    ['12. Limitação de responsabilidade', [
      'A responsabilidade total da HS fica limitada ao valor pago pelo Cliente nos 3 meses anteriores ao fato.',
      'A HS não responde por lucros cessantes ou danos indiretos, pela não recuperação de créditos, por informações incorretas inseridas pelo Cliente nem por falhas de serviços de terceiros.',
    ]],
    ['13. Suspensão e encerramento', [
      'A HS pode suspender ou encerrar o acesso em caso de violação destes Termos, inadimplência ou exigência legal.',
      'Após o encerramento, o Cliente pode exportar seus dados por 30 dias. Depois disso, os dados são eliminados ou anonimizados, salvo os que a lei mandar guardar.',
    ]],
    ['14. Alterações', [
      'Estes Termos podem ser alterados com aviso de 15 dias na Plataforma ou por e-mail. O uso após a vigência da nova versão significa concordância.',
    ]],
    ['15. Disposições gerais', [
      'Aplica-se a lei brasileira. Comunicações por e-mail e pela Plataforma são válidas. Fica eleito o foro da comarca de Salvador/BA.',
    ]],
  ];
}

function privacidade({ email, dpo }) {
  return [
    ['1. Quem somos', [
      `Controlador: ${HS}.`,
      `Encarregado pelo tratamento de dados (DPO): ${dpo ? `${dpo}, pelo e-mail ${email}` : `pelo e-mail ${email}`}.`,
    ]],
    ['2. A quem se aplica', [
      'Aos usuários da Plataforma (empresas clientes e seus colaboradores), aos devedores cujos dados são inseridos pelos clientes e aos visitantes do site acorly.com.br.',
    ]],
    ['3. Papéis', [
      'Os dados de devedores são de responsabilidade da empresa credora (controladora). A HS trata esses dados como operadora, seguindo as instruções da credora, inclusive quando executa a cobrança gerenciada.',
      'Os dados de cadastro de empresas e usuários e os dados técnicos de acesso são tratados pela HS como controladora.',
    ]],
    ['4. Dados tratados', [
      'Clientes e usuários: razão social, CNPJ, endereço, nome, e-mail, telefone, cargo ou perfil, dados de faturamento e registros de aceite.',
      'Devedores: nome, CPF/CNPJ, telefone, WhatsApp, e-mail, endereço, dados das dívidas, documentos comprobatórios, histórico de contatos, propostas, acordos e pagamentos.',
      'Dados técnicos: endereço IP, data e hora de acesso, registros de auditoria e cookie de sessão.',
    ]],
    ['5. Finalidades e bases legais (LGPD, art. 7º)', [
      'Prestar o serviço e cumprir o contrato com o cliente: execução de contrato (V).',
      'Cobrança, negociação e proteção do crédito: exercício regular de direitos (VI) e proteção do crédito (X), por conta e ordem da credora.',
      'Segurança, prevenção a fraudes e registros de acesso: cumprimento de obrigação legal (II; Marco Civil da Internet, art. 15) e legítimo interesse (IX).',
      'Faturamento e obrigações fiscais: obrigação legal (II).',
      'Comunicações sobre o serviço (avisos, códigos de acesso e prestações de contas): execução de contrato (V).',
    ]],
    ['6. Compartilhamento', [
      'Os dados são compartilhados somente com: (a) a empresa credora, quanto aos seus próprios devedores; (b) fornecedores necessários à operação, que atuam como suboperadores: Render (hospedagem do sistema, EUA), Supabase (banco de dados e arquivos, EUA), Brevo (envio de e-mails, União Europeia), Asaas (cobrança das assinaturas, Brasil) e Meta/WhatsApp, quando a integração oficial estiver ativa; (c) autoridades, quando houver obrigação legal ou ordem judicial.',
      'A HS não vende dados pessoais e não os usa para publicidade.',
    ]],
    ['7. Transferência internacional', [
      'Parte da infraestrutura fica fora do Brasil (EUA e União Europeia). Essas transferências são feitas com fornecedores que oferecem garantias de proteção compatíveis com a LGPD (art. 33).',
    ]],
    ['8. Retenção', [
      'Dados de devedores: pelo prazo configurado pela credora (padrão de 60 meses após a quitação ou o encerramento) ou pelo prazo exigido em lei; depois disso, são anonimizados ou eliminados automaticamente.',
      'Registros de acesso: no mínimo 6 meses (Marco Civil da Internet). Dados fiscais e contratuais: pelos prazos legais.',
      'Pedidos de diagnóstico enviados pelo site que não resultarem em contratação: até 12 meses, com eliminação da planilha enviada.',
    ]],
    ['9. Segurança', [
      'Acesso por perfil, isolamento entre empresas, verificação em duas etapas, senhas protegidas por hash, arquivos privados com links temporários, comunicação criptografada (HTTPS), trilha de auditoria e backups diários.',
      'Incidentes de segurança relevantes serão comunicados aos afetados e à ANPD, nos termos da lei.',
    ]],
    ['10. Direitos do titular (LGPD, art. 18)', [
      'O titular pode pedir: confirmação e acesso aos dados; correção; anonimização, bloqueio ou eliminação de dados desnecessários; portabilidade; informação sobre compartilhamento; oposição; e revogação do consentimento, quando aplicável. O devedor pode também pedir para não ser mais contatado por um canal, por exemplo pelo link de descadastro dos e-mails.',
      `Os pedidos podem ser feitos à empresa credora ou ao encarregado da HS, em ${email}. Quando o pedido envolver dados controlados pela credora, a HS o encaminhará a ela. Prazo de resposta: até 15 dias.`,
    ]],
    ['11. Cookies', [
      'O site e a Plataforma usam somente um cookie essencial de sessão, para manter o usuário conectado com segurança. Não há cookies de publicidade nem de rastreamento.',
      'Nas páginas públicas do site (não na Plataforma nem nas páginas de pagamento), usamos a tag do Google Ads para saber se uma visita veio de um anúncio e se resultou em pedido de diagnóstico, cadastro ou contato. Ela funciona no modo de consentimento negado: não grava cookies, não personaliza anúncios e não recebe nome, e-mail, telefone ou dados de planilhas. Quem ativa "Não rastrear" no navegador fica de fora.',
      'Para medir o alcance do site, contamos as visitas de forma anônima e sem cookies: registramos a página vista, a origem da visita (por exemplo, Instagram ou Google) e o tipo de aparelho, associados a um código que muda todo dia e não permite identificar o visitante. O endereço IP não é armazenado para essa finalidade.',
    ]],
    ['12. Crianças e adolescentes', ['A Plataforma não é destinada a menores de 18 anos.']],
    ['13. Alterações', [
      'Esta Política pode ser atualizada. A versão vigente fica sempre em acorly.com.br/privacidade, com a data de vigência. Mudanças relevantes são avisadas aos clientes.',
    ]],
  ];
}

export function Documento({ tipo }) {
  const ehTermos = tipo === 'termos';
  const [dados, setDados] = useState(null);
  useEffect(() => { publico().then(setDados).catch(() => setDados({})); }, []);
  const contato = { email: dados?.contato?.email || 'contato@acorly.com.br', whatsapp: dados?.contato?.whatsapp || null, dpo: dados?.dpo || null };
  const secoes = ehTermos ? termos(contato) : privacidade(contato);
  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '32px 16px' }} className="stack">
      <div className="row between"><Link to="/" aria-label="Voltar ao site"><Marca escura /></Link><Link className="btn sm" to="/">Voltar</Link></div>
      <div className="card stack documento-legal">
        <div>
          <h1 style={{ marginBottom: 4 }}>{ehTermos ? 'Termos de Uso da plataforma Acorly' : 'Política de Privacidade do Acorly'}</h1>
          <p className="small muted" style={{ margin: 0 }}>Versão {VERSAO_TERMOS} · vigência a partir de {VIGENCIA_TERMOS}</p>
        </div>
        {secoes.map(([titulo, paragrafos]) => (
          <section key={titulo}>
            <h2 style={{ fontSize: 16, margin: '8px 0 6px' }}>{titulo}</h2>
            {paragrafos.map((p, i) => <p key={i} style={{ margin: '0 0 8px', lineHeight: 1.6 }}>{p}</p>)}
          </section>
        ))}
        <p className="small muted" style={{ margin: 0 }}>{ehTermos ? <>Veja também a <Link to="/privacidade">Política de Privacidade</Link>.</> : <>Veja também os <Link to="/termos">Termos de Uso</Link>.</>}</p>
      </div>
    </div>
  );
}
