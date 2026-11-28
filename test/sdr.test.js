import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, envBanco } from './helpers.js';
import { criarApp } from '../src/server/app.js';
import { rodarSdr, processarRespostas, classificarRespostas, textoDaResposta, metaDoDia, sincronizarCaixa } from '../src/app/sdr.js';
import { lerMensagem } from '../src/server/caixaEntrada.js';

const S = 'super@hs.com';
async function base() {
  const t = app();
  await t.db.UsuarioPlataforma.create({ nome: 'Hugo Sousa', email: S, perfil: 'SUPERADMIN_HS', empresa_id: null, status: 'ATIVO' });
  t.enviados = [];
  t.estado.extras.email = { comercial: async (m) => { t.enviados.push(m); return { ok: true, id: `m${t.enviados.length}` }; } };
  t.estado.extras.descadastro = { linkComercial: (id) => `https://acorly.com.br/sair/${id}` };
  t.estado.extras.caixaEntrada = { usuario: 'contato@acorly.com.br' };
  await t.ok(S, 'listarModelosComerciais');
  return t;
}
const sys = (t) => ({ db: t.db, user: { id: 'sistema', perfil: 'SISTEMA', nome: 'Sistema' }, now: () => t.estado.agora, email: t.estado.extras.email, descadastro: t.estado.extras.descadastro, caixaEntrada: t.estado.extras.caixaEntrada });
const prospect = (t, i, x = {}) => t.db.Prospect.create({
  empresa: `Escola ${i}`, segmento: 'ESCOLA_CURSO', cidade: 'Salvador', email: `contato@escola${i}.com.br`, status: 'A_ABORDAR', origem: 'BUSCA_DIARIA',
  encontrado_em: `2026-11-10T0${i % 10}:00:00Z`, fonte_url: 'https://exemplo', email_assunto_sugerido: `Escola ${i}: mensalidades em atraso`,
  email_sugerido: `Olá! Vi que a Escola ${i} está com a rematrícula aberta.\n\n[[link:Calculadora|https://acorly.com.br/calculadora]]\nAbraço,\n**{{remetente}}**`, ...x,
});

test('SDR: envia sozinho o e-mail escrito para cada escola, 5 por hora, até a meta do dia (15 na 1ª semana)', async () => {
  const t = await base();
  for (let i = 0; i < 20; i++) await prospect(t, i);
  const r = await rodarSdr(sys(t));
  assert.equal(r.novos, 5);
  assert.equal(t.enviados[0].assunto, 'Escola 0: mensalidades em atraso');
  assert.match(t.enviados[0].html, /rematrícula/);
  assert.match(t.enviados[0].html, /Hugo Sousa/, 'assina o administrador da Acorly');
  assert.match(t.enviados[0].html, /sair\//, 'link para sair da lista');
  for (let h = 0; h < 5; h++) await rodarSdr(sys(t));
  assert.equal(t.enviados.length, 15, 'meta da primeira semana');
  assert.equal((await t.db.Prospect.filter({ status: 'ABORDADO' })).length, 15);
  const [lead] = await t.db.Lead.filter({ email: 'contato@escola0.com.br' });
  assert.equal(lead.origem, 'PROSPECCAO');
  assert.equal(lead.proximo_followup, '2026-11-14', 'cadência começa: follow-up no dia 3');
  assert.equal((await t.db.EnvioComercial.filter({ origem: 'SDR' })).length, 15);
  assert.equal(metaDoDia({ sdr_inicio: '2026-11-11' }, '2026-11-20'), 25);
  assert.equal(metaDoDia({ sdr_inicio: '2026-11-11' }, '2026-12-11'), 40);
  // fim de semana não envia; pausado não envia
  t.estado.agora = new Date('2026-11-14T14:00:00Z');
  assert.equal((await rodarSdr(sys(t))).motivo, 'fim de semana');
  t.estado.agora = new Date('2026-11-12T14:00:00Z');
  await t.ok(S, 'configurarSdr', { ativo: false });
  assert.equal((await rodarSdr(sys(t))).motivo, 'pausado');
  const p = await t.ok(S, 'configurarSdr', { ativo: true });
  assert.equal(p.ativo, true);
});

test('SDR: não manda de novo para quem já recebeu ou pediu para sair', async () => {
  const t = await base();
  await t.db.Lead.create({ nome: 'X', empresa: 'Saiu', email: 'contato@escola1.com.br', status: 'PERDIDO', nao_receber_comercial: true });
  await t.db.Lead.create({ nome: 'Y', empresa: 'Já', email: 'contato@escola2.com.br', status: 'EM_CONTATO', ultimo_email_em: '2026-11-01T12:00:00Z' });
  for (let i = 1; i <= 3; i++) await prospect(t, i);
  await rodarSdr(sys(t));
  assert.deepEqual(t.enviados.map((m) => m.para), ['contato@escola3.com.br']);
  assert.equal((await t.db.Prospect.filter({ status: 'DESCARTADO' })).length, 2);
});

test('SDR: follow-ups dos dias 3, 7 e 14 por e-mail, como resposta ao primeiro; para quando o contato responde', async () => {
  const t = await base();
  await prospect(t, 1); await prospect(t, 2);
  await rodarSdr(sys(t));
  t.estado.agora = new Date('2026-11-16T13:00:00Z'); // segunda, dia 5
  assert.equal((await rodarSdr({ ...sys(t), caixaEntrada: null })).followups, 0, 'sem a caixa de entrada conectada, os follow-ups esperam');
  const r = await rodarSdr(sys(t));
  assert.equal(r.followups, 2);
  const fu = t.enviados.at(-1);
  assert.equal(fu.assunto, 'Re: Escola 2: mensalidades em atraso');
  assert.match(fu.texto, /Conseguiu ver a minha mensagem/);
  let [l1] = await t.db.Lead.filter({ email: 'contato@escola1.com.br' });
  assert.equal(l1.cadencia_etapa, 1);
  // a Escola 1 responde: o SDR para de insistir com ela
  const proc = await processarRespostas(sys(t), [{ de: 'contato@escola1.com.br', assunto: 'Re: Escola 1', texto: 'Oi Hugo, quero saber mais. Podemos falar?\n\nEm qua., 11 de nov. de 2026 Hugo escreveu:\n> Olá!', data: '2026-11-16T15:00:00Z', messageId: '<a1@x>' }]);
  assert.equal(proc.respostas, 1);
  [l1] = await t.db.Lead.filter({ email: 'contato@escola1.com.br' });
  assert.ok(l1.respondeu_em);
  assert.equal(l1.proximo_followup, null);
  const [resp] = await t.db.RespostaComercial.filter({});
  assert.equal(resp.texto, 'Oi Hugo, quero saber mais. Podemos falar?', 'sem o histórico citado');
  assert.equal(resp.classificacao, 'PENDENTE');
  assert.ok((await t.db.Notificacao.filter({})).some((n) => /Escola 1 respondeu/.test(n.titulo)));
  t.estado.agora = new Date('2026-11-18T13:00:00Z'); // dia 7
  const antes = t.enviados.length;
  await rodarSdr(sys(t));
  assert.deepEqual(t.enviados.slice(antes).map((m) => m.para), ['contato@escola2.com.br'], 'só quem não respondeu recebe o follow-up');
  // mesma mensagem lida de novo não duplica
  await processarRespostas(sys(t), [{ de: 'contato@escola1.com.br', texto: 'Oi', messageId: '<a1@x>' }]);
  assert.equal((await t.db.RespostaComercial.filter({})).length, 1);
});

test('caixa de entrada: resposta automática não para a cadência; e-mail que voltou é marcado; "não tenho interesse" sai da lista; outro endereço do mesmo domínio conta', async () => {
  const t = await base();
  for (let i = 1; i <= 4; i++) await prospect(t, i);
  await rodarSdr(sys(t));
  const r = await processarRespostas(sys(t), [
    { de: 'contato@escola1.com.br', assunto: 'Resposta automática: férias', texto: 'Estou de férias', automatica: true, messageId: '<1>' },
    { de: 'mailer-daemon@hostinger.com', assunto: 'Undelivered Mail', texto: 'Falha ao entregar para contato@escola2.com.br: user unknown', devolvida: true, messageId: '<2>' },
    { de: 'contato@escola3.com.br', texto: 'Não temos interesse, por favor remova nosso e-mail.', messageId: '<3>' },
    { de: 'diretoria@escola4.com.br', texto: 'Qual o valor da comissão?', messageId: '<4>' },
    { de: 'alguem@gmail.com', texto: 'spam qualquer', messageId: '<5>' },
  ]);
  assert.deepEqual(r, { respostas: 1, automaticas: 1, devolvidas: 1, nao_quer: 1 });
  const lead = async (i) => (await t.db.Lead.filter({ email: `contato@escola${i}.com.br` }))[0];
  assert.ok((await lead(1)).proximo_followup, 'resposta automática não para');
  assert.equal((await lead(2)).email_invalido, true);
  assert.equal((await lead(2)).proximo_followup, null);
  assert.equal((await lead(3)).nao_receber_comercial, true);
  assert.equal((await lead(3)).status, 'PERDIDO');
  assert.ok((await lead(4)).respondeu_em, 'resposta de outro e-mail da mesma escola');
});

test('classificação pelo robô: interessado avisa, agora não volta em 60 dias, não quer sai da lista', async () => {
  const t = await base();
  for (let i = 1; i <= 3; i++) await prospect(t, i);
  await rodarSdr(sys(t));
  await processarRespostas(sys(t), [1, 2, 3].map((i) => ({ de: `contato@escola${i}.com.br`, texto: `resposta ${i}`, messageId: `<r${i}>` })));
  const { respostasPendentes } = await import('../src/app/sdr.js');
  const pend = await respostasPendentes(sys(t));
  assert.equal(pend.length, 3);
  assert.equal(pend[0].assunto_enviado, 'Escola 1: mensalidades em atraso');
  const id = (i) => pend.find((p) => p.de === `contato@escola${i}.com.br`).id;
  const r = await classificarRespostas(sys(t), [
    { id: id(1), classificacao: 'INTERESSADO', resumo: 'Quer conversar esta semana', resposta_sugerida: 'Ótimo! Que tal quinta às 10h?' },
    { id: id(2), classificacao: 'AGORA_NAO', resumo: 'Só em fevereiro' },
    { id: id(3), classificacao: 'NAO_QUER', resumo: 'Sem interesse' },
    { id: 'nao-existe', classificacao: 'INTERESSADO' },
  ]);
  assert.deepEqual(r, { classificadas: 3, ignoradas: 1 });
  assert.ok((await t.db.Notificacao.filter({})).some((n) => n.titulo === '🔥 Interessado: Escola 1'));
  const [l2] = await t.db.Lead.filter({ email: 'contato@escola2.com.br' });
  assert.equal(l2.retomar_em, '2027-01-10');
  const [l3] = await t.db.Lead.filter({ email: 'contato@escola3.com.br' });
  assert.equal(l3.nao_receber_comercial, true);
  const painel = await t.ok(S, 'painelSdr');
  assert.equal(painel.respostas.length, 3);
  assert.equal(painel.respostas.find((x) => x.empresa === 'Escola 1').resposta_sugerida, 'Ótimo! Que tal quinta às 10h?');
  // 60 dias depois a Escola 2 volta para a cadência
  t.estado.agora = new Date('2027-01-11T13:00:00Z');
  const antes = t.enviados.length;
  const s = await rodarSdr(sys(t));
  assert.equal(s.retomados, 1);
  assert.deepEqual(t.enviados.slice(antes).map((m) => m.para), ['contato@escola2.com.br']);
});

test('leitura do e-mail bruto: resposta automática, devolução e histórico citado', async () => {
  const auto = await lerMensagem(Buffer.from('From: Escola <contato@escola.com.br>\r\nSubject: Resposta automática\r\nAuto-Submitted: auto-replied\r\nMessage-ID: <x@y>\r\n\r\nEstou fora.\r\n'));
  assert.equal(auto.automatica, true);
  assert.equal(auto.de, 'contato@escola.com.br');
  const volta = await lerMensagem(Buffer.from('From: Mail Delivery System <MAILER-DAEMON@mx.hostinger.com>\r\nSubject: Undelivered Mail Returned to Sender\r\n\r\n<contato@x.com.br>: user unknown\r\n'));
  assert.equal(volta.devolvida, true);
  const normal = await lerMensagem(Buffer.from('From: Ana <ana@escola.com.br>\r\nSubject: Re: oi\r\n\r\nTenho interesse!\r\n'));
  assert.deepEqual([normal.automatica, normal.devolvida, normal.texto.trim()], [false, false, 'Tenho interesse!']);
  assert.equal(textoDaResposta('Pode ser.\n\nOn Mon, Nov 16, 2026 at 10:00 Hugo wrote:\n> antigo'), 'Pode ser.');
  assert.equal(textoDaResposta('Sim\nEnviado do meu iPhone'), 'Sim');
});

test('sincronização da caixa guarda onde parou e registra erro de senha', async () => {
  const t = await base();
  await prospect(t, 1);
  await rodarSdr(sys(t));
  const chamadas = [];
  const caixa = { novas: async (x) => { chamadas.push(x); return { validade: '7', ultimoUid: 42, mensagens: [{ de: 'contato@escola1.com.br', texto: 'Quero', messageId: '<z>' }] }; } };
  const ctxDe = () => sys(t);
  const transacao = (fn) => fn([]);
  assert.equal((await sincronizarCaixa({ caixa, transacao, ctxDe })).respostas, 1);
  await sincronizarCaixa({ caixa, transacao, ctxDe });
  assert.deepEqual(chamadas[1], { desdeUid: 42, validade: '7' });
  const ruim = { novas: async () => { throw new Error('Authentication failed'); } };
  await assert.rejects(sincronizarCaixa({ caixa: ruim, transacao, ctxDe }));
  assert.match((await t.ok(S, 'painelSdr')).caixa_erro, /senha/);
});

test('robô classifica as respostas pela integração com token', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hs-sdr-'));
  const token = 'tk_' + 'y'.repeat(30);
  const a = criarApp({ dataDir: dir, webDir: join(dir, 'web'), env: { ...envBanco(), LEADS_API_TOKEN: token }, caixaEntrada: null });
  await new Promise((ok) => a.server.listen(0, ok));
  const b = `http://127.0.0.1:${a.server.address().port}/api/integracao/respostas`;
  try {
    assert.equal((await fetch(b)).status, 401);
    const lead = await a.exclusivo(() => a.db.Lead.create({ nome: 'Ana', empresa: 'Escola Z', email: 'ana@z.com.br', status: 'EM_CONTATO', ultimo_email_em: '2026-11-10T12:00:00Z' }));
    const resp = await a.exclusivo(() => a.db.RespostaComercial.create({ lead_id: lead.id, de: 'ana@z.com.br', texto: 'Quanto custa?', recebida_em: '2026-11-11T12:00:00Z', classificacao: 'PENDENTE' }));
    const g = await (await fetch(b, { headers: { Authorization: `Bearer ${token}` } })).json();
    assert.equal(g.data.respostas[0].empresa, 'Escola Z');
    const p = await fetch(b, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ respostas: [{ id: resp.id, classificacao: 'PERGUNTA', resumo: 'Quer saber o preço', resposta_sugerida: 'Olá, Ana! ...' }] }) });
    assert.equal((await p.json()).data.classificadas, 1);
    assert.equal((await a.exclusivo(() => a.db.RespostaComercial.filter({ classificacao: 'PERGUNTA' }))).length, 1);
  } finally {
    a.server.close(); await a.banco.fechar(); rmSync(dir, { recursive: true, force: true });
  }
});
