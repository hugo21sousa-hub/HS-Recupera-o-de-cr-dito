// Estatísticas de visitas do site, sem cookies e sem identificar ninguém.
// Cada visitante é um código anônimo que muda todo dia (hash de IP + navegador + dia + segredo do servidor):
// dá para contar pessoas por dia sem guardar IP nem rastrear entre dias.
// Eventos brutos do dia ficam em VisitaSite; dias anteriores são resumidos em VisitaDia e os brutos apagados.
import { find } from './context.js';

export const EVENTOS_VISITA = ['VISITA', 'DIAGNOSTICO', 'CADASTRO', 'WHATSAPP', 'DEMONSTRACAO'];
export const CONVERSOES = ['DIAGNOSTICO', 'CADASTRO', 'WHATSAPP', 'DEMONSTRACAO'];
const PAGINAS = { '/': 'Página inicial', '/diagnostico': 'Diagnóstico gratuito', '/cadastro': 'Criar conta', '/entrar': 'Entrar', '/termos': 'Termos de uso', '/privacidade': 'Privacidade', '/demonstracao': 'Demonstração' };

export const diaBrasilia = (d) => new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 10);

const ROBOS = /bot|crawl|spider|slurp|preview|facebookexternalhit|facebookcatalog|whatsapp\/|telegrambot|headless|lighthouse|pingdom|uptime|monitor|curl\/|wget|python|node-fetch|axios|go-http|java\/|okhttp|render\/|cron-job|scrapy|semrush|ahrefs/i;
export const ehRobo = (ua) => !ua || ua.length < 15 || ROBOS.test(ua);

export function dispositivo(ua) {
  return /iPhone|Android.+Mobile|Mobile Safari|Windows Phone|Instagram|FBAN|FBAV/i.test(ua || '') ? 'CELULAR' : 'COMPUTADOR';
}

const NOMES_ORIGEM = { ig: 'instagram', insta: 'instagram', instagram: 'instagram', fb: 'facebook', facebook: 'facebook', linkedin: 'linkedin', li: 'linkedin', google: 'google', wa: 'whatsapp', whatsapp: 'whatsapp', zap: 'whatsapp', email: 'email', 'e-mail': 'email', mail: 'email', youtube: 'youtube', tiktok: 'tiktok' };

/** De onde veio: etiqueta utm_source > aplicativo (navegador do Instagram, Facebook, LinkedIn) > site de origem > direto. */
export function classificarOrigem({ utm_source, referrer, ua, hostProprio = '' } = {}) {
  const utm = String(utm_source || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 30);
  if (utm) return NOMES_ORIGEM[utm] || utm;
  if (/Instagram/i.test(ua || '')) return 'instagram';
  if (/FBAN|FBAV|FB_IAB/i.test(ua || '')) return 'facebook';
  if (/LinkedInApp/i.test(ua || '')) return 'linkedin';
  let host = '';
  try { host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, ''); } catch { host = ''; }
  if (!host) return 'direto';
  if ((hostProprio && host === hostProprio.replace(/^www\./, '')) || /(^|\.)acorly\.com\.br$|onrender\.com$/.test(host)) return 'interno';
  if (/instagram\.com$/.test(host)) return 'instagram';
  if (/(facebook\.com|fb\.me|fb\.com)$/.test(host)) return 'facebook';
  if (/(linkedin\.com|lnkd\.in)$/.test(host)) return 'linkedin';
  if (/(^|\.)google\./.test(host)) return 'google';
  if (/bing\.com$/.test(host)) return 'bing';
  if (/(whatsapp\.com|wa\.me)$/.test(host)) return 'whatsapp';
  if (/(t\.co|x\.com|twitter\.com)$/.test(host)) return 'x';
  if (/(mail\.|outlook\.|hostinger)/.test(host)) return 'email';
  return host.slice(0, 40);
}

const limpar = (v, n) => String(v ?? '').trim().slice(0, n);

/** Registra um evento (contexto de sistema). Conversões herdam a origem da primeira visita do mesmo visitante no dia. */
export async function registrarEvento(ctx, { visitante, evento = 'VISITA', pagina = '/', origem = 'direto', utm_source, utm_medium, utm_campaign, dispositivo: disp = 'COMPUTADOR' }) {
  if (!EVENTOS_VISITA.includes(evento)) return null;
  const dia = diaBrasilia(ctx.now());
  let o = origem;
  if (o === 'interno' || (CONVERSOES.includes(evento) && o === 'direto')) {
    const primeira = (await find(ctx, 'VisitaSite', { dia, visitante })).filter((x) => x.origem && x.origem !== 'interno').sort((a, b) => (a.em > b.em ? 1 : -1))[0];
    o = primeira?.origem || (o === 'interno' ? 'direto' : o);
  }
  return ctx.db.VisitaSite.create({
    dia, em: ctx.now().toISOString(), visitante: limpar(visitante, 32), evento, pagina: limpar(pagina, 60) || '/', origem: limpar(o, 40),
    utm_source: limpar(utm_source, 40), utm_medium: limpar(utm_medium, 40), utm_campaign: limpar(utm_campaign, 60), dispositivo: disp === 'CELULAR' ? 'CELULAR' : 'COMPUTADOR',
  });
}

/** Resume os eventos brutos de um dia. */
export function resumirDia(dia, eventos) {
  const r = { dia, visitantes: 0, visualizacoes: 0, conversoes: Object.fromEntries(CONVERSOES.map((c) => [c, 0])), por_origem: {}, por_pagina: {}, por_campanha: {}, por_dispositivo: { CELULAR: 0, COMPUTADOR: 0 } };
  const pessoas = new Map(); // visitante → origem da primeira visita
  const ordem = (e) => `${e.em || ''}|${e.evento === 'VISITA' ? 0 : 1}`;
  for (const e of [...eventos].sort((a, b) => (ordem(a) > ordem(b) ? 1 : ordem(a) < ordem(b) ? -1 : 0))) {
    const p = pessoas.get(e.visitante);
    if (!p) pessoas.set(e.visitante, { origem: e.origem || 'direto', campanha: e.utm_campaign || '', disp: e.dispositivo });
    else if (!p.campanha && e.utm_campaign) p.campanha = e.utm_campaign;
  }
  r.visitantes = pessoas.size;
  for (const p of pessoas.values()) {
    const o = (r.por_origem[p.origem] ??= { visitantes: 0, visualizacoes: 0, ...Object.fromEntries(CONVERSOES.map((c) => [c, 0])) });
    o.visitantes++;
    r.por_dispositivo[p.disp === 'CELULAR' ? 'CELULAR' : 'COMPUTADOR']++;
    if (p.campanha) (r.por_campanha[p.campanha] ??= { visitantes: 0, conversoes: 0 }).visitantes++;
  }
  const convertidos = new Map(); // conta cada tipo de conversão uma vez por pessoa
  for (const e of eventos) {
    const p = pessoas.get(e.visitante) || { origem: e.origem || 'direto' };
    const o = (r.por_origem[p.origem] ??= { visitantes: 0, visualizacoes: 0, ...Object.fromEntries(CONVERSOES.map((c) => [c, 0])) });
    if (e.evento === 'VISITA') {
      r.visualizacoes++; o.visualizacoes++;
      r.por_pagina[e.pagina] = (r.por_pagina[e.pagina] || 0) + 1;
      continue;
    }
    const k = `${e.visitante}|${e.evento}`;
    if (convertidos.has(k)) continue;
    convertidos.set(k, true);
    r.conversoes[e.evento]++; o[e.evento]++;
    if (p.campanha && r.por_campanha[p.campanha]) r.por_campanha[p.campanha].conversoes++;
  }
  return r;
}

/** Resume os dias anteriores a hoje em VisitaDia e apaga os eventos brutos; apaga resumos com mais de 13 meses. */
export async function compactarVisitas(ctx) {
  const hoje = diaBrasilia(ctx.now());
  const brutos = (await find(ctx, 'VisitaSite', {})).filter((e) => e.dia < hoje);
  const porDia = new Map();
  for (const e of brutos) (porDia.get(e.dia) || porDia.set(e.dia, []).get(e.dia)).push(e);
  for (const [dia, eventos] of porDia) {
    const r = resumirDia(dia, eventos);
    const existente = (await find(ctx, 'VisitaDia', { dia }))[0];
    if (existente) await ctx.db.VisitaDia.update(existente.id, somarResumos([existente, r], dia));
    else await ctx.db.VisitaDia.create(r);
    for (const e of eventos) await ctx.db.VisitaSite.delete(e.id);
  }
  const limite = diaBrasilia(new Date(ctx.now().getTime() - 400 * 864e5));
  for (const d of await find(ctx, 'VisitaDia', {})) if (d.dia < limite) await ctx.db.VisitaDia.delete(d.id);
  return { dias_resumidos: porDia.size, eventos: brutos.length };
}

function somar(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = typeof v === 'number' ? (out[k] || 0) + v : somar(out[k], v);
  return out;
}

export function somarResumos(resumos, dia = null) {
  let t = { visitantes: 0, visualizacoes: 0, conversoes: {}, por_origem: {}, por_pagina: {}, por_campanha: {}, por_dispositivo: {} };
  for (const r of resumos) {
    t = {
      visitantes: t.visitantes + (r.visitantes || 0), visualizacoes: t.visualizacoes + (r.visualizacoes || 0),
      conversoes: somar(t.conversoes, r.conversoes), por_origem: somar(t.por_origem, r.por_origem), por_pagina: somar(t.por_pagina, r.por_pagina),
      por_campanha: somar(t.por_campanha, r.por_campanha), por_dispositivo: somar(t.por_dispositivo, r.por_dispositivo),
    };
  }
  return dia ? { dia, ...t } : t;
}

const somaDias = (iso, d) => new Date(Date.parse(`${iso}T12:00:00Z`) + d * 864e5).toISOString().slice(0, 10);

export const actions = {
  /** Painel de visitas do site: período em dias (7, 30, 90 ou 365). */
  visitasSite: {
    perm: 'plano.gerenciar',
    async run(ctx, { dias = 30 } = {}) {
      await compactarVisitas(ctx);
      const n = [7, 30, 90, 365].includes(Number(dias)) ? Number(dias) : 30;
      const hoje = diaBrasilia(ctx.now());
      const inicio = somaDias(hoje, -(n - 1));
      const resumos = (await find(ctx, 'VisitaDia', {})).filter((d) => d.dia >= inicio && d.dia < hoje);
      const hojeResumo = resumirDia(hoje, await find(ctx, 'VisitaSite', { dia: hoje }));
      const porDia = new Map([...resumos, hojeResumo].map((d) => [d.dia, d]));
      const serie = [];
      for (let i = 0; i < n; i++) {
        const dia = somaDias(inicio, i);
        const d = porDia.get(dia);
        serie.push({ dia, visitantes: d?.visitantes || 0, visualizacoes: d?.visualizacoes || 0, conversoes: d ? Object.values(d.conversoes || {}).reduce((a, b) => a + b, 0) : 0 });
      }
      const total = somarResumos([...resumos, hojeResumo]);
      // período anterior, para comparação
      const antIni = somaDias(inicio, -n);
      const todosDias = await find(ctx, 'VisitaDia', {});
      const anterior = somarResumos(todosDias.filter((d) => d.dia >= antIni && d.dia < inicio));
      const anteriorCompleto = todosDias.some((d) => d.dia <= antIni); // só compara quando já havia contagem em todo o período anterior
      const conv = Object.values(total.conversoes || {}).reduce((a, b) => a + b, 0);
      const ordenar = (obj, chave) => Object.entries(obj || {}).map(([k, v]) => ({ chave: k, ...(typeof v === 'number' ? { valor: v } : v) })).sort((a, b) => (b[chave] || 0) - (a[chave] || 0));
      return {
        dias: n, inicio, fim: hoje, serie,
        visitantes: total.visitantes, visualizacoes: total.visualizacoes, visitantes_anterior: anteriorCompleto ? anterior.visitantes : null,
        conversoes: { ...Object.fromEntries(CONVERSOES.map((c) => [c, 0])), ...total.conversoes }, total_conversoes: conv,
        taxa_conversao_bps: total.visitantes ? Math.round((conv / total.visitantes) * 10000) : 0,
        por_origem: ordenar(total.por_origem, 'visitantes').map((o) => ({ ...o, conversoes: CONVERSOES.reduce((a, c) => a + (o[c] || 0), 0) })),
        por_pagina: ordenar(total.por_pagina, 'valor').map((p) => ({ ...p, rotulo: PAGINAS[p.chave] || p.chave })),
        por_campanha: ordenar(total.por_campanha, 'visitantes').slice(0, 20),
        por_dispositivo: { CELULAR: 0, COMPUTADOR: 0, ...total.por_dispositivo },
      };
    },
  },
};
