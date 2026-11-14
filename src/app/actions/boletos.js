// Formas de pagamento das parcelas de acordos: o CREDOR anexa o boleto (PDF e/ou linha digitável) ou o Pix
// (copia e cola) / link de pagamento de cada parcela; a equipe envia ao devedor por WhatsApp ou e-mail.
// O dinheiro continua indo direto ao credor: o sistema só guarda e repassa as instruções de pagamento.
import { isHS, podeAcessarCasoHS } from '../../core/permissions.js';
import { formatBRL } from '../../core/money.js';
import { telefoneBR, emailValido } from '../../core/documento.js';
import { AccessError, ValidationError, getById, find, criar, alterar, exigir, notificar, carregarCaso, requirePerm } from '../context.js';
import { actions as operacoes } from './operacoes.js';

const ABERTA = (p) => p.saldo_centavos > 0 && !['PAGA', 'CANCELADA', 'SUBSTITUIDA'].includes(p.status);
const DIAS_LINK_APOS_VENCIMENTO = 15;
const dataBR = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const somenteDigitos = (s) => String(s || '').replace(/\D/g, '');
const nomeParcela = (p) => (p.numero === 0 ? 'Entrada' : `Parcela ${p.numero}`);

function validarDados({ linha_digitavel, pix_copia_cola, link_pagamento }) {
  const linha = somenteDigitos(linha_digitavel);
  if (linha_digitavel) exigir([44, 47, 48].includes(linha.length), 'Linha digitável inválida: confira os números do boleto (47 ou 48 dígitos).');
  const pix = String(pix_copia_cola || '').trim();
  if (pix) exigir(/^0002\d{2}/.test(pix) && pix.length >= 50 && pix.length <= 600, 'Pix copia e cola inválido: copie o código completo gerado pelo banco.');
  const link = String(link_pagamento || '').trim();
  if (link) exigir(/^https:\/\/[^\s]{4,500}$/.test(link), 'O link de pagamento precisa começar com https://');
  return { linha_digitavel: linha || null, pix_copia_cola: pix || null, link_pagamento: link || null };
}

async function acordoDoCredor(ctx, acordo_id) {
  const acordo = await getById(ctx, 'Acordo', acordo_id);
  if (!acordo || isHS(ctx.user) || acordo.empresa_id !== ctx.user.empresa_id) throw new AccessError('Acordo não encontrado', 404);
  return acordo;
}

/** Forma de pagamento vigente de cada parcela (a mais recente ativa). */
async function formasVigentes(ctx, acordo_id) {
  const todas = await find(ctx, 'PagamentoParcela', { acordo_id });
  const vig = new Map();
  for (const f of todas.filter((x) => x.status === 'ATIVO')) vig.set(f.parcela_id, f);
  return { vig, todas };
}

async function linkBoleto(ctx, forma, parcela) {
  if (!forma.arquivo_uri || !ctx.files?.signedUrl) return null;
  const ate = Date.parse(`${parcela.vencimento}T23:59:59Z`) + DIAS_LINK_APOS_VENCIMENTO * 864e5;
  const segundos = Math.max(3 * 86400, Math.round((ate - ctx.now().getTime()) / 1000));
  const caminho = await ctx.files.signedUrl(forma.arquivo_uri, segundos);
  return caminho.startsWith('http') ? caminho : `${ctx.urlBase || ''}${caminho}`;
}

/** Texto da cobrança da parcela, com as instruções que o credor informou. */
function textoCobranca({ devedor, credor, parcela, forma, link }) {
  const linhas = [
    `Olá, ${devedor.nome.split(' ')[0]}! Seguem os dados para o pagamento ${parcela.numero === 0 ? 'da entrada' : `da parcela ${parcela.numero}`} do seu acordo com a ${credor}:`,
    '',
    `Valor: ${formatBRL(parcela.saldo_centavos)}`,
    `Vencimento: ${dataBR(parcela.vencimento)}`,
  ];
  if (forma.linha_digitavel) linhas.push('', `Linha digitável do boleto: ${forma.linha_digitavel}`);
  if (link) linhas.push('', `Boleto em PDF: ${link}`);
  if (forma.pix_copia_cola) linhas.push('', 'Pix copia e cola:', forma.pix_copia_cola);
  if (forma.link_pagamento) linhas.push('', `Link de pagamento: ${forma.link_pagamento}`);
  linhas.push('', `O pagamento é feito diretamente à ${credor}. Depois de pagar, se puder, envie o comprovante por aqui.`);
  return linhas.join('\n');
}

export const actions = {
  /**
   * Credor (administrador ou financeiro) informa o pagamento de uma parcela: boleto (PDF e/ou linha digitável),
   * Pix copia e cola e/ou link. Substitui a forma anterior (fica no histórico). Pix e link podem valer para todas
   * as parcelas em aberto do acordo.
   */
  salvarPagamentoParcela: {
    perm: 'pagamento.confirmar',
    async run(ctx, input) {
      const parcela = await getById(ctx, 'Parcela', input.parcela_id);
      if (!parcela?.acordo_id) throw new AccessError('Parcela não encontrada', 404);
      const acordo = await acordoDoCredor(ctx, parcela.acordo_id);
      exigir(acordo.status === 'ATIVO', 'O acordo não está ativo');
      const dados = validarDados(input);
      let arquivo_uri = null, arquivo_nome = null;
      if (input.arquivo_uri) {
        if (ctx.files?.reivindicar) exigir(await ctx.files.reivindicar(input.arquivo_uri, ctx.authEmail), 'Arquivo do boleto inválido ou já utilizado. Envie o arquivo de novo.');
        arquivo_uri = input.arquivo_uri; arquivo_nome = String(input.arquivo_nome || 'boleto.pdf').slice(0, 150);
      }
      exigir(arquivo_uri || dados.linha_digitavel || dados.pix_copia_cola || dados.link_pagamento, 'Anexe o boleto ou informe a linha digitável, o Pix copia e cola ou um link de pagamento.');
      const todas = input.aplicar_todas === true;
      exigir(!todas || (!arquivo_uri && !dados.linha_digitavel), 'Boletos são individuais: para usar em todas as parcelas, informe só o Pix ou o link de pagamento.');
      const parcelas = todas ? (await find(ctx, 'Parcela', { acordo_id: acordo.id })).filter(ABERTA) : [parcela];
      exigir(parcelas.length && parcelas.every(ABERTA), 'Parcela já paga ou cancelada');
      const { vig } = await formasVigentes(ctx, acordo.id);
      const agora = ctx.now().toISOString();
      const criadas = [];
      for (const p of parcelas) {
        const anterior = vig.get(p.id);
        if (anterior) await ctx.db.PagamentoParcela.update(anterior.id, { status: 'SUBSTITUIDO', substituido_em: agora });
        criadas.push(await criar(ctx, 'PagamentoParcela', {
          empresa_id: acordo.empresa_id, acordo_id: acordo.id, caso_id: acordo.caso_id, parcela_id: p.id, ...dados, arquivo_uri, arquivo_nome,
          tipo: arquivo_uri || dados.linha_digitavel ? 'BOLETO' : dados.pix_copia_cola ? 'PIX' : 'LINK', status: 'ATIVO', informado_por: ctx.user.id, informado_em: agora,
          substitui_id: anterior?.id || null, enviado_ao_devedor_em: null,
        }, anterior ? 'SUBSTITUIR_PAGAMENTO_PARCELA' : 'INFORMAR_PAGAMENTO_PARCELA'));
      }
      // Avisa quem conduz a cobrança para enviar ao devedor
      const caso = await getById(ctx, 'CasoCobranca', acordo.caso_id);
      if (caso?.operador_id) {
        const devedor = await getById(ctx, 'Devedor', caso.devedor_id);
        await ctx.db.Notificacao.create({ empresa_id: null, usuario_id: caso.operador_id, tipo: 'BOLETO_DISPONIVEL', titulo: criadas.length > 1 ? 'Formas de pagamento disponíveis' : vig.get(parcela.id) ? 'Boleto atualizado pelo credor' : 'Boleto disponível', mensagem: `${devedor?.nome || 'Devedor'}: envie ao devedor.`, lida: false, data_criacao: agora, link: `/casos/${caso.id}` });
      }
      return { registradas: criadas.length };
    },
  },

  /** Parcelas do acordo com a forma de pagamento vigente e o histórico (credor ou equipe com acesso ao caso). */
  pagamentosDoAcordo: {
    perm: null,
    async run(ctx, { acordo_id }) {
      const acordo = await getById(ctx, 'Acordo', acordo_id);
      if (!acordo) throw new AccessError('Acordo não encontrado', 404);
      await carregarCaso(ctx, acordo.caso_id); // valida o acesso (empresa dona ou equipe autorizada)
      const parcelas = (await find(ctx, 'Parcela', { acordo_id })).sort((a, b) => a.numero - b.numero);
      const { vig, todas } = await formasVigentes(ctx, acordo_id);
      return parcelas.map((p) => {
        const f = vig.get(p.id) || null;
        return {
          ...p, aberta: ABERTA(p),
          forma: f && { id: f.id, tipo: f.tipo, linha_digitavel: f.linha_digitavel, pix_copia_cola: f.pix_copia_cola, link_pagamento: f.link_pagamento, tem_boleto: !!f.arquivo_uri, arquivo_nome: f.arquivo_nome, informado_em: f.informado_em, enviado_ao_devedor_em: f.enviado_ao_devedor_em },
          substituicoes: todas.filter((x) => x.parcela_id === p.id && x.status === 'SUBSTITUIDO').length,
        };
      });
    },
  },

  /** Link temporário para ver o boleto em PDF (credor ou equipe com acesso ao caso). */
  urlBoleto: {
    perm: null,
    async run(ctx, { forma_id }) {
      const f = await getById(ctx, 'PagamentoParcela', forma_id);
      if (!f?.arquivo_uri) throw new AccessError('Boleto não encontrado', 404);
      await carregarCaso(ctx, f.caso_id);
      return { url: await ctx.files.signedUrl(f.arquivo_uri, 300) };
    },
  },

  /** Parcelas de acordos da cobrança gerenciada que ainda estão sem forma de pagamento (painel do credor). */
  boletosPendentes: {
    perm: 'pagamento.confirmar',
    async run(ctx) {
      exigir(!isHS(ctx.user), 'Disponível para o credor');
      const acordos = (await find(ctx, 'Acordo', { empresa_id: ctx.user.empresa_id, status: 'ATIVO' }));
      const itens = [];
      for (const a of acordos) {
        const { vig } = await formasVigentes(ctx, a.id);
        const faltam = (await find(ctx, 'Parcela', { acordo_id: a.id })).filter((p) => ABERTA(p) && !vig.has(p.id));
        if (!faltam.length) continue;
        const caso = await getById(ctx, 'CasoCobranca', a.caso_id);
        const devedor = await getById(ctx, 'Devedor', caso?.devedor_id);
        const prox = faltam.map((p) => p.vencimento).sort()[0];
        itens.push({ acordo_id: a.id, caso_id: a.caso_id, devedor_nome: devedor?.nome || '—', parcelas_sem_pagamento: faltam.length, proximo_vencimento: prox, gerenciada: caso?.modalidade_cobranca === 'HS_GERENCIADA' });
      }
      return itens.sort((a, b) => (a.proximo_vencimento > b.proximo_vencimento ? 1 : -1));
    },
  },

  /**
   * Envia ao devedor os dados de pagamento de uma parcela. WhatsApp: abre o WhatsApp com o texto pronto (assistido).
   * E-mail: envia pelo sistema com o boleto em PDF anexado. Fica registrado no histórico do caso.
   */
  enviarPagamentoParcela: {
    perm: 'interacao.registrar',
    async run(ctx, { parcela_id, canal }) {
      exigir(['WHATSAPP', 'EMAIL'].includes(canal), 'Canal inválido');
      const parcela = await getById(ctx, 'Parcela', parcela_id);
      if (!parcela?.acordo_id) throw new AccessError('Parcela não encontrada', 404);
      const acordo = await getById(ctx, 'Acordo', parcela.acordo_id);
      const caso = await carregarCaso(ctx, acordo.caso_id);
      if (isHS(ctx.user)) exigir(caso.modalidade_cobranca === 'HS_GERENCIADA' && podeAcessarCasoHS(ctx.user, caso), 'Caso não está com você');
      else exigir(caso.modalidade_cobranca === 'AUTOCONTRATADA', 'Casos encaminhados ao Acorly são conduzidos pela equipe Acorly');
      exigir(ABERTA(parcela), 'Parcela já paga ou cancelada');
      const { vig } = await formasVigentes(ctx, acordo.id);
      const forma = vig.get(parcela.id);
      exigir(forma, 'O credor ainda não informou o boleto ou o Pix desta parcela');
      const devedor = await getById(ctx, 'Devedor', caso.devedor_id);
      const empresa = await getById(ctx, 'Empresa', caso.empresa_id);
      const credor = empresa.nome_fantasia || empresa.razao_social;
      const link = await linkBoleto(ctx, forma, parcela);
      const texto = textoCobranca({ devedor, credor, parcela, forma, link: canal === 'WHATSAPP' ? link : null });
      const agora = ctx.now().toISOString();
      if (canal === 'WHATSAPP') {
        const fone = telefoneBR(devedor.whatsapp) || telefoneBR(devedor.telefone);
        exigir(fone, 'Devedor sem WhatsApp ou telefone válido');
        const inter = await operacoes.registrarInteracao.run(ctx, { caso_id: caso.id, canal: 'WHATSAPP', tipo_interacao: 'MENSAGEM_ENVIADA', mensagem: texto });
        await ctx.db.Interacao.update(inter.id, { envio_assistido: true, telefone_destino: fone });
        await ctx.db.PagamentoParcela.update(forma.id, { enviado_ao_devedor_em: agora });
        return { interacao_id: inter.id, link: `https://wa.me/${fone}?text=${encodeURIComponent(texto)}`, mensagem: texto, desfazer_ate: new Date(ctx.now().getTime() + 30 * 60000).toISOString() };
      }
      if (!ctx.email?.cobrancaDisponivel) throw new ValidationError('O envio de e-mail aos devedores ainda não está configurado.');
      exigir(!devedor.nao_contatar_email, 'O devedor pediu para não receber e-mails');
      exigir(emailValido(String(devedor.email || '')), 'Devedor sem e-mail válido');
      const anexos = [];
      if (forma.arquivo_uri && ctx.files?.conteudo) {
        const arq = await ctx.files.conteudo(forma.arquivo_uri);
        if (arq) anexos.push({ nome: forma.arquivo_nome || `boleto-${parcela.vencimento}.pdf`, conteudo: arq.buffer, mime: arq.mime });
      }
      const textoEmail = textoCobranca({ devedor, credor, parcela, forma, link: anexos.length ? null : link }) + (anexos.length ? '\n\nO boleto está anexado a este e-mail.' : '');
      const assunto = `${nomeParcela(parcela)} do seu acordo com ${credor}: vencimento ${dataBR(parcela.vencimento)}`;
      const inter = await operacoes.registrarInteracao.run(ctx, { caso_id: caso.id, canal: 'EMAIL', tipo_interacao: 'MENSAGEM_ENVIADA', mensagem: `Assunto: ${assunto}\n\n${textoEmail}` });
      const gerenciada = caso.modalidade_cobranca === 'HS_GERENCIADA';
      const cnpj = String(empresa.cnpj || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
      const r = await ctx.email.paraDevedor({
        para: devedor.email.trim(), nomeRemetente: gerenciada ? 'HS Recuperação de Crédito' : `${credor} via Acorly`, responderPara: ctx.user.email,
        assunto, texto: textoEmail, anexos,
        rodape: gerenciada ? `Cobrança realizada pela HS Recuperação de Crédito em nome de ${empresa.razao_social} (CNPJ ${cnpj}). O pagamento é feito diretamente ao credor.` : `Mensagem enviada por ${empresa.razao_social} (CNPJ ${cnpj}).`,
        descadastrar: ctx.descadastro?.link(devedor.id) || null,
      });
      if (!r.ok) throw new ValidationError(`Não foi possível enviar o e-mail agora${r.erro ? ` (${r.erro})` : ''}. Tente novamente.`);
      await ctx.db.Interacao.update(inter.id, { envio_automatico: true, email_destino: devedor.email.trim(), status_entrega: 'sent', mensagem_externa_id: r.id || null });
      await ctx.db.PagamentoParcela.update(forma.id, { enviado_ao_devedor_em: agora });
      return { interacao_id: inter.id, para: devedor.email.trim(), anexou_boleto: anexos.length > 0 };
    },
  },
};

/** Dados de pagamento da parcela (para os lembretes automáticos), ou null. */
export async function dadosPagamentoParcela(ctx, parcela) {
  const f = (await find(ctx, 'PagamentoParcela', { parcela_id: parcela.id })).filter((x) => x.status === 'ATIVO').pop();
  if (!f) return null;
  return { forma: f, link: await linkBoleto(ctx, f, parcela) };
}

/** Aviso ao credor quando um acordo é formalizado: informar boleto ou Pix das parcelas. */
export async function pedirPagamentosAoCredor(ctx, acordo, devedorNome) {
  await notificar(ctx, acordo.empresa_id, { perfis: ['ADMIN_EMPRESA', 'FINANCEIRO_EMPRESA'], tipo: 'BOLETOS_PENDENTES', titulo: `Acordo com ${devedorNome}: envie os boletos ou o Pix`, mensagem: 'Informe a forma de pagamento de cada parcela (boleto em PDF, linha digitável ou Pix copia e cola) para a equipe enviar ao devedor.', link: `/casos/${acordo.caso_id}` });
}
