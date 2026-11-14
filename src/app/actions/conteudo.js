// Central de conteúdo: posts sugeridos para LinkedIn e Instagram a cada 2 dias (não publica nada).
// Superadmin revisa e aprova; o Marketing baixa, posta manualmente e marca como publicado.
import { BANCO_POSTS } from '../conteudo/banco.js';
import { AccessError, getById, find, criar, alterar, exigir, notificar, requirePerm } from '../context.js';

export const REDES = ['LINKEDIN', 'INSTAGRAM'];
export const STATUS_POST = ['SUGERIDO', 'APROVADO', 'PUBLICADO', 'DESCARTADO'];
export const CAMPOS_REDES = ['instagram', 'linkedin', 'facebook', 'youtube', 'tiktok'];
// Perfis oficiais (usados enquanto o superadmin não cadastrar outro endereço)
export const REDES_PADRAO = {
  instagram: 'https://www.instagram.com/acorly.app/',
  linkedin: 'https://www.linkedin.com/search/results/companies/?keywords=Acorly%20Recupera%C3%A7%C3%A3o%20de%20Cr%C3%A9dito',
};
const INTERVALO_DIAS = 2;
const HORIZONTE_DIAS = 14;
const somaDias = (iso, d) => new Date(Date.parse(iso + 'T12:00:00Z') + d * 864e5).toISOString().slice(0, 10);

async function configuracao(ctx) {
  const cfg = (await find(ctx, 'ConfiguracaoHS', {}))[0];
  return cfg || ctx.db.ConfiguracaoHS.create({});
}

function postDoBanco(item, rede, data) {
  const p = rede === 'LINKEDIN' ? item.linkedin : item.instagram;
  return {
    rede, data_prevista: data, tema: item.tema, titulo: p.titulo || item.tema, formato: p.formato || 'Imagem + texto',
    texto: p.texto || p.legenda, roteiro: p.roteiro || '', hashtags: p.hashtags || [], arte: p.arte || null, status: 'SUGERIDO', origem: 'BANCO',
  };
}

/**
 * Garante posts sugeridos para os próximos 14 dias, um tema a cada 2 dias (LinkedIn + Instagram),
 * seguindo o banco de posts. Avisa o superadmin quando o banco está acabando.
 */
export async function garantirAgenda(ctx) {
  const cfg = await configuracao(ctx);
  const hoje = ctx.now().toISOString().slice(0, 10);
  const inicio = cfg.conteudo_inicio || hoje;
  let proximo = Number(cfg.conteudo_proximo || 0);
  const existentes = new Set((await find(ctx, 'PostSocial', { origem: 'BANCO' })).map((p) => p.data_prevista));
  let criados = 0;
  const passos = Math.max(0, Math.ceil((Date.parse(hoje) - Date.parse(inicio)) / 864e5 / INTERVALO_DIAS));
  for (let k = passos; ; k++) {
    const data = somaDias(inicio, k * INTERVALO_DIAS);
    if (data > somaDias(hoje, HORIZONTE_DIAS)) break;
    if (existentes.has(data)) continue;
    if (proximo >= BANCO_POSTS.length) break;
    for (const rede of REDES) await ctx.db.PostSocial.create(postDoBanco(BANCO_POSTS[proximo], rede, data));
    proximo++; criados++;
  }
  const patch = {};
  if (!cfg.conteudo_inicio) patch.conteudo_inicio = inicio;
  if (proximo !== Number(cfg.conteudo_proximo || 0)) patch.conteudo_proximo = proximo;
  const restantes = BANCO_POSTS.length - proximo;
  if (restantes <= 2 && !cfg.conteudo_aviso_fim) {
    await notificar(ctx, null, { perfis: ['SUPERADMIN_HS'], tipo: 'CONTEUDO', titulo: 'O banco de posts está acabando', mensagem: `Restam ${restantes} tema(s) para a agenda automática. Cadastre novos posts em Conteúdo ou peça novos temas.`, link: '/hs/conteudo' });
    patch.conteudo_aviso_fim = true;
  }
  if (Object.keys(patch).length) await ctx.db.ConfiguracaoHS.update(cfg.id, patch);
  return { criados, restantes };
}

export const actions = {
  listarPosts: {
    perm: 'conteudo.ler',
    async run(ctx, { status, rede, ver = 'proximos' } = {}) {
      await garantirAgenda(ctx);
      const hoje = ctx.now().toISOString().slice(0, 10);
      let rows = await find(ctx, 'PostSocial', {});
      if (status) rows = rows.filter((p) => p.status === status);
      if (rede) rows = rows.filter((p) => p.rede === rede);
      if (ver === 'proximos') rows = rows.filter((p) => p.data_prevista >= somaDias(hoje, -2) && p.status !== 'DESCARTADO');
      if (ver === 'historico') rows = rows.filter((p) => p.data_prevista < somaDias(hoje, -2) || ['PUBLICADO', 'DESCARTADO'].includes(p.status));
      rows.sort((a, b) => (a.data_prevista === b.data_prevista ? (a.rede > b.rede ? 1 : -1) : (a.data_prevista > b.data_prevista ? 1 : -1) * (ver === 'historico' ? -1 : 1)));
      const cfg = await configuracao(ctx);
      return { itens: rows.slice(0, 200), restantes_no_banco: BANCO_POSTS.length - Number(cfg.conteudo_proximo || 0), redes: { ...REDES_PADRAO, ...(cfg.redes_sociais || {}) } };
    },
  },

  /** Cria ou edita um post (texto, roteiro, arte, data). */
  salvarPost: {
    perm: 'conteudo.gerenciar',
    async run(ctx, input) {
      exigir(REDES.includes(input.rede), 'Rede inválida');
      exigir(/^\d{4}-\d{2}-\d{2}$/.test(input.data_prevista || ''), 'Data inválida');
      exigir(String(input.texto || '').trim(), 'Escreva o texto do post');
      const dados = {
        rede: input.rede, data_prevista: input.data_prevista, tema: String(input.tema || '').slice(0, 120), titulo: String(input.titulo || input.tema || '').slice(0, 160),
        formato: String(input.formato || '').slice(0, 80), texto: String(input.texto).slice(0, 3000), roteiro: String(input.roteiro || '').slice(0, 3000),
        hashtags: (Array.isArray(input.hashtags) ? input.hashtags : String(input.hashtags || '').split(/[\s,]+/)).map((h) => h.trim()).filter(Boolean).map((h) => (h.startsWith('#') ? h : `#${h}`)).slice(0, 30),
        arte: input.arte || null,
      };
      if (input.id) {
        const p = await getById(ctx, 'PostSocial', input.id);
        if (!p) throw new AccessError('Post não encontrado', 404);
        exigir(p.status !== 'PUBLICADO', 'Post já publicado não pode ser alterado');
        return alterar(ctx, 'PostSocial', p, dados, 'EDITAR_POST');
      }
      return criar(ctx, 'PostSocial', { ...dados, status: 'SUGERIDO', origem: 'MANUAL' }, 'CRIAR_POST');
    },
  },

  /** Aprova e envia ao Marketing (aviso no sistema e por e-mail). */
  aprovarPost: {
    perm: 'conteudo.gerenciar',
    async run(ctx, { id, observacao }) {
      const p = await getById(ctx, 'PostSocial', id);
      if (!p) throw new AccessError('Post não encontrado', 404);
      exigir(['SUGERIDO', 'APROVADO'].includes(p.status), 'Este post não pode mais ser aprovado');
      const r = await alterar(ctx, 'PostSocial', p, { status: 'APROVADO', aprovado_por: ctx.user.id, aprovado_em: ctx.now().toISOString(), observacao_aprovacao: String(observacao || '').slice(0, 1000) }, 'APROVAR_POST');
      const rede = p.rede === 'LINKEDIN' ? 'LinkedIn' : 'Instagram';
      await notificar(ctx, null, { perfis: ['MARKETING_HS'], tipo: 'CONTEUDO', titulo: `Post aprovado para o ${rede}: ${p.data_prevista.split('-').reverse().join('/')}`, mensagem: `${p.titulo}${observacao ? `\nObservação: ${observacao}` : ''}\nBaixe a arte e o texto em Conteúdo e publique na data prevista.`, link: '/hs/conteudo' });
      return r;
    },
  },

  /** Marketing (ou superadmin) informa que publicou, com o link do post. */
  marcarPostPublicado: {
    perm: 'conteudo.publicar',
    async run(ctx, { id, link }) {
      const p = await getById(ctx, 'PostSocial', id);
      if (!p) throw new AccessError('Post não encontrado', 404);
      exigir(p.status === 'APROVADO', 'Só posts aprovados podem ser marcados como publicados');
      const url = String(link || '').trim();
      exigir(!url || /^https:\/\/\S{4,500}$/.test(url), 'O link precisa começar com https://');
      return alterar(ctx, 'PostSocial', p, { status: 'PUBLICADO', publicado_em: ctx.now().toISOString(), publicado_por: ctx.user.id, link_publicacao: url || null }, 'PUBLICAR_POST');
    },
  },

  descartarPost: {
    perm: 'conteudo.gerenciar',
    async run(ctx, { id, motivo }) {
      const p = await getById(ctx, 'PostSocial', id);
      if (!p) throw new AccessError('Post não encontrado', 404);
      exigir(p.status !== 'PUBLICADO', 'Post já publicado');
      return alterar(ctx, 'PostSocial', p, { status: 'DESCARTADO', motivo_descarte: String(motivo || '').slice(0, 500) }, 'DESCARTAR_POST');
    },
  },

  /** Links das redes sociais da empresa (aparecem no site). */
  salvarRedesSociais: {
    perm: 'config.sistema',
    async run(ctx, input) {
      const redes = {};
      for (const k of CAMPOS_REDES) {
        const v = String(input[k] || '').trim();
        if (!v) continue;
        exigir(/^https:\/\/[^\s]{4,300}$/.test(v), `Link do ${k} inválido: use o endereço completo começando com https://`);
        redes[k] = v;
      }
      const cfg = await configuracao(ctx);
      await ctx.db.ConfiguracaoHS.update(cfg.id, { redes_sociais: redes, atualizado_por: ctx.user.id, atualizado_em: ctx.now().toISOString() });
      return redes;
    },
  },
};

export async function redesSociaisPublicas(ctx) {
  const cfg = (await find(ctx, 'ConfiguracaoHS', {}))[0];
  return { ...REDES_PADRAO, ...(cfg?.redes_sociais || {}) };
}

export { requirePerm };
