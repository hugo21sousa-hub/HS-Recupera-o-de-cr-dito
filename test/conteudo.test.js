import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from './helpers.js';
import { BANCO_POSTS } from '../src/app/conteudo/banco.js';
import { redesSociaisPublicas } from '../src/app/actions/conteudo.js';

async function base() {
  const t = app();
  await t.db.UsuarioPlataforma.create({ nome: 'Super', email: 'super@hs.com', perfil: 'SUPERADMIN_HS', empresa_id: null, status: 'ATIVO' });
  await t.ok('super@hs.com', 'convidarUsuario', { nome: 'Mari Marketing', email: 'mkt@hs.com', perfil: 'MARKETING_HS' });
  return t;
}

test('banco de posts: textos completos, sem termos ofensivos nem promessa de resultado', () => {
  assert.ok(BANCO_POSTS.length >= 15);
  for (const b of BANCO_POSTS) {
    for (const p of [b.linkedin, b.instagram]) {
      assert.ok((p.texto || p.legenda).length > 40, b.tema);
      assert.ok(p.roteiro && p.hashtags.length && p.arte, b.tema);
      // posts educativos citam o que é proibido; só não podem ter termos ofensivos nem prometer resultado garantido
      assert.doesNotMatch(`${p.texto || p.legenda}`, /caloteir|vagabund|ladr[aã]o|garantimos a recupera|recupera[cç][aã]o garantida/i, b.tema);
    }
    assert.ok(b.instagram.arte.slides.length >= 1);
  }
});

test('agenda: um par de posts (LinkedIn + Instagram) a cada 2 dias, sem duplicar', async () => {
  const t = await base();
  const banco = (x) => ({ ...x, itens: x.itens.filter((p) => p.origem === 'BANCO') });
  const r = banco(await t.ok('super@hs.com', 'listarPosts', {}));
  const datas = [...new Set(r.itens.map((p) => p.data_prevista))];
  assert.deepEqual(datas, ['2026-11-11', '2026-11-13', '2026-11-15', '2026-11-17', '2026-11-19', '2026-11-21', '2026-11-23', '2026-11-25']);
  assert.equal(r.itens.length, 16);
  assert.deepEqual(r.itens.slice(0, 2).map((p) => p.rede).sort(), ['INSTAGRAM', 'LINKEDIN']);
  assert.equal(r.itens[0].tema, BANCO_POSTS[0].tema);
  assert.equal(banco(await t.ok('super@hs.com', 'listarPosts', {})).itens.length, 16, 'não duplica');
  t.estado.agora = new Date('2026-11-20T14:00:00Z');
  const depois = await t.ok('super@hs.com', 'listarPosts', {});
  // a campanha da calculadora começa em 30/11: o banco pausa perto das datas dela (29/11, 01/12, 03/12)
  assert.equal(banco(depois).itens.at(-1).data_prevista, '2026-11-27');
  assert.equal(depois.restantes_no_banco, BANCO_POSTS.length - 9);
});

test('fluxo: superadmin aprova e avisa o marketing; marketing publica; perfis respeitados', async () => {
  const t = await base();
  const { itens } = await t.ok('super@hs.com', 'listarPosts', {});
  const post = itens[0];
  await t.falha('mkt@hs.com', 'aprovarPost', { id: post.id }, 403);
  await t.falha('mkt@hs.com', 'marcarPostPublicado', { id: post.id }, 422);
  await t.ok('super@hs.com', 'aprovarPost', { id: post.id, observacao: 'Publicar às 9h' });
  const mkt = (await t.db.UsuarioPlataforma.filter({ email: 'mkt@hs.com' }))[0];
  const aviso = (await t.db.Notificacao.filter({ usuario_id: mkt.id })).find((n) => n.tipo === 'CONTEUDO');
  assert.match(aviso.titulo, /Post aprovado para o (LinkedIn|Instagram): 11\/11\/2026/);
  assert.match(aviso.mensagem, /Publicar às 9h/);
  assert.match((await t.falha('mkt@hs.com', 'marcarPostPublicado', { id: post.id, link: 'instagram.com/p/x' }, 422)).error, /https/);
  const pub = await t.ok('mkt@hs.com', 'marcarPostPublicado', { id: post.id, link: 'https://www.instagram.com/p/abc' });
  assert.equal(pub.status, 'PUBLICADO');
  await t.falha('super@hs.com', 'salvarPost', { id: post.id, rede: post.rede, data_prevista: post.data_prevista, texto: 'novo' }, 422);
  const novo = await t.ok('super@hs.com', 'salvarPost', { rede: 'LINKEDIN', data_prevista: '2026-11-30', tema: 'Case', texto: 'Texto do case', hashtags: 'acorly cobranca' });
  assert.deepEqual(novo.hashtags, ['#acorly', '#cobranca']);
  await t.ok('super@hs.com', 'descartarPost', { id: novo.id, motivo: 'Repetido' });
  // marketing não acessa o resto do sistema
  await t.falha('mkt@hs.com', 'listarEmpresas', {}, 403);
  await t.falha('mkt@hs.com', 'listarCasos', {}, 403);
});

test('redes sociais: perfis oficiais por padrão; superadmin troca os links, que aparecem no site', async () => {
  const t = await base();
  assert.equal((await redesSociaisPublicas({ db: t.db })).instagram, 'https://www.instagram.com/acorly.app/');
  assert.match((await t.falha('super@hs.com', 'salvarRedesSociais', { instagram: 'instagram.com/acorly' }, 422)).error, /https/);
  await t.ok('super@hs.com', 'salvarRedesSociais', { instagram: 'https://www.instagram.com/acorly', linkedin: 'https://www.linkedin.com/company/acorly', facebook: '' });
  assert.deepEqual(await redesSociaisPublicas({ db: t.db }), { instagram: 'https://www.instagram.com/acorly', linkedin: 'https://www.linkedin.com/company/acorly' });
  await t.falha('mkt@hs.com', 'salvarRedesSociais', { instagram: 'https://x.com' }, 403);
});

test('campanha da calculadora: 12 temas (LinkedIn + Instagram) com datas fixas, links rastreáveis e sem duplicar', async () => {
  const { CAMPANHA_CALCULADORA } = await import('../src/app/conteudo/campanhas.js');
  assert.equal(CAMPANHA_CALCULADORA.length, 12);
  for (const c of CAMPANHA_CALCULADORA) {
    for (const p of [c.linkedin, c.instagram]) {
      assert.ok((p.texto || p.legenda).length > 40 && p.roteiro && p.hashtags.length && p.arte, c.tema);
      assert.doesNotMatch(`${p.texto || p.legenda} ${p.roteiro}`, /caloteir|garantimos|recupera[cç][aã]o garantida|advogad|OAB/i, c.tema);
    }
    assert.match(c.linkedin.roteiro, /utm_source=linkedin/, c.tema);
    assert.match(c.instagram.roteiro, /utm_source=instagram/, c.tema);
  }
  const t = await base();
  await t.ok('super@hs.com', 'listarPosts', {});
  await t.ok('super@hs.com', 'listarPosts', {});
  const camp = (await t.db.PostSocial.filter({ origem: 'CAMPANHA' }));
  assert.equal(camp.length, 24, 'um post por rede, sem duplicar');
  assert.ok(camp.every((p) => p.status === 'SUGERIDO'));
});
