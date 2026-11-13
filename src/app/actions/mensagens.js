// Central de mensagens: WhatsApp assistido (abre o WhatsApp com o texto pronto e registra o envio),
// e-mail aos devedores (remetente do domínio, resposta para quem cobrou) e fila de contatos do dia.
import { podeAcessarCasoHS, isHS } from '../../core/permissions.js';
import { verificarMensagem, preencherModelo, LIMITE_CONTATOS_DIA } from '../../core/compliance.js';
import { telefoneBR, emailValido } from '../../core/documento.js';
import { casoAtivo } from '../../core/caseStatus.js';
import { formatBRL } from '../../core/money.js';
import { diasEntre } from '../../core/dates.js';
import { AccessError, ValidationError, getById, find, alterar, carregarCaso, exigir, requirePerm } from '../context.js';
import { actions as operacoes } from './operacoes.js';

const SAIDA = new Set(['TENTATIVA_CONTATO', 'MENSAGEM_ENVIADA', 'LIGACAO']);
const MINUTOS_PARA_DESFAZER = 30;
const DIAS_SEM_CONTATO = 3;
export const ASSUNTO_PADRAO = 'Pendência financeira com {{credor}}';

/** Modelos criados automaticamente (globais) quando ainda não existe nenhum modelo global. */
export const MODELOS_PADRAO = [
  { nome: 'Primeiro contato', canal: 'WHATSAPP', conteudo: 'Olá, {{nome}}, tudo bem? Estamos entrando em contato a respeito de uma pendência com a {{credor}}, no valor de {{valor}}, com vencimento em {{vencimento}}. Podemos conversar para encontrar a melhor forma de regularizar? Se você já pagou, por favor desconsidere esta mensagem e, se puder, nos envie o comprovante.' },
  { nome: 'Lembrete', canal: 'WHATSAPP', conteudo: 'Olá, {{nome}}! Passando para lembrar da pendência com a {{credor}}, no valor de {{valor}}. Temos condições para facilitar o pagamento. Quer que eu envie uma proposta?' },
  { nome: 'Proposta de acordo', canal: 'WHATSAPP', conteudo: 'Olá, {{nome}}. Temos uma condição especial para você regularizar a pendência com a {{credor}}. Posso enviar os detalhes por aqui?' },
  { nome: 'Lembrete de parcela do acordo', canal: 'WHATSAPP', conteudo: 'Olá, {{nome}}! Lembrete: a parcela do seu acordo com a {{credor}} vence em breve. Se já pagou, desconsidere esta mensagem. Qualquer dúvida, estamos à disposição.' },
  { nome: 'Primeiro contato', canal: 'EMAIL', assunto: 'Pendência financeira com {{credor}}', conteudo: 'Olá, {{nome}}.\n\nEstamos entrando em contato a respeito de uma pendência com a {{credor}}, no valor atualizado de {{valor}}, com vencimento original em {{vencimento}}.\n\nQueremos ajudar você a regularizar essa situação da forma mais conveniente. Responda este e-mail para conversarmos sobre as condições de pagamento.\n\nSe você já pagou, por favor desconsidere esta mensagem e, se puder, responda com o comprovante.\n\nAtenciosamente.' },
  { nome: 'Proposta de acordo', canal: 'EMAIL', assunto: 'Condições para regularizar sua pendência com {{credor}}', conteudo: 'Olá, {{nome}}.\n\nTemos condições especiais para você regularizar a pendência com a {{credor}}, hoje no valor de {{valor}}, com possibilidade de desconto e parcelamento.\n\nResponda este e-mail para receber a proposta.\n\nAtenciosamente.' },
];

/** Cria os modelos padrão se não houver nenhum modelo global (usa o banco direto, no início do sistema). */
export async function garantirModelosPadrao(db) {
  const globais = (await db.ModeloMensagem.filter({})).filter((m) => !m.empresa_id);
  if (globais.some((m) => m.canal === 'EMAIL')) return 0;
  let n = 0;
  for (const m of MODELOS_PADRAO) {
    if (globais.some((g) => g.nome === m.nome && g.canal === m.canal)) continue;
    await db.ModeloMensagem.create({ empresa_id: null, assunto: '', ...m, status: 'ATIVO', aprovado_meta: false });
    n++;
  }
  return n;
}

const dataBR = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

/** Monta o texto (modelo ou livre) com os dados do caso e confere destino e regras de linguagem. */
async function montarMensagem(ctx, caso, { canal, modelo_id, mensagem, assunto }) {
  exigir(['WHATSAPP', 'EMAIL'].includes(canal), 'Canal inválido');
  const devedor = await getById(ctx, 'Devedor', caso.devedor_id);
  const divida = await getById(ctx, 'Divida', caso.divida_id);
  const empresa = await getById(ctx, 'Empresa', caso.empresa_id);
  const credor = empresa.nome_fantasia || empresa.razao_social;
  const vars = { nome: devedor.nome.split(' ')[0], credor, valor: formatBRL(divida.saldo_atual_centavos), vencimento: dataBR(divida.data_vencimento) };
  let texto = mensagem || '';
  let titulo = assunto || '';
  if (modelo_id) {
    const modelo = await getById(ctx, 'ModeloMensagem', modelo_id);
    exigir(modelo && modelo.status === 'ATIVO' && (!modelo.empresa_id || modelo.empresa_id === caso.empresa_id), 'Modelo indisponível');
    exigir(modelo.canal === canal, `Este modelo é de ${modelo.canal === 'EMAIL' ? 'e-mail' : 'WhatsApp'}`);
    texto = preencherModelo(modelo.conteudo, vars);
    if (!assunto && modelo.assunto) titulo = preencherModelo(modelo.assunto, vars);
  } else texto = preencherModelo(texto, vars);
  if (canal === 'EMAIL') titulo = (titulo ? preencherModelo(titulo, vars) : preencherModelo(ASSUNTO_PADRAO, vars)).slice(0, 150);
  exigir(texto.trim(), 'Mensagem vazia');
  exigir(texto.length <= 4000, 'Mensagem muito longa (máximo de 4.000 caracteres)');
  verificarMensagem(`${titulo}\n${texto}`);
  exigir(!devedor.nao_contatar, 'Devedor solicitou interrupção de contato');
  let destino;
  if (canal === 'WHATSAPP') {
    destino = telefoneBR(devedor.whatsapp) || telefoneBR(devedor.telefone);
    exigir(destino, 'Devedor sem WhatsApp ou telefone válido');
  } else {
    exigir(!devedor.nao_contatar_email, 'O devedor pediu para não receber e-mails');
    destino = String(devedor.email || '').trim();
    exigir(emailValido(destino), 'Devedor sem e-mail válido');
  }
  return { texto, assunto: titulo, destino, devedor, divida, empresa, credor };
}

function podeOperar(ctx, caso) {
  exigir(casoAtivo(caso) && caso.status_operacional !== 'SUSPENSO', 'Caso encerrado ou suspenso');
  if (isHS(ctx.user)) exigir(caso.modalidade_cobranca === 'HS_GERENCIADA', 'Caso não é da cobrança gerenciada');
  else exigir(caso.modalidade_cobranca === 'AUTOCONTRATADA', 'Casos encaminhados ao Acorly são conduzidos pela equipe Acorly');
}

export const actions = {
  /** Pré-visualização da mensagem (não registra nada). */
  prepararMensagem: {
    perm: 'interacao.registrar',
    async run(ctx, input) {
      const caso = await carregarCaso(ctx, input.caso_id);
      podeOperar(ctx, caso);
      const m = await montarMensagem(ctx, caso, input);
      return { canal: input.canal, texto: m.texto, assunto: m.assunto, destino: m.destino };
    },
  },

  /**
   * WhatsApp assistido: registra o envio no histórico (com todas as regras: canal autorizado, horário,
   * limite diário e "não contatar") e devolve o link que abre o WhatsApp com o texto pronto.
   */
  enviarWhatsAppAssistido: {
    perm: 'interacao.registrar',
    async run(ctx, input) {
      const caso = await carregarCaso(ctx, input.caso_id);
      podeOperar(ctx, caso);
      const m = await montarMensagem(ctx, caso, { ...input, canal: 'WHATSAPP' });
      const inter = await operacoes.registrarInteracao.run(ctx, { caso_id: caso.id, canal: 'WHATSAPP', tipo_interacao: 'MENSAGEM_ENVIADA', mensagem: m.texto });
      await ctx.db.Interacao.update(inter.id, { envio_assistido: true, telefone_destino: m.destino });
      return { interacao_id: inter.id, link: `https://wa.me/${m.destino}?text=${encodeURIComponent(m.texto)}`, mensagem: m.texto, desfazer_ate: new Date(ctx.now().getTime() + MINUTOS_PARA_DESFAZER * 60000).toISOString() };
    },
  },

  /** "Não consegui enviar": desfaz o registro de um envio assistido (mesmo autor, até 30 minutos). */
  desfazerEnvio: {
    perm: 'interacao.registrar',
    async run(ctx, { interacao_id }) {
      const i = await getById(ctx, 'Interacao', interacao_id);
      if (!i || i.operador_id !== ctx.user.id) throw new AccessError('Envio não encontrado', 404);
      exigir(i.envio_assistido && !i.cancelada, 'Só é possível desfazer um envio assistido ainda não desfeito');
      exigir(ctx.now().getTime() - Date.parse(i.data_hora) <= MINUTOS_PARA_DESFAZER * 60000, `O prazo de ${MINUTOS_PARA_DESFAZER} minutos para desfazer terminou`);
      return alterar(ctx, 'Interacao', i, { cancelada: true, tipo_interacao: 'NOTA_INTERNA', observacoes: 'Envio desfeito: a mensagem não foi enviada no WhatsApp.' }, 'DESFAZER_ENVIO');
    },
  },

  /**
   * E-mail ao devedor. Remetente: endereço do domínio (EMAIL_COBRANCA_REMETENTE) com o nome do credor
   * (ou da HS, na cobrança gerenciada); as respostas vão para o e-mail de quem enviou.
   */
  enviarEmailDevedor: {
    perm: 'interacao.registrar',
    async run(ctx, input) {
      if (!ctx.email?.cobrancaDisponivel) throw new ValidationError('O envio de e-mail aos devedores será liberado quando o domínio próprio estiver configurado.');
      const caso = await carregarCaso(ctx, input.caso_id);
      podeOperar(ctx, caso);
      const m = await montarMensagem(ctx, caso, { ...input, canal: 'EMAIL' });
      const gerenciada = caso.modalidade_cobranca === 'HS_GERENCIADA';
      const inter = await operacoes.registrarInteracao.run(ctx, { caso_id: caso.id, canal: 'EMAIL', tipo_interacao: 'MENSAGEM_ENVIADA', mensagem: `Assunto: ${m.assunto}\n\n${m.texto}` });
      const cnpj = String(m.empresa.cnpj || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
      const r = await ctx.email.paraDevedor({
        para: m.destino,
        nomeRemetente: gerenciada ? 'HS Recuperação de Crédito' : `${m.credor} via Acorly`,
        responderPara: ctx.user.email,
        assunto: m.assunto,
        texto: m.texto,
        rodape: gerenciada
          ? `Cobrança realizada pela HS Recuperação de Crédito em nome de ${m.empresa.razao_social} (CNPJ ${cnpj}). Para falar conosco, responda este e-mail.`
          : `Mensagem enviada por ${m.empresa.razao_social} (CNPJ ${cnpj}). Para falar com a empresa, responda este e-mail.`,
        descadastrar: ctx.descadastro?.link(m.devedor.id) || null,
      });
      if (!r.ok) throw new ValidationError(`Não foi possível enviar o e-mail agora${r.erro ? ` (${r.erro})` : ''}. Nada foi registrado; tente novamente.`);
      await ctx.db.Interacao.update(inter.id, { envio_automatico: true, email_destino: m.destino, status_entrega: 'sent', mensagem_externa_id: r.id || null });
      return { interacao_id: inter.id, para: m.destino };
    },
  },

  /** Fila de contatos do dia: retornos agendados, parcelas de acordo, primeiro contato e casos parados. */
  filaDoDia: {
    perm: 'interacao.registrar',
    async run(ctx) {
      const u = ctx.user;
      let casos;
      if (!isHS(u)) { requirePerm(u, 'caso.ler_empresa'); casos = (await find(ctx, 'CasoCobranca', { empresa_id: u.empresa_id })).filter((c) => c.modalidade_cobranca === 'AUTOCONTRATADA'); }
      else if (u.perfil === 'OPERADOR_HS') casos = (await find(ctx, 'CasoCobranca', { operador_id: u.id })).filter((c) => podeAcessarCasoHS(u, c));
      else { requirePerm(u, 'caso.ler_todos_hs'); casos = (await find(ctx, 'CasoCobranca', { modalidade_cobranca: 'HS_GERENCIADA' })).filter((c) => c.operador_id); }
      const ignorar = new Set(['SUSPENSO', 'CONTESTACAO', 'AGUARDANDO_VALIDACAO', 'AGUARDANDO_AUTORIZACAO', 'PRONTO_PARA_COBRANCA', 'AGUARDANDO_OPERADOR']);
      const agora = ctx.now().toISOString();
      const hoje = agora.slice(0, 10);
      const em2dias = new Date(Date.parse(hoje) + 2 * 864e5).toISOString().slice(0, 10);
      const itens = [];
      for (const c of casos.filter((x) => casoAtivo(x) && !ignorar.has(x.status_operacional))) {
        const devedor = await getById(ctx, 'Devedor', c.devedor_id);
        if (!devedor || devedor.nao_contatar) continue;
        const inter = await find(ctx, 'Interacao', { caso_id: c.id });
        const contatosHoje = inter.filter((i) => SAIDA.has(i.tipo_interacao) && i.data_hora.slice(0, 10) === hoje).length;
        if (contatosHoje >= LIMITE_CONTATOS_DIA) continue;
        const motivos = [];
        let prioridade = 9;
        const tarefas = (await find(ctx, 'Tarefa', { caso_id: c.id })).filter((t) => t.status === 'PENDENTE' && t.data_prazo <= hoje);
        if (tarefas.length) { motivos.push(tarefas[0].data_prazo < hoje ? `Retorno atrasado (${dataBR(tarefas[0].data_prazo)}): ${tarefas[0].descricao}` : `Retorno agendado para hoje: ${tarefas[0].descricao}`); prioridade = Math.min(prioridade, 0); }
        const parcelas = (await find(ctx, 'Parcela', { divida_id: c.divida_id })).filter((p) => p.acordo_id && p.saldo_centavos > 0 && p.vencimento <= em2dias);
        if (parcelas.length) {
          const p = parcelas.sort((a, b) => (a.vencimento > b.vencimento ? 1 : -1))[0];
          motivos.push(p.vencimento < hoje ? `Parcela do acordo vencida em ${dataBR(p.vencimento)} (${formatBRL(p.saldo_centavos)})` : `Parcela do acordo vence em ${dataBR(p.vencimento)} (${formatBRL(p.saldo_centavos)})`);
          prioridade = Math.min(prioridade, p.vencimento < hoje ? 1 : 2);
        }
        const saidas = inter.filter((i) => SAIDA.has(i.tipo_interacao));
        if (!saidas.length) { motivos.push('Primeiro contato'); prioridade = Math.min(prioridade, 3); }
        else if (['EM_CONTATO', 'DEVEDOR_RESPONDEU', 'EM_NEGOCIACAO', 'ATRIBUIDO', 'PRIMEIRO_CONTATO_PENDENTE'].includes(c.status_operacional)) {
          const ultima = (c.ultima_interacao || saidas[saidas.length - 1].data_hora).slice(0, 10);
          const dias = diasEntre(ultima, hoje);
          if (dias >= DIAS_SEM_CONTATO) { motivos.push(`Sem contato há ${dias} dias`); prioridade = Math.min(prioridade, 4); }
        }
        if (!motivos.length) continue;
        const divida = await getById(ctx, 'Divida', c.divida_id);
        const empresa = await getById(ctx, 'Empresa', c.empresa_id);
        itens.push({
          caso_id: c.id, devedor_nome: devedor.nome, credor: empresa?.nome_fantasia || empresa?.razao_social, status_operacional: c.status_operacional,
          saldo_atual_centavos: divida?.saldo_atual_centavos ?? null, motivos, prioridade, contatos_hoje: contatosHoje,
          tem_whatsapp: !!(telefoneBR(devedor.whatsapp) || telefoneBR(devedor.telefone)), tem_email: emailValido(String(devedor.email || '')) && !devedor.nao_contatar_email,
          ultima_interacao: c.ultima_interacao || null,
        });
      }
      itens.sort((a, b) => a.prioridade - b.prioridade || (a.ultima_interacao || '') .localeCompare(b.ultima_interacao || ''));
      return { itens: itens.slice(0, 300), total: itens.length, limite_diario: LIMITE_CONTATOS_DIA, email_cobranca: !!ctx.email?.cobrancaDisponivel, whatsapp_api: !!ctx.whatsapp?.disponivel && isHS(ctx.user) };
    },
  },
};
