import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, envBanco } from './helpers.js';
import { criarApp } from '../src/server/app.js';
import { classificarOrigem, ehRobo, registrarEvento, compactarVisitas } from '../src/app/visitas.js';

const S = 'super@hs.com';
const IG = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Instagram 350.0.0';
const PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';

test('origem: etiqueta utm, navegador do Instagram, site de origem, interno e direto; robôs ignorados', () => {
  assert.equal(classificarOrigem({ utm_source: 'IG' }), 'instagram');
  assert.equal(classificarOrigem({ ua: IG }), 'instagram');
  assert.equal(classificarOrigem({ referrer: 'https://www.google.com.br/' , ua: PC }), 'google');
  assert.equal(classificarOrigem({ referrer: 'https://lnkd.in/abc', ua: PC }), 'linkedin');
  assert.equal(classificarOrigem({ referrer: 'https://acorly.com.br/diagnostico', ua: PC }), 'interno');
  assert.equal(classificarOrigem({ referrer: '', ua: PC }), 'direto');
  assert.equal(ehRobo('facebookexternalhit/1.1'), true);
  assert.equal(ehRobo('WhatsApp/2.24.1 A'), true);
  assert.equal(ehRobo(PC), false);
});

test('painel: pessoas por dia, origem, conversões atribuídas à origem da visita; dias antigos viram resumo', async () => {
  const t = app();
  await t.db.UsuarioPlataforma.create({ nome: 'Hugo', email: S, perfil: 'SUPERADMIN_HS', empresa_id: null, status: 'ATIVO' });
  const sys = { db: t.db, user: { id: 'sistema' }, now: () => t.estado.agora };
  // ontem
  t.estado.agora = new Date('2026-11-10T15:00:00Z');
  await registrarEvento(sys, { visitante: 'a', pagina: '/', origem: 'instagram', utm_campaign: 'bio', dispositivo: 'CELULAR' });
  await registrarEvento(sys, { visitante: 'a', pagina: '/diagnostico', origem: 'interno', dispositivo: 'CELULAR' });
  await registrarEvento(sys, { visitante: 'a', evento: 'DIAGNOSTICO', pagina: '/diagnostico', origem: 'interno' });
  await registrarEvento(sys, { visitante: 'a', evento: 'DIAGNOSTICO', pagina: '/diagnostico', origem: 'interno' });
  await registrarEvento(sys, { visitante: 'b', pagina: '/', origem: 'google' });
  // hoje
  t.estado.agora = new Date('2026-11-11T14:00:00Z');
  await registrarEvento(sys, { visitante: 'c', pagina: '/', origem: 'direto' });
  await registrarEvento(sys, { visitante: 'c', evento: 'WHATSAPP', pagina: '/', origem: 'direto' });
  const v = await t.ok(S, 'visitasSite', { dias: 7 });
  assert.equal(v.visitantes, 3);
  assert.equal(v.visualizacoes, 4);
  assert.deepEqual([v.conversoes.DIAGNOSTICO, v.conversoes.WHATSAPP, v.total_conversoes], [1, 1, 2], 'cada pessoa conta uma vez por tipo');
  const ig = v.por_origem.find((o) => o.chave === 'instagram');
  assert.deepEqual([ig.visitantes, ig.DIAGNOSTICO, ig.conversoes], [1, 1, 1], 'diagnóstico atribuído ao Instagram');
  assert.equal(v.por_campanha[0].chave, 'bio');
  assert.equal(v.serie.length, 7);
  assert.deepEqual(v.serie.slice(-2).map((d) => d.visitantes), [2, 1]);
  assert.equal(v.taxa_conversao_bps, 6667);
  // ontem já foi resumido e os eventos brutos apagados
  assert.equal((await t.db.VisitaDia.filter({})).length, 1);
  assert.equal((await t.db.VisitaSite.filter({ dia: '2026-11-10' })).length, 0);
  assert.equal((await compactarVisitas(sys)).eventos, 0);
  await t.db.UsuarioPlataforma.create({ nome: 'Gil', email: 'gestor@hs.com', perfil: 'GESTOR_OPERACOES_HS', empresa_id: null, status: 'ATIVO' });
  await t.falha('gestor@hs.com', 'visitasSite', {}, 403);
});

test('rota pública conta visitas sem cookie, ignora robôs e limita abusos', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hs-vis-'));
  const a = criarApp({ dataDir: dir, webDir: join(dir, 'web'), env: { ...envBanco(), SEGREDO: 'x'.repeat(40) } });
  await new Promise((ok) => a.server.listen(0, ok));
  const url = `http://127.0.0.1:${a.server.address().port}/api/publico/visita`;
  const enviar = (ua, corpo) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HS': '1', 'User-Agent': ua }, body: JSON.stringify(corpo) });
  try {
    const r = await enviar(IG, { pagina: '/', referrer: '' });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('set-cookie'), null);
    await enviar(PC, { pagina: '/diagnostico?x=1', referrer: 'https://www.google.com/' });
    await enviar('facebookexternalhit/1.1', { pagina: '/' });
    await enviar(PC, { evento: 'HACK', pagina: '/' });
    const ev = await a.exclusivo(() => a.db.VisitaSite.filter({}));
    assert.equal(ev.length, 3, 'robô ignorado; evento desconhecido vira visita');
    assert.deepEqual(ev.map((e) => e.origem).sort(), ['direto', 'google', 'instagram']);
    assert.ok(ev.every((e) => e.visitante.length === 20 && !JSON.stringify(e).includes('127.0.0.1')), 'não guarda IP');
    assert.ok(ev.some((e) => e.pagina === '/diagnostico'));
  } finally {
    a.server.close(); await a.banco.fechar(); rmSync(dir, { recursive: true, force: true });
  }
});
