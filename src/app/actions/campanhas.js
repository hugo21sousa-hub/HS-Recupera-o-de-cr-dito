// Campanhas de e-mail a partir de planilha: conferência da lista, prévia e envio aos poucos
// (no máximo o limite diário de e-mails comerciais, em lotes de hora em hora no horário comercial).
import { emailValido, somenteDigitos } from '../../core/documento.js';
import { AccessError, ValidationError, getById, find, criar, alterar, exigir, notificar } from '../context.js';
import { enviarComercial, montar, garantirModelos, LIMITE_DIARIO_COMERCIAL } from './prospeccao.js';

export const MAX_DESTINATARIOS = 2000;
export const LOTE_POR_RODADA = 10;
const DIAS_SEM_REPETIR = 30;
const SEGMENTOS = ['ESCOLA_CURSO', 'SAUDE', 'ACADEMIA', 'CONDOMINIO', 'VAREJO', 'DISTRIBUIDORA', 'SERVICOS', 'IMOBILIARIA', 'OUTRO'];
const GRATUITOS = /@(gmail|hotmail|outlook|yahoo|live|bol|uol|icloud|terra|ig)\./i;

/** "contato@colegio-sophia.com.br" → "Colegio Sophia" (só para e-mails de domínio próprio). */
export function empresaDoEmail(email) {
  const m = /@([^@\s]+)$/.exec(String(email || '').trim());
  if (!m || GRATUITOS.test(email)) return '';
  return m[1].toLowerCase().replace(/^www\./, '').split('.')[0].split(/[-_]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

const ROTULO_SEGMENTO = { escola: 'ESCOLA_CURSO', curso: 'ESCOLA_CURSO', colegio: 'ESCOLA_CURSO', faculdade: 'ESCOLA_CURSO', saude: 'SAUDE', clinica: 'SAUDE', odonto: 'SAUDE', academia: 'ACADEMIA', condominio: 'CONDOMINIO', varejo: 'VAREJO', loja: 'VAREJO', distribuidora: 'DISTRIBUIDORA', servicos: 'SERVICOS', imobiliaria: 'IMOBILIARIA' };
function segmentoDe(v) {
  const t = String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  if (!t) return '';
  if (SEGMENTOS.includes(t.toUpperCase())) return t.toUpperCase();
  const k = Object.keys(ROTULO_SEGMENTO).find((x) => t.includes(x));
  return k ? ROTULO_SEGMENTO[k] : 'OUTRO';
}

/** Confere a lista: inválidos, repetidos, quem pediu para sair, quem recebeu há pouco e quem já está em outra fila. */
export async function conferirLista(ctx, contatos) {
  exigir(Array.isArray(contatos) && contatos.length, 'A planilha não tem contatos');
  exigir(contatos.length <= MAX_DESTINATARIOS, `Envie no máximo ${MAX_DESTINATARIOS} contatos por campanha`);
  const limite = new Date(ctx.now().getTime() - DIAS_SEM_REPETIR * 864e5).toISOString();
  const leads = await find(ctx, 'Lead', {});
  const bloqueados = new Set(leads.filter((l) => l.nao_receber_comercial).map((l) => String(l.email || '').toLowerCase()));
  const recentes = new Set((await find(ctx, 'EnvioComercial', {})).filter((e) => (e.enviado_em || '') >= limite).map((e) => e.email));
  const ativas = new Set((await find(ctx, 'CampanhaEmail', {})).filter((c) => ['ATIVA', 'PAUSADA'].includes(c.status)).map((c) => c.id));
  const naFila = new Set((await find(ctx, 'CampanhaDestinatario', { status: 'PENDENTE' })).filter((d) => ativas.has(d.campanha_id)).map((d) => d.email));
  const vistos = new Set();
  const validos = [], invalidos = [], ignorados = [];
  contatos.forEach((c, i) => {
    const linha = Number(c?.linha) || i + 2;
    const email = String(c?.email || '').trim().toLowerCase();
    const empresa = String(c?.empresa || '').trim().slice(0, 160) || empresaDoEmail(email);
    if (!emailValido(email)) { invalidos.push({ linha, email: email || '(vazio)', motivo: 'E-mail inválido' }); return; }
    if (!empresa) { invalidos.push({ linha, email, motivo: 'Informe a empresa (e-mail de Gmail, Hotmail etc.)' }); return; }
    let motivo = null;
    if (vistos.has(email)) motivo = 'Repetido na planilha';
    else if (bloqueados.has(email)) motivo = 'Pediu para não receber e-mails da Acorly';
    else if (recentes.has(email)) motivo = `Recebeu e-mail nos últimos ${DIAS_SEM_REPETIR} dias`;
    else if (naFila.has(email)) motivo = 'Já está na fila de outra campanha';
    vistos.add(email);
    if (motivo) { ignorados.push({ linha, email, motivo }); return; }
    validos.push({ email, empresa, nome: String(c?.nome || '').trim().slice(0, 120), segmento: segmentoDe(c?.segmento), whatsapp: somenteDigitos(c?.whatsapp || c?.telefone).slice(0, 13) });
  });
  return { validos, invalidos, ignorados };
}

async function modeloEscolhido(ctx, { modelo_id, assunto, corpo }) {
  await garantirModelos(ctx);
  const m = modelo_id ? await getById(ctx, 'ModeloComercial', modelo_id) : null;
  if (modelo_id && !m) throw new AccessError('Modelo não encontrado', 404);
  const a = String(assunto || m?.assunto || '').trim(), b = String(corpo || m?.corpo || '').trim();
  exigir(a && b, 'Escolha um modelo de e-mail');
  return { modelo_id: m?.id || null, modelo_nome: m?.nome || 'Texto próprio', assunto: a.slice(0, 180), corpo: b.slice(0, 8000) };
}

const ehLimite = (e) => /^Limite de \d+ e-mails/.test(e?.message || '');
const enviadosHoje = async (ctx) => { const hoje = ctx.now().toISOString().slice(0, 10); return (await find(ctx, 'EnvioComercial', {})).filter((e) => (e.enviado_em || '').slice(0, 10) === hoje).length; };

/** Envia o próximo lote das campanhas ativas (até `max` e-mails, respeitando o limite diário). */
export async function processarCampanhas(ctx, { max = LOTE_POR_RODADA, campanha_id = null } = {}) {
  if (!ctx.email?.comercial) return { enviados: 0, motivo: 'e-mail não configurado' };
  let vagas = Math.min(max, LIMITE_DIARIO_COMERCIAL - await enviadosHoje(ctx));
  let enviados = 0, falhas = 0;
  const campanhas = (await find(ctx, 'CampanhaEmail', { status: 'ATIVA' })).filter((c) => !campanha_id || c.id === campanha_id).sort((a, b) => (a.criada_em > b.criada_em ? 1 : -1));
  for (const c of campanhas) {
    if (vagas <= 0) break;
    const ctxC = { ...ctx, user: { id: c.criada_por || 'sistema', nome: c.remetente_nome || 'Equipe Acorly', perfil: 'SUPERADMIN_HS', email: 'campanha@acorly' } };
    const fila = (await find(ctx, 'CampanhaDestinatario', { campanha_id: c.id, status: 'PENDENTE' })).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    let parar = false;
    for (const d of fila) {
      if (vagas <= 0) break;
      try {
        const r = await enviarComercial(ctxC, { para: d.email, nome: d.nome, empresa: d.empresa, segmento: d.segmento || undefined, whatsapp: d.whatsapp, modelo_id: c.modelo_id || undefined, assunto: c.assunto, corpo: c.corpo, campanha_id: c.id });
        await ctx.db.CampanhaDestinatario.update(d.id, { status: 'ENVIADO', enviado_em: ctx.now().toISOString(), lead_id: r.lead_id, motivo: null });
        enviados++; vagas--;
      } catch (e) {
        if (ehLimite(e)) { parar = true; break; }
        const tent = Number(d.tentativas || 0) + 1;
        const definitivo = e instanceof ValidationError && /não receber|e-mail válido/.test(e.message);
        await ctx.db.CampanhaDestinatario.update(d.id, definitivo ? { status: 'IGNORADO', motivo: e.message, tentativas: tent } : { status: tent >= 3 ? 'FALHA' : 'PENDENTE', motivo: String(e.message || 'Falha no envio').slice(0, 300), tentativas: tent });
        if (!definitivo) { falhas++; vagas--; }
      }
    }
    if (parar) break;
    if (!(await find(ctx, 'CampanhaDestinatario', { campanha_id: c.id, status: 'PENDENTE' })).length) {
      await ctx.db.CampanhaEmail.update(c.id, { status: 'CONCLUIDA', concluida_em: ctx.now().toISOString() });
      const ds = await find(ctx, 'CampanhaDestinatario', { campanha_id: c.id });
      await notificar(ctx, null, { perfis: ['SUPERADMIN_HS'], tipo: 'LEAD', titulo: `Campanha concluída: ${c.nome}`, mensagem: `${ds.filter((d) => d.status === 'ENVIADO').length} e-mail(s) enviado(s)${ds.some((d) => d.status === 'FALHA') ? `, ${ds.filter((d) => d.status === 'FALHA').length} com falha` : ''}.`, link: '/hs/leads' });
    }
  }
  return { enviados, falhas };
}

async function resumo(ctx, c) {
  const ds = await find(ctx, 'CampanhaDestinatario', { campanha_id: c.id });
  const conta = (s) => ds.filter((d) => d.status === s).length;
  const leads = new Set(ds.map((d) => d.lead_id).filter(Boolean));
  const sairam = leads.size ? (await find(ctx, 'Lead', {})).filter((l) => leads.has(l.id) && l.nao_receber_comercial).length : 0;
  const pend = conta('PENDENTE');
  return { ...c, corpo: undefined, enviados: conta('ENVIADO'), pendentes: pend, falhas: conta('FALHA'), ignorados: conta('IGNORADO'), sairam, dias_restantes: Math.ceil(pend / LIMITE_DIARIO_COMERCIAL) };
}

export const actions = {
  /** Confere a planilha e mostra a prévia (nada é enviado). */
  previaCampanha: {
    perm: 'lead.gerenciar',
    async run(ctx, input) {
      const lista = await conferirLista(ctx, input.contatos);
      const m = await modeloEscolhido(ctx, input);
      const amostra = [];
      for (const v of lista.validos.slice(0, 3)) {
        const r = await montar(ctx, { ...v, assunto: m.assunto, corpo: m.corpo }, `${ctx.urlBase || ''}/sair/exemplo`);
        amostra.push({ email: v.email, empresa: v.empresa, assunto: r.assunto, html: r.html });
      }
      const livresHoje = Math.max(0, LIMITE_DIARIO_COMERCIAL - await enviadosHoje(ctx));
      return {
        validos: lista.validos.length, invalidos: lista.invalidos.slice(0, 200), total_invalidos: lista.invalidos.length,
        ignorados: lista.ignorados.slice(0, 200), total_ignorados: lista.ignorados.length, amostra,
        limite_diario: LIMITE_DIARIO_COMERCIAL, livres_hoje: livresHoje,
        dias_estimados: lista.validos.length <= livresHoje ? 1 : 1 + Math.ceil((lista.validos.length - livresHoje) / LIMITE_DIARIO_COMERCIAL),
      };
    },
  },

  /** Cria a campanha com os contatos válidos e envia o primeiro lote. */
  criarCampanha: {
    perm: 'lead.gerenciar',
    async run(ctx, input) {
      const nome = String(input.nome || '').trim().slice(0, 120);
      exigir(nome.length >= 3, 'Dê um nome à campanha');
      const lista = await conferirLista(ctx, input.contatos);
      exigir(lista.validos.length, 'Nenhum contato válido para enviar');
      const m = await modeloEscolhido(ctx, input);
      const c = await criar(ctx, 'CampanhaEmail', {
        nome, ...m, remetente_nome: ctx.user.nome || 'Equipe Acorly', criada_por: ctx.user.id, criada_em: ctx.now().toISOString(),
        arquivo_nome: String(input.arquivo_nome || '').slice(0, 160), status: 'ATIVA', total: lista.validos.length,
      }, 'CRIAR_CAMPANHA_EMAIL');
      let ordem = 0;
      for (const v of lista.validos) await ctx.db.CampanhaDestinatario.create({ campanha_id: c.id, ...v, ordem: ordem++, status: 'PENDENTE', tentativas: 0 });
      const lote = await processarCampanhas(ctx, { max: LOTE_POR_RODADA, campanha_id: c.id });
      return { id: c.id, na_fila: lista.validos.length, enviados_agora: lote.enviados, ignorados: lista.ignorados.length, invalidos: lista.invalidos.length };
    },
  },

  listarCampanhas: {
    perm: 'lead.gerenciar',
    async run(ctx) {
      const cs = (await find(ctx, 'CampanhaEmail', {})).sort((a, b) => (a.criada_em < b.criada_em ? 1 : -1));
      const out = [];
      for (const c of cs.slice(0, 100)) out.push(await resumo(ctx, c));
      return { itens: out, total: cs.length, enviados_hoje: await enviadosHoje(ctx), limite_diario: LIMITE_DIARIO_COMERCIAL };
    },
  },

  destinatariosCampanha: {
    perm: 'lead.gerenciar',
    async run(ctx, { id, status }) {
      const c = await getById(ctx, 'CampanhaEmail', id);
      if (!c) throw new AccessError('Campanha não encontrada', 404);
      let ds = await find(ctx, 'CampanhaDestinatario', { campanha_id: id });
      if (status) ds = ds.filter((d) => d.status === status);
      return ds.sort((a, b) => (a.ordem || 0) - (b.ordem || 0)).slice(0, 2000);
    },
  },

  alterarCampanha: {
    perm: 'lead.gerenciar',
    async run(ctx, { id, acao }) {
      const c = await getById(ctx, 'CampanhaEmail', id);
      if (!c) throw new AccessError('Campanha não encontrada', 404);
      const novo = { pausar: 'PAUSADA', retomar: 'ATIVA', cancelar: 'CANCELADA' }[acao];
      exigir(novo, 'Ação inválida');
      exigir(acao === 'pausar' ? c.status === 'ATIVA' : acao === 'retomar' ? c.status === 'PAUSADA' : ['ATIVA', 'PAUSADA'].includes(c.status), 'Não é possível nesta situação');
      if (acao === 'cancelar') for (const d of await find(ctx, 'CampanhaDestinatario', { campanha_id: id, status: 'PENDENTE' })) await ctx.db.CampanhaDestinatario.update(d.id, { status: 'IGNORADO', motivo: 'Campanha cancelada' });
      return alterar(ctx, 'CampanhaEmail', c, { status: novo, ...(acao === 'cancelar' ? { concluida_em: ctx.now().toISOString() } : {}) }, `CAMPANHA_${acao.toUpperCase()}`);
    },
  },

  /** Envia agora o próximo lote (sem esperar a próxima hora), dentro do limite do dia. */
  enviarLoteCampanha: {
    perm: 'lead.gerenciar',
    async run(ctx, { id }) {
      const c = await getById(ctx, 'CampanhaEmail', id);
      if (!c) throw new AccessError('Campanha não encontrada', 404);
      exigir(c.status === 'ATIVA', 'A campanha não está ativa');
      exigir(await enviadosHoje(ctx) < LIMITE_DIARIO_COMERCIAL, `O limite de ${LIMITE_DIARIO_COMERCIAL} e-mails de hoje já foi usado. O envio continua amanhã, sozinho.`);
      return processarCampanhas(ctx, { max: LOTE_POR_RODADA, campanha_id: id });
    },
  },
};
