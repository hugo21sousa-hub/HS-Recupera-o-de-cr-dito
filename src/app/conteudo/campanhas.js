// Campanhas com datas fixas para as redes sociais. Entram na Central de conteúdo como sugestões
// (nunca são publicadas sozinhas) e, nos dias da campanha, a agenda automática do banco fica em pausa.
// Linguagem respeitosa (CDC e LGPD): nunca expor devedores nem prometer resultado.
const H_LI = ['#Acorly', '#RecuperacaoDeCredito', '#Inadimplencia', '#GestaoFinanceira'];
const H_IG = ['#acorly', '#recuperacaodecredito', '#inadimplencia', '#empreendedorismo', '#gestaofinanceira'];
const calc = (rede, campanha) => `acorly.com.br/calculadora?utm_source=${rede}&utm_campaign=${campanha}`;
const LINK_BIO = 'Link da bio: acorly.com.br/calculadora?utm_source=instagram&utm_campaign=bio';

/** Campanha "Calculadora de inadimplência": 4 semanas, segunda, quarta e sexta. */
export const CAMPANHA_CALCULADORA = [
  {
    data: '2026-11-30', tema: 'Lançamento da calculadora de inadimplência',
    linkedin: {
      titulo: 'Quanto a inadimplência está custando para a sua empresa?',
      texto: 'A maioria das empresas sabe que tem clientes em atraso. Poucas sabem quanto isso soma.\n\nCriamos uma calculadora simples: você informa quantos clientes ativos tem, a mensalidade ou parcela média e quantos estão em atraso. Em 30 segundos ela mostra quanto dinheiro está parado e quanto deixa de entrar a cada mês.\n\nSem cadastro, sem nome de cliente, sem compromisso.\n\nO link está no primeiro comentário. Fez a conta? Me conta se o número te surpreendeu.',
      roteiro: `Imagem única com a pergunta. Publicar e colocar no 1º comentário: ${calc('linkedin', 'lancamento-calculadora')}. Compartilhar no perfil pessoal do fundador com uma frase própria.`,
      hashtags: [...H_LI, '#FluxoDeCaixa'],
      arte: { titulo: 'Quanto a inadimplência está custando para a sua empresa?', subtitulo: 'Descubra em 30 segundos. Link no comentário.' },
    },
    instagram: {
      formato: 'Carrossel (4 cards)',
      legenda: 'Você sabe quanto dinheiro está parado em clientes atrasados? 🤔 Fizemos uma calculadora que mostra em 30 segundos, sem cadastro. Link na bio! 👆',
      roteiro: `Card 1: "Quanto a inadimplência está custando para a sua empresa?". Card 2: "Informe 3 números: clientes, mensalidade e % em atraso". Card 3: print da calculadora com o resultado. Card 4: "Faça a sua conta: link na bio". STORIES: print da calculadora + figurinha de link; enquete "Você sabe quanto tem em atraso? Sei / Não faço ideia". ${LINK_BIO}`,
      hashtags: H_IG,
      arte: { slides: [
        { titulo: 'Quanto a inadimplência está custando para a sua empresa?', texto: 'Descubra em 30 segundos.' },
        { titulo: 'Só 3 números', texto: 'Clientes ativos, mensalidade média e % em atraso.' },
        { titulo: 'O resultado na hora', texto: 'Quanto está parado e quanto deixa de entrar por mês.' },
        { titulo: 'Faça a sua conta', texto: 'Link na bio · acorly.com.br/calculadora' },
      ] },
    },
  },
  {
    data: '2026-12-02', tema: 'A conta de uma escola',
    linkedin: {
      titulo: 'R$ 114 mil parados em mensalidades',
      texto: 'Um exemplo simples, com números comuns:\n\n• 300 alunos\n• mensalidade de R$ 850\n• 10% em atraso, em média há 3 a 6 meses\n\nSão 30 famílias e cerca de R$ 114 mil parados. Todo mês, R$ 25.500 deixam de entrar.\n\nNão é um caso real, é só a conta. Mas costuma assustar quem nunca a fez.\n\nTroque pelos números da sua empresa na calculadora (link no comentário).',
      roteiro: `Imagem com a conta em destaque. 1º comentário: ${calc('linkedin', 'conta-escola')}.`,
      hashtags: [...H_LI, '#GestaoEscolar'],
      arte: { titulo: '300 alunos · 10% em atraso', subtitulo: '≈ R$ 114 mil parados em mensalidades' },
    },
    instagram: {
      formato: 'Carrossel (5 cards)',
      legenda: 'Uma escola com 300 alunos e 10% de atraso pode ter mais de R$ 100 mil parados. 😮 Faz a conta da sua empresa: link na bio.',
      roteiro: `Card 1: "Quanto uma escola de 300 alunos tem parado?". Card 2: "Mensalidade R$ 850 · 10% em atraso". Card 3: "30 famílias · 3 a 6 meses de atraso". Card 4: "≈ R$ 114.750 parados · R$ 25.500 a menos por mês". Card 5: "E a sua empresa? Calcule: link na bio". Legenda deixa claro que é um exemplo. STORIES: caixinha de pergunta "Qual o maior desafio para cobrar seus clientes?". ${LINK_BIO}`,
      hashtags: [...H_IG, '#gestaoescolar'],
      arte: { slides: [
        { titulo: 'Quanto uma escola de 300 alunos tem parado?', texto: 'Um exemplo com números comuns.' },
        { titulo: 'Mensalidade de R$ 850', texto: '10% dos alunos em atraso.' },
        { titulo: '30 famílias', texto: 'Em média 3 a 6 meses de atraso.' },
        { titulo: '≈ R$ 114.750 parados', texto: 'E R$ 25.500 a menos todo mês.' },
        { titulo: 'E a sua empresa?', texto: 'Calcule em 30 segundos: link na bio.' },
      ] },
    },
  },
  {
    data: '2026-12-04', tema: 'Quem está por trás da Acorly',
    linkedin: {
      titulo: 'Por que criei a Acorly',
      texto: 'Antes de falar de produto, quero contar por que a Acorly existe.\n\n[Escreva aqui, com as suas palavras, o momento em que você viu uma empresa perder dinheiro e clientes por não saber cobrar. Duas ou três frases, em primeira pessoa.]\n\nA Acorly nasceu para resolver isso de um jeito respeitoso: organização, mensagens cordiais com o nome da empresa e o dinheiro indo direto para a conta dela.\n\nSomos de Salvador e atendemos empresas de todo o Brasil, 100% online. Se quiser conversar, meu direct está aberto.',
      roteiro: `Post no PERFIL PESSOAL do fundador, com foto sua (não da marca). Personalize o parágrafo entre colchetes antes de publicar. A página da Acorly compartilha o post. 1º comentário: ${calc('linkedin', 'fundador')}.`,
      hashtags: [...H_LI, '#Empreendedorismo'],
      arte: { titulo: 'Por que criei a Acorly', subtitulo: 'Use uma foto sua, de rosto.' },
    },
    instagram: {
      formato: 'Reels (30–45 s, você falando para a câmera)',
      legenda: 'Prazer, eu sou o Hugo, fundador da Acorly. 👋 Conto aqui por que criei uma forma de cobrar sem constranger o cliente. Dúvidas? Me chama no direct!',
      roteiro: `Grave com o celular na vertical, luz de frente. (1) "Oi, eu sou o Hugo, fundador da Acorly." (2) Um motivo pessoal, em uma frase. (3) "A gente ajuda empresas a recuperar o que é delas, com respeito, e o dinheiro cai direto na conta da empresa." (4) "Se quiser saber quanto a sua empresa tem parado, o link da calculadora está na bio." Legenda automática ligada. Fixar este Reels no topo do perfil e criar o destaque "Quem somos". ${LINK_BIO}`,
      hashtags: H_IG,
      arte: { slides: [{ titulo: 'Prazer, Hugo', texto: 'Fundador da Acorly' }] },
    },
  },
  {
    data: '2026-12-07', tema: 'Dezembro e o 13º salário',
    linkedin: {
      titulo: 'Dezembro é o melhor mês para regularizar atrasados',
      texto: 'Com o 13º salário, muita gente quer começar o ano sem dívidas.\n\nPara quem tem valores a receber, dezembro é uma janela: o cliente tem mais dinheiro e mais vontade de resolver pendências.\n\nTrês cuidados para aproveitar:\n1. Comece pelos atrasos mais recentes, que respondem mais rápido.\n2. Ofereça uma condição clara, com data para valer.\n3. Facilite o pagamento: Pix com o valor pronto ajuda muito.\n\nVocê já fez a sua campanha de fim de ano?',
      roteiro: `Texto com imagem. 1º comentário: ${calc('linkedin', '13-salario')}.`,
      hashtags: [...H_LI, '#13Salario'],
      arte: { titulo: 'Dezembro + 13º', subtitulo: 'A melhor janela do ano para regularizar atrasados.' },
    },
    instagram: {
      formato: 'Imagem única + stories com enquete',
      legenda: 'O 13º chegou e muita gente quer começar 2027 sem dívidas. 💸 É a hora certa de conversar com quem está em atraso, com uma condição clara e o Pix pronto. Salva para não esquecer!',
      roteiro: `Imagem: "Dezembro é o mês de regularizar atrasados". STORIES: enquete "Você faz campanha de cobrança no fim do ano? Sim / Ainda não"; quem responder "Ainda não" recebe no direct: "Quer que eu faça a conta de quanto sua empresa tem parado? Leva 2 minutos". ${LINK_BIO}`,
      hashtags: [...H_IG, '#13salario'],
      arte: { titulo: 'Dezembro é o mês de regularizar atrasados', subtitulo: 'Aproveite o 13º com uma condição clara.' },
    },
  },
  {
    data: '2026-12-09', tema: 'Cobrar sem constranger',
    linkedin: {
      titulo: 'Cobrança respeitosa recupera mais',
      texto: 'Muita empresa evita cobrar com medo de perder o cliente. Faz sentido: cobrança agressiva afasta.\n\nMas existe outro caminho:\n• mensagem com o nome da sua empresa, em tom cordial;\n• horário comercial e limite de contatos por dia;\n• sem expor ninguém e sem falar com terceiros (CDC, art. 42);\n• quem pede para não ser contatado tem o pedido respeitado.\n\nPublicamos as mensagens exatas que usamos. Estão no link do comentário.',
      roteiro: 'Imagem com um print de mensagem de exemplo (WhatsApp). 1º comentário: acorly.com.br/mensagens?utm_source=linkedin&utm_campaign=mensagens',
      hashtags: [...H_LI, '#CDC'],
      arte: { titulo: 'Cobrar sem constranger', subtitulo: 'Cordial, no nome da sua empresa, dentro do CDC.' },
    },
    instagram: {
      formato: 'Carrossel (4 cards)',
      legenda: 'Dá para cobrar sem perder o cliente? Dá sim! 💬 Olha como são as nossas mensagens: cordiais, com o nome da sua empresa e sem ameaça. Veja todas no site (link na bio → Mensagens).',
      roteiro: `Card 1: "Dá para cobrar sem perder o cliente?". Card 2: print da mensagem "Primeiro contato". Card 3: "Regras: horário comercial, limite diário, sem expor ninguém". Card 4: "Você vê as mensagens antes". Criar o destaque "Mensagens" com os prints. ${LINK_BIO}`,
      hashtags: H_IG,
      arte: { slides: [
        { titulo: 'Dá para cobrar sem perder o cliente?', texto: 'Dá, com respeito.' },
        { titulo: 'Olá, Maria! Tudo bem?', texto: 'Mensagem cordial, com o nome da sua empresa.' },
        { titulo: 'Regras claras', texto: 'Horário comercial, limite diário, sem expor ninguém.' },
        { titulo: 'Você vê antes', texto: 'acorly.com.br/mensagens' },
      ] },
    },
  },
  {
    data: '2026-12-11', tema: 'Comece pelos ex-clientes',
    linkedin: {
      titulo: 'Não quer arriscar quem ainda é cliente? Comece pelos que já saíram',
      texto: 'A objeção que mais ouvimos: "não quero que ninguém incomode os meus clientes".\n\nUma saída simples: comece pelos que já saíram, ou pelas dívidas com mais de 90 dias que você talvez já tenha dado como perdidas.\n\nAssim você testa a cobrança sem tocar em quem ainda frequenta ou compra da sua empresa, e decide com base no resultado.\n\nÉ exatamente assim que o nosso Piloto Sem Risco começa.',
      roteiro: `Texto com imagem. 1º comentário: ${calc('linkedin', 'ex-clientes')}.`,
      hashtags: H_LI,
      arte: { titulo: 'Comece pelos que já saíram', subtitulo: 'Teste sem tocar em quem ainda é seu cliente.' },
    },
    instagram: {
      formato: 'Reels (20–30 s)',
      legenda: 'Medo de perder cliente ao cobrar? Comece pelos ex-clientes! 🔄 Você testa sem tocar em quem ainda está com você.',
      roteiro: `Texto na tela, uma frase por cena: "Medo de perder cliente ao cobrar?" → "Então não comece por eles" → "Comece por quem já saiu" → "Ou por dívidas que você já deu como perdidas" → "Teste sem risco: link na bio". ${LINK_BIO}`,
      hashtags: H_IG,
      arte: { slides: [{ titulo: 'Comece pelos ex-clientes', texto: 'Teste sem tocar em quem ainda é seu cliente.' }] },
    },
  },
  {
    data: '2026-12-14', tema: 'O dinheiro vai direto para a sua conta',
    linkedin: {
      titulo: 'Na Acorly, o dinheiro nunca passa pela gente',
      texto: 'Uma pergunta justa de quem pensa em terceirizar a cobrança: "e o dinheiro, passa por vocês?".\n\nNão. O devedor paga direto para a empresa credora.\n\nCom a chave Pix da empresa cadastrada, o sistema gera o Pix de cada parcela do acordo, com QR Code e uma página de pagamento que o devedor pode até imprimir. O valor cai na hora na conta da empresa.\n\nVocê confere no extrato e confirma. Simples assim.',
      roteiro: `Imagem da página de pagamento (dados fictícios). 1º comentário: ${calc('linkedin', 'pix-direto')}.`,
      hashtags: [...H_LI, '#Pix'],
      arte: { titulo: 'O dinheiro vai direto para a sua conta', subtitulo: 'Pix gerado com a chave da sua empresa.' },
    },
    instagram: {
      formato: 'Carrossel (3 cards)',
      legenda: 'O dinheiro passa pela Acorly? Não! 🙅 O devedor paga direto para a sua empresa, por Pix, com QR Code pronto. Você confere no extrato e pronto.',
      roteiro: `Card 1: "O dinheiro passa pela Acorly?". Card 2: "Não. Pix com a chave da SUA empresa". Card 3: print da página de pagamento (dados fictícios). Criar o destaque "Como funciona". ${LINK_BIO}`,
      hashtags: [...H_IG, '#pix'],
      arte: { slides: [
        { titulo: 'O dinheiro passa pela Acorly?', texto: 'Não.' },
        { titulo: 'Pix com a chave da SUA empresa', texto: 'O valor cai na hora na sua conta.' },
        { titulo: 'QR Code pronto', texto: 'E uma página que o devedor pode imprimir.' },
      ] },
    },
  },
  {
    data: '2026-12-16', tema: 'Rematrícula e mensalidades em atraso',
    linkedin: {
      titulo: 'Escolas: a rematrícula é a hora de cuidar dos atrasados',
      texto: 'Para escolas, dezembro é rematrícula. E é também quando a inadimplência pesa mais: família em atraso que não rematricula leva junto o valor devido.\n\nAlgumas práticas que ajudam:\n• conversar antes da rematrícula, não depois;\n• oferecer uma condição de regularização com prazo;\n• separar quem saiu de quem fica, com abordagens diferentes.\n\nGestores escolares: como vocês lidam com isso hoje?',
      roteiro: `Texto com imagem. 1º comentário: ${calc('linkedin', 'rematricula')}.`,
      hashtags: [...H_LI, '#GestaoEscolar', '#EducacaoPrivada'],
      arte: { titulo: 'Rematrícula é a hora de cuidar dos atrasados', subtitulo: 'Converse antes, com uma condição clara.' },
    },
    instagram: {
      formato: 'Imagem única',
      legenda: 'Escola, a rematrícula chegou! 📚 Conversar com as famílias em atraso ANTES da rematrícula faz toda a diferença. Quer saber quanto sua escola tem parado? Link na bio.',
      roteiro: `Imagem com a frase principal. STORIES: caixinha "Gestor escolar: qual a sua maior dificuldade com mensalidades atrasadas?". ${LINK_BIO}`,
      hashtags: [...H_IG, '#gestaoescolar', '#rematricula'],
      arte: { titulo: 'Rematrícula chegou', subtitulo: 'Converse com as famílias em atraso antes, não depois.' },
    },
  },
  {
    data: '2026-12-18', tema: 'Piloto Sem Risco',
    linkedin: {
      titulo: '30 dias para testar, pagando só se o dinheiro entrar',
      texto: 'Para quem quer testar antes de decidir, criamos o Piloto Sem Risco:\n\n• 30 dias, com até 20 devedores escolhidos por você;\n• comece pelos que já saíram ou pelas dívidas antigas;\n• você vê e aprova as mensagens e define os limites;\n• o devedor paga direto na conta da sua empresa;\n• comissão de 10% só sobre o que entrar no período. Se nada entrar, não paga nada.\n\nSem mensalidade e sem fidelidade. O primeiro passo é o diagnóstico grátis (link no comentário).',
      roteiro: 'Imagem com os 5 pontos. 1º comentário: acorly.com.br/diagnostico?utm_source=linkedin&utm_campaign=piloto',
      hashtags: H_LI,
      arte: { titulo: 'Piloto Sem Risco', subtitulo: '30 dias · até 20 devedores · 10% só do que entrar' },
    },
    instagram: {
      formato: 'Carrossel (5 cards)',
      legenda: 'Testa por 30 dias e só paga se o dinheiro entrar. 🛡️ É o nosso Piloto Sem Risco. Começa com um diagnóstico grátis e anônimo: link na bio.',
      roteiro: `Card 1: "Teste por 30 dias, sem risco". Card 2: "Até 20 devedores escolhidos por você". Card 3: "Você aprova as mensagens". Card 4: "10% só do que entrar · nada entrou, nada paga". Card 5: "Comece pelo diagnóstico grátis". Criar o destaque "Piloto". ${LINK_BIO}`,
      hashtags: H_IG,
      arte: { slides: [
        { titulo: 'Teste por 30 dias, sem risco', texto: 'Piloto Sem Risco da Acorly' },
        { titulo: 'Até 20 devedores', texto: 'Escolhidos por você. Comece pelos ex-clientes.' },
        { titulo: 'Você aprova as mensagens', texto: 'E define os limites de desconto e parcelas.' },
        { titulo: '10% só do que entrar', texto: 'Se nada entrar, você não paga nada.' },
        { titulo: 'Comece pelo diagnóstico grátis', texto: 'Link na bio.' },
      ] },
    },
  },
  {
    data: '2026-12-21', tema: 'Checklist de fim de ano',
    linkedin: {
      titulo: '5 passos para fechar o ano com menos inadimplência',
      texto: 'Um checklist rápido para esta semana:\n\n1. Liste quem está em atraso e há quanto tempo.\n2. Some o valor: saber o tamanho do problema muda as prioridades.\n3. Separe quem ainda é cliente de quem já saiu.\n4. Defina até onde pode ir em desconto e parcelas.\n5. Mande a primeira mensagem antes do Natal, com o Pix pronto.\n\nPara o passo 2, a calculadora ajuda (link no comentário).',
      roteiro: `Imagem com o checklist (salvável). 1º comentário: ${calc('linkedin', 'checklist')}.`,
      hashtags: H_LI,
      arte: { titulo: '5 passos para fechar o ano com menos inadimplência', subtitulo: 'Salve e faça esta semana.' },
    },
    instagram: {
      formato: 'Carrossel (6 cards) para salvar',
      legenda: 'Checklist de fim de ano para quem tem clientes em atraso ✅ Salva e faz esta semana! O passo 2 dá para fazer na nossa calculadora (link na bio).',
      roteiro: `Card 1: capa "Checklist de fim de ano". Cards 2 a 6: um passo por card. Pedir para salvar e compartilhar. ${LINK_BIO}`,
      hashtags: H_IG,
      arte: { slides: [
        { titulo: 'Checklist de fim de ano', texto: 'Para quem tem clientes em atraso.' },
        { titulo: '1. Liste os atrasados', texto: 'Quem e há quanto tempo.' },
        { titulo: '2. Some o valor', texto: 'Use a calculadora: link na bio.' },
        { titulo: '3. Separe', texto: 'Quem ainda é cliente e quem já saiu.' },
        { titulo: '4. Defina seus limites', texto: 'Desconto e parcelas que você aceita.' },
        { titulo: '5. Comece antes do Natal', texto: 'Mensagem cordial e Pix pronto.' },
      ] },
    },
  },
  {
    data: '2026-12-23', tema: 'Diagnóstico grátis e anônimo',
    linkedin: {
      titulo: 'Um diagnóstico da sua carteira sem nenhum dado pessoal',
      texto: 'Quer saber quanto da sua inadimplência dá para recuperar, mas não quer enviar dados dos seus clientes?\n\nO nosso diagnóstico usa só o valor e a data de vencimento de cada atraso. Se a planilha tiver nome, CPF ou telefone, essas colunas são removidas no seu próprio computador, antes do envio.\n\nEm até 2 dias úteis você recebe a análise. Grátis e sem compromisso (link no comentário).',
      roteiro: 'Imagem simples. 1º comentário: acorly.com.br/diagnostico?utm_source=linkedin&utm_campaign=diagnostico',
      hashtags: [...H_LI, '#LGPD'],
      arte: { titulo: 'Diagnóstico grátis e anônimo', subtitulo: 'Só valor e vencimento. Nada de nome ou CPF.' },
    },
    instagram: {
      formato: 'Imagem única + stories',
      legenda: 'Diagnóstico da sua inadimplência sem mandar nenhum dado pessoal dos seus clientes. 🔒 Só valor e vencimento. Grátis, em até 2 dias úteis. Link na bio!',
      roteiro: `Imagem com o cadeado e a frase principal. STORIES: "Como funciona o diagnóstico" em 3 telas (envia a planilha → removemos nomes e CPF no seu computador → recebe a análise em 2 dias úteis). ${LINK_BIO}`,
      hashtags: [...H_IG, '#lgpd'],
      arte: { titulo: 'Diagnóstico grátis e anônimo', subtitulo: 'Só valor e vencimento. Em até 2 dias úteis.' },
    },
  },
  {
    data: '2026-12-28', tema: 'Planejamento de 2027',
    linkedin: {
      titulo: 'Comece 2027 com uma rotina de cobrança',
      texto: 'Janeiro costuma ser um mês de aperto: férias, impostos, material escolar. É quando os atrasos aumentam.\n\nQuem entra no ano com uma rotina pronta sofre menos:\n• lembrete antes do vencimento;\n• contato cordial logo no primeiro atraso;\n• proposta de acordo cedo, com Pix pronto;\n• acompanhamento das parcelas do acordo.\n\nQuer montar a sua? O primeiro passo é saber quanto está parado hoje (link no comentário).',
      roteiro: `Texto com imagem. 1º comentário: ${calc('linkedin', 'planejamento-2027')}.`,
      hashtags: [...H_LI, '#Planejamento2027'],
      arte: { titulo: 'Comece 2027 com uma rotina de cobrança', subtitulo: 'Antes que janeiro aperte.' },
    },
    instagram: {
      formato: 'Reels (20–30 s)',
      legenda: 'Janeiro é mês de aperto e de mais atrasos. 📅 Entre em 2027 com uma rotina de cobrança pronta! Primeiro passo: saber quanto está parado (link na bio).',
      roteiro: `Texto na tela: "Janeiro: férias, impostos, material escolar" → "É quando os atrasos aumentam" → "Rotina: lembrete, contato cedo, acordo com Pix" → "Comece sabendo quanto está parado: link na bio". STORIES: retrospectiva da campanha com os destaques criados. ${LINK_BIO}`,
      hashtags: [...H_IG, '#planejamento2027'],
      arte: { slides: [{ titulo: 'Comece 2027 com uma rotina de cobrança', texto: 'Antes que janeiro aperte.' }] },
    },
  },
];

export const CAMPANHAS = [{ id: 'calculadora-2026', itens: CAMPANHA_CALCULADORA }];
