// Lista do dia (prospecção ativa): empresas com contato público encontradas pela busca diária.
// Contatos não abordados ficam na lista; ao abordar (e-mail, WhatsApp ou ligação) saem da lista e viram lead.
import { emailValido, somenteDigitos } from '../../core/documento.js';
import { AccessError, getById, find, criar, alterar, exigir, notificar } from '../context.js';
import { iniciarCadencia } from './acompanhamento.js';
import { epocaDoMes, rankSegmento, mesBrasilia } from '../comercial/epoca.js';

export const SEGMENTOS_PROSPECT = ['ESCOLA_CURSO', 'SAUDE', 'ACADEMIA', 'CONDOMINIO', 'VAREJO', 'DISTRIBUIDORA', 'SERVICOS', 'IMOBILIARIA', 'CONTABILIDADE', 'OUTRO'];
const SEGMENTO_TEXTO = { ESCOLA_CURSO: 'escolas e cursos', SAUDE: 'clínicas e consultórios', ACADEMIA: 'academias', CONDOMINIO: 'condomínios', VAREJO: 'lojas', DISTRIBUIDORA: 'distribuidoras', SERVICOS: 'empresas de serviços', IMOBILIARIA: 'imobiliárias', CONTABILIDADE: 'escritórios de contabilidade', OUTRO: 'empresas' };
const MAX_POR_ENVIO = 200;

const dominio = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const fone = (v) => { const d = somenteDigitos(v); return d.length >= 10 && d.length <= 13 ? d : ''; };

function normalizar(p) {
  const t = (v, max) => String(v ?? '').trim().slice(0, max);
  const site = t(p.site, 300);
  return {
    empresa: t(p.empresa, 160), segmento: SEGMENTOS_PROSPECT.includes(p.segmento) ? p.segmento : 'OUTRO', cidade: t(p.cidade, 80), bairro: t(p.bairro, 80),
    site: /^https:\/\//.test(site) ? site : '', email: t(p.email, 160).toLowerCase(), telefone: fone(p.telefone), whatsapp: fone(p.whatsapp),
    fonte_url: t(p.fonte_url, 500), observacao: t(p.observacao, 500), contato_nome: t(p.contato_nome, 120), contato_cargo: t(p.contato_cargo, 80),
  };
}

/** Chaves para não repetir empresas já conhecidas (e-mail, telefones e domínio do site). */
function chaves(x) {
  const c = [];
  if (x.email) c.push(`e:${x.email}`);
  for (const f of [x.telefone, x.whatsapp]) if (f) c.push(`t:${f.slice(-10)}`);
  const d = dominio(x.site || '');
  if (d) c.push(`d:${d}`);
  if (x.email && !/@(gmail|hotmail|outlook|yahoo|live|bol|uol|icloud)\./.test(x.email)) c.push(`d:${x.email.split('@')[1]}`);
  return c;
}

/** Importa contatos encontrados (usado pela busca diária). Ignora inválidos e repetidos. */
export async function importarProspects(ctx, lista, { origem = 'BUSCA_DIARIA' } = {}) {
  exigir(Array.isArray(lista), 'Envie uma lista de contatos');
  exigir(lista.length <= MAX_POR_ENVIO, `Máximo de ${MAX_POR_ENVIO} contatos por envio`);
  const conhecidos = new Set();
  for (const x of [...await find(ctx, 'Prospect', {}), ...await find(ctx, 'Lead', {})]) for (const k of chaves(x)) conhecidos.add(k);
  const hoje = ctx.now().toISOString().slice(0, 10);
  let criados = 0, duplicados = 0;
  const invalidos = [];
  for (const bruto of lista) {
    const p = normalizar(bruto || {});
    const problemas = [];
    if (p.empresa.length < 2) problemas.push('empresa');
    if (p.email && !emailValido(p.email)) problemas.push('e-mail');
    if (!p.email && !p.telefone && !p.whatsapp) problemas.push('sem e-mail nem telefone');
    if (!/^https:\/\/\S{6,}$/.test(p.fonte_url)) problemas.push('fonte (link https de onde o contato foi encontrado)');
    if (problemas.length) { invalidos.push({ empresa: p.empresa || '?', problemas }); continue; }
    const ks = chaves(p);
    if (ks.some((k) => conhecidos.has(k))) { duplicados++; continue; }
    ks.forEach((k) => conhecidos.add(k));
    await ctx.db.Prospect.create({ ...p, status: 'A_ABORDAR', lote: hoje, encontrado_em: ctx.now().toISOString(), origem });
    criados++;
  }
  if (criados) {
    const pendentes = (await find(ctx, 'Prospect', { status: 'A_ABORDAR' })).length;
    await notificar(ctx, null, { perfis: ['SUPERADMIN_HS'], tipo: 'LEAD', titulo: `Lista do dia: ${criados} novo(s) contato(s) para abordar`, mensagem: `${pendentes} contato(s) aguardando abordagem.`, link: '/hs/leads' });
  }
  return { criados, duplicados, invalidos };
}

/** Abordagem registrada: o contato sai da lista e vira (ou atualiza) um lead. */
export async function marcarAbordado(ctx, prospect, { canal, observacao = '', lead_id = null }) {
  const agora = ctx.now().toISOString();
  let lead = lead_id ? await getById(ctx, 'Lead', lead_id) : null;
  if (!lead && prospect.email) lead = (await find(ctx, 'Lead', { email: prospect.email }))[0] || null;
  const nota = `${agora.slice(0, 10)}: abordado por ${canal === 'EMAIL' ? 'e-mail' : canal === 'WHATSAPP' ? 'WhatsApp' : 'telefone'}${observacao ? ` — ${observacao}` : ''}. Fonte: ${prospect.fonte_url}`;
  if (!lead) {
    lead = await criar(ctx, 'Lead', {
      nome: prospect.contato_nome || prospect.empresa, empresa: prospect.empresa, email: prospect.email || '', whatsapp: prospect.whatsapp || prospect.telefone,
      cidade: [prospect.bairro, prospect.cidade].filter(Boolean).join(' · '), segmento: prospect.segmento === 'CONTABILIDADE' ? 'SERVICOS' : prospect.segmento,
      status: 'EM_CONTATO', origem: 'PROSPECCAO', recebido_em: agora, observacoes: nota, responsavel_id: ctx.user.id,
      decisor_nome: prospect.contato_nome || '', decisor_cargo: prospect.contato_cargo || '',
    }, 'CRIAR_LEAD_PROSPECCAO');
  } else {
    await alterar(ctx, 'Lead', lead, { observacoes: `${lead.observacoes ? `${lead.observacoes}\n` : ''}${nota}`, status: lead.status === 'NOVO' ? 'EM_CONTATO' : lead.status }, 'ATUALIZAR_LEAD');
  }
  lead = await iniciarCadencia(ctx, lead);
  await alterar(ctx, 'Prospect', prospect, { status: 'ABORDADO', abordado_em: agora, abordado_por: ctx.user.id, canal, lead_id: lead.id }, 'ABORDAR_PROSPECT');
  return lead;
}

function textoWhatsApp(ctx, p) {
  const ola = p.contato_nome ? `Olá, ${p.contato_nome.split(' ')[0]}!` : 'Olá!';
  const treze = epocaDoMes(mesBrasilia(ctx)).decimo_terceiro ? ' Este é o melhor momento do ano para isso: com o 13º, muitos devedores querem quitar as contas antes do ano novo.' : '';
  if (p.segmento === 'CONTABILIDADE') return `${ola} Tudo bem? Sou ${ctx.user.nome || 'da equipe Acorly'}, da HS Recuperação de Crédito. Gostaria de propor uma parceria com o escritório: muitos dos seus clientes têm valores em atraso, e nós recuperamos de forma organizada e respeitosa, com o pagamento direto na conta deles. O escritório recebe uma comissão por cada cliente indicado que fechar conosco. Posso te explicar em 10 minutos?`;
  return `${ola} Tudo bem? Sou ${ctx.user.nome || 'da equipe Acorly'}, da HS Recuperação de Crédito. Ajudamos ${SEGMENTO_TEXTO[p.segmento] || 'empresas'} a recuperar valores em atraso de forma organizada e respeitosa, com o pagamento direto na conta da empresa.${treze} Posso fazer um diagnóstico gratuito da inadimplência da ${p.empresa}? Só com valor e vencimento de cada atraso, sem nome nem CPF: acorly.com.br/diagnostico. Se fizer sentido, você testa por 30 dias com até 20 devedores e só paga 10% do que entrar nesse período.`;
}

export const actions = {
  listarProspects: {
    perm: 'lead.gerenciar',
    async run(ctx, { segmento, status, busca, filtros = {}, page = 1, pageSize = 500 } = {}) {
      const st = status || filtros.status || 'A_ABORDAR';
      const seg = segmento || filtros.segmento;
      let rows = await find(ctx, 'Prospect', { status: st });
      if (seg) rows = rows.filter((p) => p.segmento === seg);
      if (busca) {
        const n = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const q = n(busca);
        rows = rows.filter((p) => n(`${p.empresa} ${p.cidade} ${p.bairro} ${p.email} ${p.telefone}`).includes(q));
      }
      const mes = mesBrasilia(ctx);
      rows.sort((a, b) => ((a.lote || '') !== (b.lote || '') ? ((a.lote || '') < (b.lote || '') ? 1 : -1) : rankSegmento(a.segmento, mes) - rankSegmento(b.segmento, mes) || (a.empresa > b.empresa ? 1 : -1)));
      const epoca = epocaDoMes(mes);
      rows = rows.map((p) => ({ ...p, prioridade: epoca.segmentos.includes(p.segmento) }));
      const hoje = ctx.now().toISOString().slice(0, 10);
      const tam = Math.min(500, Math.max(1, Number(pageSize) || 500));
      const ini = (Math.max(1, Number(page) || 1) - 1) * tam;
      return { itens: rows.slice(ini, ini + tam), total: rows.length, novos_hoje: rows.filter((p) => p.lote === hoje).length, epoca };
    },
  },

  /** WhatsApp com mensagem pronta para o contato (abre o WhatsApp; a abordagem é registrada à parte). */
  whatsappProspect: {
    perm: 'lead.gerenciar',
    async run(ctx, { id }) {
      const p = await getById(ctx, 'Prospect', id);
      if (!p) throw new AccessError('Contato não encontrado', 404);
      const n = p.whatsapp || p.telefone;
      exigir(n, 'Este contato não tem telefone');
      const numero = n.length <= 11 ? `55${n}` : n;
      return { link: `https://wa.me/${numero}?text=${encodeURIComponent(textoWhatsApp(ctx, p))}`, mensagem: textoWhatsApp(ctx, p) };
    },
  },

  registrarAbordagemProspect: {
    perm: 'lead.gerenciar',
    async run(ctx, { id, canal, observacao }) {
      exigir(['WHATSAPP', 'TELEFONE', 'EMAIL'].includes(canal), 'Canal inválido');
      const p = await getById(ctx, 'Prospect', id);
      if (!p) throw new AccessError('Contato não encontrado', 404);
      exigir(p.status === 'A_ABORDAR', 'Este contato já saiu da lista');
      const lead = await marcarAbordado(ctx, p, { canal, observacao: String(observacao || '').slice(0, 500) });
      return { lead_id: lead.id };
    },
  },

  descartarProspect: {
    perm: 'lead.gerenciar',
    async run(ctx, { id, motivo }) {
      const p = await getById(ctx, 'Prospect', id);
      if (!p) throw new AccessError('Contato não encontrado', 404);
      exigir(p.status === 'A_ABORDAR', 'Este contato já saiu da lista');
      return alterar(ctx, 'Prospect', p, { status: 'DESCARTADO', motivo_descarte: String(motivo || '').slice(0, 300), descartado_em: ctx.now().toISOString() }, 'DESCARTAR_PROSPECT');
    },
  },

  /** Inclusão manual de contatos (mesmas regras da busca diária). */
  adicionarProspects: {
    perm: 'lead.gerenciar',
    async run(ctx, { contatos }) { return importarProspects(ctx, contatos, { origem: 'MANUAL' }); },
  },
};
