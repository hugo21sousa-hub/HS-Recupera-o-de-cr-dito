// Roteiros de abordagem por segmento: quem procurar, o que dizer e como responder às objeções mais comuns.

const DECISOR = {
  ESCOLA_CURSO: { quem: 'Mantenedor(a) ou diretor(a) administrativo-financeiro', porta: 'Secretaria ou setor financeiro', dor: 'mensalidades em atraso', cliente: 'a família', cliente_pl: 'as famílias' },
  SAUDE: { quem: 'Sócio(a) da clínica (dentista ou médico dono) ou gestor(a) administrativo', porta: 'Recepção ou financeiro', dor: 'tratamentos parcelados em atraso', cliente: 'o paciente', cliente_pl: 'os pacientes' },
  ACADEMIA: { quem: 'Dono(a) ou gerente geral', porta: 'Recepção', dor: 'planos e mensalidades em atraso', cliente: 'o aluno', cliente_pl: 'os alunos' },
  CONDOMINIO: { quem: 'Gerente da carteira na administradora; depois o síndico', porta: 'Atendimento da administradora', dor: 'taxas condominiais em atraso', cliente: 'o condômino', cliente_pl: 'os condôminos' },
  IMOBILIARIA: { quem: 'Sócio(a) ou gerente de locação', porta: 'Atendimento de locação', dor: 'aluguéis e encargos em atraso', cliente: 'o inquilino', cliente_pl: 'os inquilinos' },
  VAREJO: { quem: 'Dono(a) da loja ou responsável pelo crediário', porta: 'Gerente da loja', dor: 'crediário e parcelas em atraso', cliente: 'o cliente', cliente_pl: 'os clientes' },
  DISTRIBUIDORA: { quem: 'Diretor(a) financeiro ou sócio(a)', porta: 'Financeiro / contas a receber', dor: 'títulos e boletos vencidos de clientes', cliente: 'o cliente', cliente_pl: 'os clientes' },
  SERVICOS: { quem: 'Sócio(a) ou responsável pelo financeiro', porta: 'Atendimento ou financeiro', dor: 'mensalidades de serviço em atraso', cliente: 'o cliente', cliente_pl: 'os clientes' },
  CONTABILIDADE: { quem: 'Sócio(a) do escritório', porta: 'Recepção do escritório', dor: 'clientes do escritório com inadimplência', cliente: 'o cliente', cliente_pl: 'os clientes' },
  OUTRO: { quem: 'Dono(a) ou responsável pelo financeiro', porta: 'Atendimento', dor: 'valores em atraso', cliente: 'o cliente', cliente_pl: 'os clientes' },
};

const OBJECOES = (d) => [
  ['"Já negativamos no Serasa."', 'Ótimo, o Serasa registra a dívida, mas não negocia. Nós entramos em contato, negociamos dentro dos limites que você definir e fechamos o acordo. Uma coisa complementa a outra.'],
  ['"Já temos advogado."', 'O advogado é o caminho certo para as dívidas grandes. As pequenas e numerosas normalmente não compensam o honorário nem o processo, e é exatamente aí que a gente atua.'],
  [`"Não quero incomodar ${d.cliente_pl}."`, `Por isso trabalhamos com cobrança respeitosa: mensagens cordiais, horário comercial, sem expor ${d.cliente} (Código de Defesa do Consumidor) e com proteção de dados (LGPD). Você define os limites de desconto e parcelamento.`],
  ['"Quanto custa?"', 'Na cobrança gerenciada, você só paga uma comissão sobre o que for efetivamente recuperado. Se nada for recuperado, não paga nada. Se preferir cobrar com a sua equipe, a plataforma custa a partir de R$ 49,90 por mês, com 7 dias grátis.'],
  ['"O dinheiro passa por vocês?"', `Não. ${d.cliente.charAt(0).toUpperCase() + d.cliente.slice(1)} paga direto na conta da sua empresa, por boleto ou Pix seu. A gente não intermedia valores.`],
  ['"Agora não é um bom momento."', 'Entendo. Posso só deixar o diagnóstico gratuito com você? Leva 5 minutos para mandar a planilha e você fica sabendo quanto está parado, sem compromisso.'],
  ['"Me manda por e-mail."', 'Mando sim. Para quem eu envio, e qual o melhor e-mail? (Anote o nome e o cargo de quem decide.)'],
];

/** Roteiro completo para o segmento (e a época do ano, para a frase de urgência). */
export function roteiro(segmento, { nomeRemetente = 'Hugo', decimoTerceiro = false } = {}) {
  const d = DECISOR[segmento] || DECISOR.OUTRO;
  const parceria = segmento === 'CONTABILIDADE';
  return {
    quem: d.quem,
    porta: d.porta,
    secretaria: `Bom dia! Aqui é ${nomeRemetente}, da HS Recuperação de Crédito. Quem cuida da parte financeira, das ${d.dor}? Qual é o nome dessa pessoa e o melhor contato para eu mandar uma proposta direto para ela?`,
    abertura: parceria
      ? `Olá, [nome]! Sou ${nomeRemetente}, da HS Recuperação de Crédito, aqui de Salvador. Muitos clientes do seu escritório têm valores em atraso. Nós recuperamos de forma organizada e respeitosa, com o pagamento direto na conta deles, e o escritório recebe uma comissão por cada cliente indicado que fechar conosco. Posso te explicar em 10 minutos?`
      : `Olá, [nome]! Sou ${nomeRemetente}, da HS Recuperação de Crédito, aqui de Salvador. Trabalhamos com ${d.dor}: recuperamos de forma respeitosa, o pagamento cai direto na conta da empresa e ${d.cliente} não é constrangido.${decimoTerceiro ? ' E este é o melhor momento do ano: com o 13º, muitos devedores querem quitar as contas antes do ano novo.' : ''} Faço um diagnóstico gratuito: você me manda a lista de atrasados e eu mostro quanto está parado e quanto dá para recuperar. Posso te mandar o link?`,
    perguntas: parceria
      ? ['Quantos clientes o escritório atende?', 'Que tipo de empresa mais reclama de inadimplência (escolas, clínicas, comércio)?', 'Como vocês preferem indicar: um link ou apresentando a gente por WhatsApp?']
      : ['Hoje, mais ou menos, quantas pessoas estão em atraso?', 'Quanto isso representa em valor?', 'Quem faz a cobrança hoje, e como?', 'Há quanto tempo a maior parte está em atraso?'],
    fechamento: parceria
      ? 'Vou te mandar o seu link de indicação e um texto pronto para você repassar aos clientes. Combinado?'
      : 'Te mando agora o link do diagnóstico (acorly.com.br/diagnostico). Assim que a planilha chegar, em até 2 dias úteis te retorno com os números. Combinado?',
    objecoes: OBJECOES(d),
  };
}
