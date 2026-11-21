// Prospecção por e-mail (superadmin/gestor): modelos de apresentação dos serviços, prévia e envio
// pelo contato@acorly.com.br, com registro no lead e opção de descadastro (LGPD).
import { renderizarEmailComercial, preencher } from '../../core/emailComercial.js';
import { emailValido, somenteDigitos } from '../../core/documento.js';
import { AccessError, ValidationError, getById, find, criar, alterar, exigir, notificar } from '../context.js';
import { marcarAbordado } from './prospects.js';
import { iniciarCadencia, avancarCadencia, followupVencido } from './acompanhamento.js';

export const LIMITE_DIARIO_COMERCIAL = 50;
const SEGMENTO_TEXTO = { ESCOLA_CURSO: 'escolas e cursos', SAUDE: 'clínicas e consultórios', ACADEMIA: 'academias', CONDOMINIO: 'condomínios', VAREJO: 'lojas e varejo', DISTRIBUIDORA: 'distribuidoras', SERVICOS: 'prestadores de serviço', IMOBILIARIA: 'imobiliárias', OUTRO: 'empresas' };

const ASSINATURA = '\nAbraço,\n**{{remetente}}**\nHS Recuperação de Crédito · Acorly\ncontato@acorly.com.br{{whatsapp_linha}}';
const CHAMADAS = '[[botao:Quero meu diagnóstico gratuito|https://acorly.com.br/diagnostico]]\n[[link:Ver o Acorly em 1 minuto e meio|https://acorly.com.br/#video]]';

export const MODELOS_COMERCIAIS = [
  {
    nome: 'Apresentação dos serviços', ordem: 1,
    assunto: '{{empresa}}: recuperar a inadimplência sem desgastar seus clientes',
    corpo: `Olá, {{nome}}, tudo bem?

Sou {{remetente}}, da HS Recuperação de Crédito. Ajudamos {{segmento}} como a {{empresa}} a recuperar valores em atraso de forma organizada e respeitosa, e o dinheiro vai direto para a conta da empresa.

## Duas formas de trabalhar com a gente
- **Acorly Plataforma:** a sua equipe cobra com o sistema: devedores, mensagens prontas de WhatsApp e e-mail, acordos, boletos e Pix em um só lugar. A partir de R$ 49,90 por mês, com 7 dias grátis.
- **Cobrança gerenciada:** a nossa equipe cobra por você, dentro dos limites de desconto e parcelamento que você definir. Comissão só sobre o que for recuperado.

## Por que as empresas escolhem o Acorly
- O devedor paga direto para a sua empresa: não intermediamos valores.
- Cobrança dentro das regras do CDC e da LGPD, sem constrangimento.
- Prestação de contas todo mês, com o que foi recuperado e o que ainda vai entrar.

## Diagnóstico gratuito da sua carteira
Envie a planilha dos clientes em atraso e, em até 2 dias úteis, mostramos quanto dá para recuperar, em quanto tempo e quanto custaria. Sem compromisso.
${CHAMADAS}

Posso te ligar por 15 minutos esta semana para mostrar como funcionaria na {{empresa}}?
${ASSINATURA}`,
  },
  {
    nome: 'Escolas e cursos', ordem: 2,
    assunto: 'Mensalidades em atraso na {{empresa}}? Uma forma respeitosa de recuperar',
    corpo: `Olá, {{nome}}, tudo bem?

Sei que, para escolas e cursos, cobrar mensalidades atrasadas é delicado: ninguém quer desgastar a relação com as famílias.

Na HS Recuperação de Crédito, criamos o **Acorly** justamente para isso:
- lembrete amigável antes do vencimento e contato logo no primeiro atraso;
- propostas de acordo que cabem no orçamento das famílias;
- tudo registrado, para a secretaria e o financeiro falarem a mesma língua;
- o pagamento vai direto para a conta da escola.

Você pode usar a plataforma com a sua equipe (a partir de R$ 49,90 por mês, 7 dias grátis) ou deixar a cobrança com a nossa equipe, pagando comissão só sobre o que for recuperado.

## Que tal começar por um diagnóstico gratuito?
Em até 2 dias úteis mostramos quanto das mensalidades em atraso dá para recuperar.
${CHAMADAS}
${ASSINATURA}`,
  },
  {
    nome: 'Clínicas e consultórios', ordem: 3,
    assunto: '{{empresa}}: cobrança de pacientes com discrição e respeito',
    corpo: `Olá, {{nome}}, tudo bem?

Na área da saúde, cobrar costuma ser desconfortável. Mas a inadimplência pesa no caixa, na equipe e nos fornecedores.

Com o **Acorly**, da HS Recuperação de Crédito, a sua clínica cobra com processo e discrição:
- mensagens prontas e respeitosas, dentro do CDC;
- acordos com entrada e parcelas possíveis;
- boletos ou Pix enviados ao paciente, com o pagamento direto na conta da clínica;
- e, se preferir manter distância da cobrança, a nossa equipe faz por você, com os seus limites.

## Diagnóstico gratuito
Envie a planilha dos pacientes em atraso e mostramos, em até 2 dias úteis, quanto dá para recuperar.
${CHAMADAS}
${ASSINATURA}`,
  },
  {
    nome: 'Contadores (parceria)', ordem: 4,
    assunto: 'Parceria: inadimplência dos seus clientes vira receita recuperada',
    corpo: `Olá, {{nome}}, tudo bem?

Escritórios de contabilidade ouvem todo mês a mesma queixa dos clientes: "tenho muito a receber e não consigo cobrar".

Sou {{remetente}}, da HS Recuperação de Crédito, e gostaria de propor uma parceria com a {{empresa}}:
- você indica clientes com inadimplência;
- nós fazemos um diagnóstico gratuito da carteira de cada um;
- o cliente escolhe entre usar a nossa plataforma ou deixar a cobrança com a nossa equipe;
- a {{empresa}} recebe uma comissão por cada cliente indicado que fechar conosco.

Para o seu cliente, é dinheiro que volta para o caixa. Para você, um serviço a mais e uma receita extra.
[[link:Conheça o Acorly em 1 minuto e meio|https://acorly.com.br/#video]]

Podemos conversar 15 minutos esta semana?
${ASSINATURA}`,
  },
  {
    nome: 'Piloto Sem Risco', ordem: 1, novo: true,
    assunto: '{{empresa}}: teste a recuperação de atrasados por 30 dias, pagando só se entrar',
    corpo: `Olá, {{nome}}, tudo bem?

Sou {{remetente}}, da HS Recuperação de Crédito, de Salvador. Ajudamos {{segmento}} como a {{empresa}} a recuperar valores em atraso **sem perder o cliente**.

Para você conhecer sem risco, temos o **Piloto Sem Risco**:
- **Diagnóstico grátis e anônimo:** você envia só o valor e o vencimento de cada atraso, sem nome nem CPF, e em até 2 dias úteis mostramos quanto dá para recuperar.
- **30 dias com até 20 devedores escolhidos por você:** comece pelos clientes que já saíram ou pelas dívidas com mais de 90 dias, assim quem ainda é seu cliente não recebe nenhum contato. Você vê e aprova as mensagens antes, e elas saem com o nome da {{empresa}}.
- **Uma equipe dedicada à sua carteira:** nossa equipe é preparada para negociar com cordialidade, dentro do Código de Defesa do Consumidor e da LGPD. Cada devedor tem um operador responsável e você acompanha tudo pelo painel.
- **O devedor paga direto na conta da sua empresa** e você paga **10% só do que entrar nos 30 dias**. Se nada entrar, não paga nada.
- Se algum cliente seu reclamar, paramos o contato com ele na hora.

[[botao:Quero o diagnóstico gratuito|https://acorly.com.br/diagnostico]]
[[link:Ver as mensagens que o devedor recebe|https://acorly.com.br/mensagens]]

Abrimos poucas vagas de piloto por mês para atender cada empresa com cuidado.
${ASSINATURA}`,
  },
  {
    nome: '13º salário (novembro e dezembro)', ordem: 2, novo: true,
    assunto: '{{empresa}}: dezembro é o melhor mês para recuperar valores em atraso',
    corpo: `Olá, {{nome}}, tudo bem?

Sou {{remetente}}, da HS Recuperação de Crédito. Uma informação que pode valer dinheiro para a {{empresa}} agora:

**dezembro é o mês em que mais se recupera dívida.** Com o 13º salário, muitos devedores querem quitar as contas para começar o ano limpo. Quem deixa para cobrar em janeiro perde essa janela, porque aí chegam IPVA, IPTU e material escolar.

## Como podemos ajudar ainda este mês
- **Diagnóstico gratuito em até 2 dias úteis:** você manda a lista de atrasados e mostramos quanto dá para recuperar.
- **Cobrança respeitosa:** mensagens cordiais, sem constranger o seu cliente, dentro do Código de Defesa do Consumidor e da LGPD.
- **O dinheiro cai direto na conta da {{empresa}}:** não intermediamos valores.
- **Na cobrança gerenciada, você só paga sobre o que for recuperado.**

[[botao:Quero o diagnóstico gratuito|https://acorly.com.br/diagnostico]]

Se preferir, responda este e-mail com o melhor horário e eu te ligo.
${ASSINATURA}`,
  },
  {
    nome: 'Retorno (3 dias depois)', ordem: 5,
    assunto: 'Re: {{empresa}} e a recuperação da inadimplência',
    corpo: `Olá, {{nome}}!

Passando para saber se você conseguiu ver a minha mensagem sobre o Acorly.

Sei que a rotina é corrida, então resumo em uma linha: **mande a planilha dos clientes em atraso e, em até 2 dias úteis, dizemos quanto dá para recuperar, sem compromisso.**
[[botao:Pedir o diagnóstico gratuito|https://acorly.com.br/diagnostico]]

Se não for o momento, é só me avisar que não volto a escrever.
${ASSINATURA}`,
  },
];
// Textos anteriores do modelo "Piloto Sem Risco": quem não editou recebe a versão nova (ex-clientes primeiro e a equipe)
{
  const piloto = MODELOS_COMERCIAIS.find((m) => m.nome === 'Piloto Sem Risco');
  const inicio = piloto.corpo.indexOf('- **30 dias com até 20 devedores');
  const fim = piloto.corpo.indexOf('- **O devedor paga direto');
  piloto.anteriores = [piloto.corpo.slice(0, inicio) + '- **30 dias com até 20 devedores escolhidos por você:** você vê e aprova as mensagens antes, e elas saem com o nome da {{empresa}}.\n' + piloto.corpo.slice(fim)];
}

export async function garantirModelos(ctx) {
  const atuais = await find(ctx, 'ModeloComercial', {});
  // modelos novos do sistema entram também para quem já tinha os anteriores (sem mexer nos editados)
  // modelo do sistema que ninguém editou recebe o texto atualizado
  for (const a of atuais) {
    const sis = MODELOS_COMERCIAIS.find((m) => m.nome === a.nome && m.anteriores?.includes(a.corpo));
    if (sis) { await ctx.db.ModeloComercial.update(a.id, { corpo: sis.corpo }); a.corpo = sis.corpo; }
  }
  const faltam = atuais.length ? MODELOS_COMERCIAIS.filter((m) => m.novo && !atuais.some((a) => a.nome === m.nome)) : MODELOS_COMERCIAIS;
  if (!faltam.length) return atuais;
  for (const { novo, anteriores, ...m } of faltam) await ctx.db.ModeloComercial.create({ ...m, ativo: true }); // eslint-disable-line no-unused-vars
  return find(ctx, 'ModeloComercial', {});
}

function variaveis(ctx, d) {
  const w = somenteDigitos(ctx.contato?.whatsapp || '');
  const fone = w ? `+${w.length <= 11 ? '55' : ''}${w}` : '';
  return {
    nome: String(d.nome || '').trim().split(' ')[0], empresa: String(d.empresa || '').trim() || 'sua empresa',
    segmento: SEGMENTO_TEXTO[d.segmento] || 'empresas', remetente: ctx.user.nome || 'Equipe Acorly', whatsapp: fone, whatsapp_linha: fone ? `\nWhatsApp: ${fone}` : '',
  };
}

export async function montar(ctx, input, sair = null) {
  let assunto = input.assunto, corpo = input.corpo;
  if (input.modelo_id) {
    const m = await getById(ctx, 'ModeloComercial', input.modelo_id);
    if (!m) throw new AccessError('Modelo não encontrado', 404);
    assunto ??= m.assunto; corpo ??= m.corpo;
  }
  exigir(String(assunto || '').trim() && String(corpo || '').trim(), 'Escolha um modelo ou escreva o assunto e a mensagem');
  const vars = variaveis(ctx, input);
  const assuntoFinal = preencher(assunto, vars).slice(0, 180);
  const r = renderizarEmailComercial({ corpo: preencher(corpo, vars), urlBase: ctx.urlBase || '', rodape: 'HS Recuperação de Crédito · CNPJ 37.573.934/0001-22 · Salvador/BA · acorly.com.br', sair });
  return { assunto: assuntoFinal, ...r };
}

/** Envia a apresentação para um contato (cria ou atualiza o lead e registra o envio). */
export async function enviarComercial(ctx, input) {
  if (!ctx.email?.comercial) throw new ValidationError('O envio de e-mails não está configurado.');
  const para = String(input.para || '').trim().toLowerCase();
  exigir(emailValido(para), 'Informe um e-mail válido');
  const hoje = ctx.now().toISOString().slice(0, 10);
  const envios = await find(ctx, 'EnvioComercial', {});
  exigir(envios.filter((e) => (e.enviado_em || '').slice(0, 10) === hoje).length < LIMITE_DIARIO_COMERCIAL, `Limite de ${LIMITE_DIARIO_COMERCIAL} e-mails comerciais por dia atingido (protege a reputação do domínio). Continue amanhã.`);
  let lead = input.lead_id ? await getById(ctx, 'Lead', input.lead_id) : (await find(ctx, 'Lead', { email: para }))[0];
  if ((await find(ctx, 'Lead', { email: para })).some((l) => l.nao_receber_comercial)) throw new ValidationError('Este contato pediu para não receber e-mails comerciais.');
  const agora = ctx.now().toISOString();
  if (!lead) {
    exigir(String(input.empresa || '').trim(), 'Informe a empresa do contato');
    lead = await criar(ctx, 'Lead', {
      nome: String(input.nome || '').slice(0, 120) || para, empresa: String(input.empresa).slice(0, 160), email: para, whatsapp: somenteDigitos(input.whatsapp).slice(0, 13),
      segmento: SEGMENTO_TEXTO[input.segmento] ? input.segmento : 'OUTRO', cidade: String(input.cidade || '').slice(0, 80), status: 'EM_CONTATO', origem: 'PROSPECCAO',
      recebido_em: agora, observacoes: '', responsavel_id: ctx.user.id,
    }, 'CRIAR_LEAD_PROSPECCAO');
  }
  const dados = { nome: input.nome || lead.nome, empresa: input.empresa || lead.empresa, segmento: input.segmento || lead.segmento, modelo_id: input.modelo_id, assunto: input.assunto, corpo: input.corpo };
  const sair = ctx.descadastro?.linkComercial ? ctx.descadastro.linkComercial(lead.id) : null;
  const m = await montar(ctx, dados, sair);
  const r = await ctx.email.comercial({ para, assunto: m.assunto, html: m.html, texto: m.texto, sair });
  if (!r.ok) throw new ValidationError(`Não foi possível enviar agora${r.erro ? ` (${r.erro})` : ''}. Tente novamente.`);
  await ctx.db.EnvioComercial.create({ lead_id: lead.id, campanha_id: input.campanha_id || null, email: para, assunto: m.assunto, modelo_id: input.modelo_id || null, enviado_em: agora, enviado_por: ctx.user.id, mensagem_id: r.id || null });
  const jaTinhaEmail = !!lead.ultimo_email_em;
  lead = await alterar(ctx, 'Lead', lead, { ultimo_email_em: agora, status: lead.status === 'NOVO' ? 'EM_CONTATO' : lead.status }, 'ENVIAR_EMAIL_COMERCIAL');
  if (followupVencido(ctx, lead)) await avancarCadencia(ctx, lead, { canal: 'EMAIL', observacao: m.assunto });
  else if (!jaTinhaEmail || !lead.cadencia_inicio) await iniciarCadencia(ctx, lead);
  if (input.prospect_id) {
    const pr = await getById(ctx, 'Prospect', input.prospect_id);
    if (pr?.status === 'A_ABORDAR') await marcarAbordado(ctx, pr, { canal: 'EMAIL', lead_id: lead.id });
  }
  return { lead_id: lead.id, assunto: m.assunto, enviados_hoje: envios.filter((e) => (e.enviado_em || '').slice(0, 10) === hoje).length + 1 };
}

export const actions = {
  listarModelosComerciais: {
    perm: 'lead.gerenciar',
    async run(ctx) { return (await garantirModelos(ctx)).sort((a, b) => (a.ordem || 99) - (b.ordem || 99)); },
  },

  salvarModeloComercial: {
    perm: 'lead.gerenciar',
    async run(ctx, input) {
      exigir(String(input.nome || '').trim() && String(input.assunto || '').trim() && String(input.corpo || '').trim(), 'Preencha nome, assunto e mensagem');
      const dados = { nome: String(input.nome).slice(0, 80), assunto: String(input.assunto).slice(0, 180), corpo: String(input.corpo).slice(0, 8000), ativo: input.ativo !== false, ordem: Number(input.ordem) || 50 };
      if (input.id) {
        const m = await getById(ctx, 'ModeloComercial', input.id);
        if (!m) throw new AccessError('Modelo não encontrado', 404);
        return alterar(ctx, 'ModeloComercial', m, dados, 'EDITAR_MODELO_COMERCIAL');
      }
      return criar(ctx, 'ModeloComercial', dados, 'CRIAR_MODELO_COMERCIAL');
    },
  },

  previaEmailComercial: {
    perm: 'lead.gerenciar',
    async run(ctx, input) {
      const m = await montar(ctx, input, `${ctx.urlBase || ''}/sair/exemplo`);
      return { assunto: m.assunto, html: m.html };
    },
  },

  /** Envia a apresentação para um contato (cria ou atualiza o lead e registra o envio). */
  enviarEmailComercial: {
    perm: 'lead.gerenciar',
    async run(ctx, input) { return enviarComercial(ctx, input); },
  },

  enviosDoLead: {
    perm: 'lead.gerenciar',
    async run(ctx, { lead_id }) {
      return (await find(ctx, 'EnvioComercial', { lead_id })).sort((a, b) => (a.enviado_em < b.enviado_em ? 1 : -1));
    },
  },
};

/** Descadastro de e-mails comerciais (link no rodapé). */
export async function sairDaListaComercial(ctx, lead_id) {
  const l = await getById(ctx, 'Lead', lead_id);
  if (!l || l.nao_receber_comercial) return false;
  await ctx.db.Lead.update(l.id, { nao_receber_comercial: true, status: l.status === 'CONVERTIDO' ? l.status : 'PERDIDO', observacoes: `${l.observacoes ? `${l.observacoes}\n` : ''}Pediu para não receber e-mails comerciais em ${ctx.now().toISOString().slice(0, 10)}.` });
  await notificar(ctx, null, { perfis: ['SUPERADMIN_HS'], tipo: 'LEAD', titulo: `${l.empresa} pediu para não receber e-mails comerciais`, mensagem: l.email, link: '/hs/leads' });
  return true;
}
