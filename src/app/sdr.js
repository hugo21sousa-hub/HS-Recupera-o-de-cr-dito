// SDR automático (pré-vendedor): envia sozinho o primeiro e-mail aos contatos da busca diária,
// faz os follow-ups dos dias 3, 7 e 14 por e-mail, lê as respostas na caixa de entrada,
// para de insistir quando o contato responde e avisa a equipe. A classificação das respostas
// (interessado, pergunta, agora não, não quer) é feita pela tarefa diária do Claude pela API de integração.
import { emailValido } from '../core/documento.js';
import { ValidationError, find, getById, notificar } from './context.js';
import { enviarComercial, ASSINATURA, LIMITE_DIARIO_COMERCIAL } from './actions/prospeccao.js';
import { textoFollowup, followupVencido, hojeBrasilia } from './actions/acompanhamento.js';

/** Volume diário cresce aos poucos para o domínio ganhar reputação (aquecimento). */
export const VOLUME_SDR = [{ ate_dia: 7, por_dia: 15 }, { ate_dia: 14, por_dia: 25 }, { ate_dia: Infinity, por_dia: 40 }];
export const POR_RODADA = 5;
export const DIAS_RETOMAR = 60;
const GRATUITOS = /@(gmail|hotmail|outlook|yahoo|live|bol|uol|icloud|terra|ig)\./i;
const NAO_QUER = /(n[aã]o (tenho|temos|h[aá]) interesse|sem interesse|remov(a|er|am)|descadastr|tir(a|ar|em) (meu|nosso|o) (e-?mail|contato)|n[aã]o (envie|enviem|mande|mandem)|parem? de (enviar|mandar)|unsubscribe)/i;

const somaDias = (iso, d) => new Date(Date.parse(`${iso}T12:00:00Z`) + d * 864e5).toISOString().slice(0, 10);
const diasEntre = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
const dominio = (e) => String(e || '').toLowerCase().split('@')[1] || '';

export async function configSdr(ctx) {
  return (await find(ctx, 'ConfiguracaoHS', {}))[0] || ctx.db.ConfiguracaoHS.create({});
}

export function metaDoDia(cfg, hoje) {
  const dia = cfg?.sdr_inicio ? diasEntre(cfg.sdr_inicio, hoje) + 1 : 1;
  return VOLUME_SDR.find((v) => dia <= v.ate_dia).por_dia;
}

const diaUtilBrasilia = (ctx) => { const d = new Date(ctx.now().getTime() - 3 * 3600e3).getUTCDay(); return d >= 1 && d <= 5; };

async function remetente(ctx, cfg) {
  const u = (cfg.sdr_remetente_id && await getById(ctx, 'UsuarioPlataforma', cfg.sdr_remetente_id))
    || (await find(ctx, 'UsuarioPlataforma', { perfil: 'SUPERADMIN_HS' })).filter((x) => x.status !== 'INATIVO').sort((a, b) => String(a.data_criacao || '').localeCompare(String(b.data_criacao || '')))[0];
  return { id: u?.id || 'sdr', nome: u?.nome || 'Equipe Acorly', perfil: 'SUPERADMIN_HS', email: u?.email || 'sdr@acorly' };
}

async function enviosSdrHoje(ctx) {
  const hoje = ctx.now().toISOString().slice(0, 10);
  return (await find(ctx, 'EnvioComercial', { origem: 'SDR' })).filter((e) => (e.enviado_em || '').slice(0, 10) === hoje).length;
}

const ehLimite = (e) => /^Limite de \d+ e-mails/.test(e?.message || '');

/** Uma rodada (de hora em hora, em dia útil e horário comercial): follow-ups vencidos primeiro, depois contatos novos. */
export async function rodarSdr(ctx) {
  if (!ctx.email?.comercial) return { enviados: 0, motivo: 'e-mail não configurado' };
  const cfg = await configSdr(ctx);
  if (cfg.sdr_pausado) return { enviados: 0, motivo: 'pausado' };
  if (!diaUtilBrasilia(ctx)) return { enviados: 0, motivo: 'fim de semana' };
  const hoje = hojeBrasilia(ctx);
  if (!cfg.sdr_inicio) await ctx.db.ConfiguracaoHS.update(cfg.id, { sdr_inicio: hoje });
  let vagas = Math.min(POR_RODADA, metaDoDia(cfg.sdr_inicio ? cfg : { sdr_inicio: hoje }, hoje) - await enviosSdrHoje(ctx));
  const r = { followups: 0, novos: 0, retomados: 0, falhas: 0, enviados: 0 };
  if (vagas <= 0) return r;
  const ctxR = { ...ctx, user: await remetente(ctx, cfg) };
  const leads = await find(ctx, 'Lead', {});

  // "Agora não" de 60 dias atrás: volta para a cadência
  for (const l of leads.filter((x) => x.retomar_em && x.retomar_em <= hoje && !x.nao_receber_comercial && !x.email_invalido)) {
    Object.assign(l, await ctx.db.Lead.update(l.id, { retomar_em: null, respondeu_em: null, cadencia_inicio: hoje, cadencia_etapa: 0, proximo_followup: hoje, cadencia_fim: null, status: 'EM_CONTATO' }));
    r.retomados++;
  }

  const tentar = async (fn) => {
    try { await fn(); r.enviados++; vagas--; return true; } catch (e) {
      if (ehLimite(e)) { vagas = 0; return false; }
      if (e instanceof ValidationError) return null; // contato que não pode receber: segue para o próximo
      r.falhas++; vagas = 0; console.error('[sdr]', e.message); return false; // provedor com problema: tenta na próxima hora
    }
  };

  // 1) Follow-ups por e-mail de quem foi abordado pelo e-mail comercial e não respondeu
  const envios = await find(ctx, 'EnvioComercial', {});
  // Sem a caixa de entrada conectada não dá para saber quem respondeu: os follow-ups esperam
  const vencidos = !ctx.caixaEntrada ? [] : leads.filter((l) => l.origem === 'PROSPECCAO' && l.ultimo_email_em && emailValido(l.email || '') && !l.nao_receber_comercial && followupVencido(ctx, l))
    .sort((a, b) => String(a.proximo_followup).localeCompare(String(b.proximo_followup)));
  for (const l of vencidos) {
    if (vagas <= 0) break;
    const ultimo = envios.filter((e) => e.lead_id === l.id).sort((a, b) => String(b.enviado_em).localeCompare(String(a.enviado_em)))[0];
    const assunto = `Re: ${String(ultimo?.assunto || `${l.empresa}: valores em atraso`).replace(/^(re:\s*)+/i, '')}`.slice(0, 180);
    const corpo = `${textoFollowup(ctxR, l, Number(l.cadencia_etapa || 0))}\n${ASSINATURA}`;
    if (await tentar(() => enviarComercial(ctxR, { para: l.email, lead_id: l.id, assunto, corpo, origem: 'SDR' }))) r.followups++;
  }

  // 2) Contatos novos da busca diária (os mais antigos primeiro)
  if (vagas > 0) {
    const modelo = (await find(ctx, 'ModeloComercial', {})).filter((m) => m.ativo !== false).sort((a, b) => (a.ordem || 0) - (b.ordem || 0))[0];
    const fila = (await find(ctx, 'Prospect', { status: 'A_ABORDAR' })).filter((p) => emailValido(p.email || ''))
      .sort((a, b) => String(a.encontrado_em || a.lote || '').localeCompare(String(b.encontrado_em || b.lote || '')));
    for (const p of fila) {
      if (vagas <= 0) break;
      const email = p.email.toLowerCase();
      const ja = leads.filter((l) => (l.email || '').toLowerCase() === email);
      if (ja.some((l) => l.nao_receber_comercial || l.ultimo_email_em || l.email_invalido)) {
        await ctx.db.Prospect.update(p.id, { status: 'DESCARTADO', motivo_descarte: ja.some((l) => l.nao_receber_comercial) ? 'Pediu para não receber e-mails' : 'Já recebeu e-mail da Acorly', descartado_em: ctx.now().toISOString() });
        continue;
      }
      const personalizado = p.email_sugerido && p.email_assunto_sugerido;
      if (!personalizado && !modelo) continue;
      const ok = await tentar(() => enviarComercial(ctxR, {
        para: email, prospect_id: p.id, nome: p.contato_nome || '', empresa: p.empresa, whatsapp: p.whatsapp || p.telefone,
        segmento: p.segmento === 'CONTABILIDADE' ? 'SERVICOS' : p.segmento, cidade: p.cidade, origem: 'SDR',
        ...(personalizado ? { assunto: p.email_assunto_sugerido, corpo: p.email_sugerido } : { modelo_id: modelo.id }),
      }));
      if (ok) r.novos++;
      else if (ok === null) await ctx.db.Prospect.update(p.id, { status: 'DESCARTADO', motivo_descarte: 'Não pode receber e-mail comercial', descartado_em: ctx.now().toISOString() });
      else break;
    }
  }
  return r;
}

/** Tira do texto o histórico citado ("Em ... escreveu:", linhas com ">") e a assinatura do celular. */
export function textoDaResposta(t) {
  const linhas = String(t || '').replace(/\r/g, '').split('\n');
  const fim = linhas.findIndex((l) => /^\s*>/.test(l) || /^\s*(Em|On) .{5,200}(escreveu|wrote):?\s*$/i.test(l) || /^-{2,}\s*(Mensagem original|Original Message)/i.test(l) || /^\s*(De|From):\s.+@/i.test(l) || /^\s*Enviado do meu (iPhone|Android|celular)/i.test(l));
  return (fim >= 0 ? linhas.slice(0, fim) : linhas).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
}

/** Aplica as mensagens lidas da caixa de entrada: registra respostas, para a cadência, marca e-mails que voltaram. */
export async function processarRespostas(ctx, mensagens = []) {
  const r = { respostas: 0, automaticas: 0, devolvidas: 0, nao_quer: 0 };
  if (!mensagens.length) return r;
  const leads = (await find(ctx, 'Lead', {})).filter((l) => l.ultimo_email_em && l.email);
  const ja = new Set((await find(ctx, 'RespostaComercial', {})).map((x) => x.message_id).filter(Boolean));
  const agora = ctx.now().toISOString();
  for (const m of mensagens) {
    if (m.messageId && ja.has(m.messageId)) continue;
    if (m.devolvida) {
      const corpo = String(m.texto || '').toLowerCase();
      for (const l of leads.filter((x) => !x.email_invalido && corpo.includes(x.email.toLowerCase()))) {
        await ctx.db.Lead.update(l.id, { email_invalido: true, proximo_followup: null, cadencia_fim: 'E-mail não existe (voltou)' });
        l.email_invalido = true; r.devolvidas++;
      }
      continue;
    }
    const de = String(m.de || '').toLowerCase();
    let lead = leads.find((l) => l.email.toLowerCase() === de);
    if (!lead && de && !GRATUITOS.test(de)) lead = leads.filter((l) => dominio(l.email) === dominio(de)).sort((a, b) => String(b.ultimo_email_em).localeCompare(String(a.ultimo_email_em)))[0];
    if (!lead) continue; // não é resposta a um e-mail comercial
    const texto = textoDaResposta(m.texto);
    const base = { lead_id: lead.id, de, assunto: String(m.assunto || '').slice(0, 300), texto, recebida_em: m.data || agora, message_id: m.messageId || null };
    if (m.automatica) {
      await ctx.db.RespostaComercial.create({ ...base, classificacao: 'AUTOMATICA', resumo: 'Resposta automática (ausência ou recebimento)', classificada_em: agora, tratada_em: agora });
      r.automaticas++; continue;
    }
    const naoQuer = NAO_QUER.test(texto) && texto.length < 600;
    await ctx.db.RespostaComercial.create({ ...base, classificacao: naoQuer ? 'NAO_QUER' : 'PENDENTE', ...(naoQuer ? { resumo: 'Pediu para não receber mais e-mails', classificada_em: agora, tratada_em: agora } : {}) });
    const patch = { respondeu_em: agora, proximo_followup: null, cadencia_fim: 'Respondeu ao e-mail' };
    if (naoQuer) Object.assign(patch, { nao_receber_comercial: true, status: 'PERDIDO', cadencia_fim: 'Pediu para não receber' });
    Object.assign(lead, await ctx.db.Lead.update(lead.id, patch));
    if (naoQuer) { r.nao_quer++; continue; }
    r.respostas++;
    await notificar(ctx, null, { perfis: ['SUPERADMIN_HS'], tipo: 'LEAD', titulo: `📩 ${lead.empresa} respondeu`, mensagem: texto.slice(0, 180) || base.assunto, link: '/hs/leads' });
  }
  return r;
}

/** Lê a caixa de entrada (fora da transação) e aplica o resultado. `transacao` e `ctxDe` vêm do servidor. */
export async function sincronizarCaixa({ caixa, transacao, ctxDe }) {
  if (!caixa) return null;
  const cfg = await transacao((pos) => configSdr(ctxDe(pos)));
  try {
    const lido = await caixa.novas({ desdeUid: cfg.sdr_imap_uid, validade: cfg.sdr_imap_validade });
    return await transacao(async (pos) => {
      const ctx = ctxDe(pos);
      const r = await processarRespostas(ctx, lido.mensagens);
      await ctx.db.ConfiguracaoHS.update(cfg.id, { sdr_imap_uid: lido.ultimoUid, sdr_imap_validade: lido.validade, sdr_imap_erro: null, sdr_imap_lido_em: ctx.now().toISOString() });
      return r;
    });
  } catch (e) {
    const msg = /auth|login|credential|invalid/i.test(`${e.message} ${e.responseText || ''}`) ? 'Usuário ou senha do e-mail recusados (confira IMAP_USUARIO e IMAP_SENHA no Render)' : `Não foi possível ler a caixa de entrada: ${e.message}`;
    await transacao((pos) => ctxDe(pos).db.ConfiguracaoHS.update(cfg.id, { sdr_imap_erro: msg.slice(0, 300) })).catch(() => {});
    throw e;
  }
}

// ---------- Classificação (feita pela tarefa diária do Claude, pela API de integração) ----------

export const CLASSES = ['INTERESSADO', 'PERGUNTA', 'AGORA_NAO', 'NAO_QUER', 'OUTRO'];

/** Respostas ainda não classificadas, com o contexto do lead e do e-mail que ele recebeu. */
export async function respostasPendentes(ctx) {
  const pend = (await find(ctx, 'RespostaComercial', { classificacao: 'PENDENTE' })).sort((a, b) => String(a.recebida_em).localeCompare(String(b.recebida_em))).slice(0, 50);
  const envios = await find(ctx, 'EnvioComercial', {});
  const out = [];
  for (const x of pend) {
    const l = x.lead_id ? await getById(ctx, 'Lead', x.lead_id) : null;
    const ultimo = envios.filter((e) => e.lead_id === x.lead_id).sort((a, b) => String(b.enviado_em).localeCompare(String(a.enviado_em)))[0];
    out.push({ id: x.id, de: x.de, assunto: x.assunto, texto: x.texto, recebida_em: x.recebida_em, empresa: l?.empresa || '', segmento: l?.segmento || '', cidade: l?.cidade || '', contato: l?.decisor_nome || l?.nome || '', assunto_enviado: ultimo?.assunto || '' });
  }
  return out;
}

/** Aplica a classificação de cada resposta: interessado/pergunta avisam a equipe; agora não volta em 60 dias; não quer sai da lista. */
export async function classificarRespostas(ctx, itens = []) {
  exigirLista(itens);
  const r = { classificadas: 0, ignoradas: 0 };
  const agora = ctx.now().toISOString();
  for (const it of itens.slice(0, 100)) {
    const x = it?.id ? await getById(ctx, 'RespostaComercial', String(it.id)) : null;
    const classe = String(it?.classificacao || '').toUpperCase();
    if (!x || x.classificacao !== 'PENDENTE' || !CLASSES.includes(classe)) { r.ignoradas++; continue; }
    const resumo = String(it.resumo || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const sugerida = String(it.resposta_sugerida || '').replace(/\r/g, '').trim().slice(0, 3000);
    await ctx.db.RespostaComercial.update(x.id, { classificacao: classe, resumo, resposta_sugerida: sugerida || null, classificada_em: agora, ...(classe === 'NAO_QUER' || classe === 'OUTRO' ? { tratada_em: agora } : {}) });
    const l = x.lead_id ? await getById(ctx, 'Lead', x.lead_id) : null;
    if (l) {
      if (classe === 'NAO_QUER') await ctx.db.Lead.update(l.id, { nao_receber_comercial: true, status: 'PERDIDO', cadencia_fim: 'Pediu para não receber' });
      if (classe === 'AGORA_NAO') await ctx.db.Lead.update(l.id, { retomar_em: somaDias(hojeBrasilia(ctx), DIAS_RETOMAR), cadencia_fim: `Agora não: volta em ${DIAS_RETOMAR} dias` });
      if (classe === 'INTERESSADO' || classe === 'PERGUNTA') {
        await notificar(ctx, null, { perfis: ['SUPERADMIN_HS'], tipo: 'LEAD', titulo: `${classe === 'INTERESSADO' ? '🔥 Interessado' : '❓ Pergunta'}: ${l.empresa}`, mensagem: resumo || x.texto.slice(0, 180), link: '/hs/leads' });
      }
    }
    r.classificadas++;
  }
  return r;
}

function exigirLista(itens) {
  if (!Array.isArray(itens)) throw new ValidationError('Envie { "respostas": [ { id, classificacao, resumo, resposta_sugerida } ] }');
}

// ---------- Painel ----------

export async function painelSdr(ctx) {
  const cfg = await configSdr(ctx);
  const hoje = hojeBrasilia(ctx);
  const respostas = (await find(ctx, 'RespostaComercial', {})).filter((x) => x.classificacao !== 'AUTOMATICA').sort((a, b) => String(b.recebida_em).localeCompare(String(a.recebida_em))).slice(0, 40);
  const leads = new Map((await find(ctx, 'Lead', {})).map((l) => [l.id, l]));
  const prospects = await find(ctx, 'Prospect', { status: 'A_ABORDAR' });
  const leadsArr = [...leads.values()];
  return {
    ativo: !cfg.sdr_pausado, envio_configurado: !!ctx.email?.comercial, caixa_configurada: !!ctx.caixaEntrada, caixa_usuario: ctx.caixaEntrada?.usuario || null,
    caixa_erro: cfg.sdr_imap_erro || null, caixa_lida_em: cfg.sdr_imap_lido_em || null,
    meta_hoje: metaDoDia(cfg.sdr_inicio ? cfg : { sdr_inicio: hoje }, hoje), enviados_hoje: await enviosSdrHoje(ctx), limite_diario: LIMITE_DIARIO_COMERCIAL,
    na_fila: prospects.filter((p) => emailValido(p.email || '')).length, sem_email: prospects.filter((p) => !emailValido(p.email || '')).length,
    em_cadencia: leadsArr.filter((l) => l.origem === 'PROSPECCAO' && l.proximo_followup && !l.respondeu_em && !l.nao_receber_comercial).length,
    respostas: respostas.map((x) => ({ ...x, empresa: leads.get(x.lead_id)?.empresa || x.de, whatsapp: leads.get(x.lead_id)?.whatsapp || '' })),
  };
}

export const actions = {
  painelSdr: { perm: 'lead.gerenciar', run: (ctx) => painelSdr(ctx) },
  configurarSdr: {
    perm: 'lead.gerenciar',
    async run(ctx, { ativo }) {
      if (ctx.user.perfil !== 'SUPERADMIN_HS') throw new ValidationError('Só o administrador da Acorly pode ligar ou pausar o SDR automático.');
      const cfg = await configSdr(ctx);
      await ctx.db.ConfiguracaoHS.update(cfg.id, { sdr_pausado: !ativo, atualizado_por: ctx.user.email, atualizado_em: ctx.now().toISOString() });
      return painelSdr(ctx);
    },
  },
  tratarRespostaSdr: {
    perm: 'lead.gerenciar',
    async run(ctx, { id, tratada = true }) {
      const x = await getById(ctx, 'RespostaComercial', id);
      if (!x) throw new ValidationError('Resposta não encontrada');
      await ctx.db.RespostaComercial.update(x.id, { tratada_em: tratada ? ctx.now().toISOString() : null });
      return { ok: true };
    },
  },
};
