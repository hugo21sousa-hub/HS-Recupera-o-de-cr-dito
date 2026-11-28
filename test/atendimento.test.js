import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from './helpers.js';
import { processarAtendimentos, prepararTurno, receberMensagemCliente, MAX_RESPOSTAS_IA, PROMPT_ATENDIMENTO } from '../src/app/atendimento.js';
import { processarWebhookWhatsApp } from '../src/app/actions/whatsapp.js';
import { criarIA, MODELO_IA } from '../src/server/ia.js';

const S = 'super@hs.com';
const TEL = '5571988887777';
const Q = (x = {}) => ({ nome: '', cargo: '', empresa: '', segmento: '', cidade: '', email: '', clientes_em_atraso: '', valor_em_atraso: '', tempo_atraso: '', interesse: '', ...x });
const D = (x = {}) => ({ resposta: 'Olá! Sou o assistente virtual da Acorly.', chamar_equipe: false, motivo: '', encerrar: false, resumo: '', qualificacao: Q(), ...x, qualificacao: Q(x.qualificacao) });

async function base() {
  const t = app();
  await t.db.UsuarioPlataforma.create({ nome: 'Hugo Sousa', email: S, perfil: 'SUPERADMIN_HS', empresa_id: null, status: 'ATIVO' });
  t.decisoes = [];
  t.pedidos = [];
  t.ia = { responder: async (p) => { t.pedidos.push(p); const d = t.decisoes.shift(); if (d instanceof Error) throw d; return d ?? D(); } };
  t.enviadas = [];
  t.whats = { disponivel: true, enviarTexto: async (para, texto) => { t.enviadas.push({ para, texto }); return `wamid.${t.enviadas.length}`; } };
  t.estado.extras.ia = t.ia;
  t.estado.extras.whatsapp = t.whats;
  t.sys = () => ({ db: t.db, user: { id: 'sistema', perfil: 'SISTEMA', nome: 'Sistema' }, now: () => t.estado.agora, ia: t.ia, whatsapp: t.whats });
  t.rodar = (x = {}) => processarAtendimentos({ transacao: (fn) => fn([]), ctxDe: () => t.sys(), ia: t.ia, whatsapp: t.whats, ...x });
  t.recebe = (texto, tel = TEL, nome = 'Ana') => receberMensagemCliente(t.sys(), { telefone: tel, texto, nome, quando: t.estado.agora.toISOString() });
  t.passa = (min) => { t.estado.agora = new Date(t.estado.agora.getTime() + min * 60e3); };
  return t;
}

test('IA responde quem chama, junta mensagens seguidas, qualifica e cria o contato', async () => {
  const t = await base();
  await t.recebe('Olá! Vim pelo site da Acorly e gostaria de saber mais.');
  t.passa(0.1);
  await t.recebe('Tenho uma escola');
  t.decisoes.push(D({ resposta: 'Que bom! Qual o nome da escola e a cidade?', resumo: 'Escola interessada', qualificacao: { segmento: 'ESCOLA_CURSO' } }));
  assert.equal((await t.rodar()).respondidas, 1);
  assert.equal(t.enviadas[0].para, TEL);
  assert.match(t.enviadas[0].texto, /nome da escola/);
  const p = t.pedidos[0];
  assert.equal(p.sistema, PROMPT_ATENDIMENTO, 'prompt fixo (cache)');
  assert.deepEqual(p.mensagens.map((m) => m.role), ['user', 'system'], 'mensagens seguidas do cliente viram uma só; horário vai numa mensagem de sistema no fim');
  assert.match(p.mensagens[0].content, /Vim pelo site[\s\S]*Tenho uma escola/);
  assert.match(p.mensagens[1].content, /horário de Brasília/);
  assert.equal((await t.rodar()).respondidas, 0, 'nada pendente');
  t.passa(1);
  await t.recebe('Colégio Sol, em Feira de Santana. Uns 40 alunos atrasados, uns R$ 60 mil, ana@colegiosol.com.br');
  t.decisoes.push(D({ resposta: 'Obrigado, Ana! Há quanto tempo, em média?', resumo: 'Colégio Sol, 40 em atraso, R$ 60 mil', qualificacao: { nome: 'Ana', empresa: 'Colégio Sol', cidade: 'Feira de Santana/BA', clientes_em_atraso: 'uns 40', valor_em_atraso: 'R$ 60 mil', email: 'ana@colegiosol.com.br', interesse: 'ALTO' } }));
  await t.rodar();
  assert.deepEqual(t.pedidos[1].mensagens.map((m) => m.role), ['user', 'assistant', 'user', 'system']);
  const [lead] = await t.db.Lead.filter({ origem: 'WHATSAPP_IA' });
  assert.deepEqual([lead.empresa, lead.whatsapp, lead.email, lead.segmento, lead.qtd_devedores, lead.valor_aberto_centavos, lead.status], ['Colégio Sol', TEL, 'ana@colegiosol.com.br', 'ESCOLA_CURSO', 40, 6000000, 'NOVO']);
  const [c] = await t.db.ConversaWhatsApp.filter({});
  assert.equal(c.lead_id, lead.id);
  assert.equal(c.respostas_ia, 2);
});

test('IA passa para a equipe: para de responder, avisa, e a equipe responde pela tela dentro das 24 h', async () => {
  const t = await base();
  await t.recebe('Quero começar o piloto, como faço?');
  t.decisoes.push(D({ resposta: 'Ótimo! Vou chamar o Hugo, ele continua com você por aqui.', chamar_equipe: true, motivo: 'Quer começar o piloto', qualificacao: { empresa: 'Clínica Vida' } }));
  await t.rodar();
  let [c] = await t.db.ConversaWhatsApp.filter({});
  assert.equal(c.status, 'HUMANO');
  assert.ok((await t.db.Notificacao.filter({})).some((n) => /Clínica Vida quer falar com você/.test(n.titulo) && /piloto/.test(n.mensagem)));
  await t.recebe('Oi?');
  assert.equal((await t.rodar()).respondidas, 0, 'a IA não responde mais');
  const lista = await t.ok(S, 'listarConversasWhatsApp', {});
  assert.equal(lista.totais.HUMANO, 1);
  assert.equal(lista.itens[0].nao_lida, true);
  const aberta = await t.ok(S, 'abrirConversaWhatsApp', { id: c.id });
  assert.deepEqual(aberta.mensagens.map((m) => m.de), ['CLIENTE', 'IA', 'CLIENTE']);
  await t.ok(S, 'responderConversaWhatsApp', { id: c.id, texto: 'Oi! Aqui é o Hugo. Vamos marcar 15 minutos?' });
  assert.equal(t.enviadas.at(-1).texto, 'Oi! Aqui é o Hugo. Vamos marcar 15 minutos?');
  [c] = await t.db.ConversaWhatsApp.filter({});
  assert.equal(c.status, 'HUMANO');
  // depois de 24 h sem o cliente escrever, a Meta só aceita mensagem-modelo (paga)
  t.passa(25 * 60);
  const e = await t.falha(S, 'responderConversaWhatsApp', { id: c.id, texto: 'Oi de novo' }, 422);
  assert.match(e.error, /24 horas/);
  // devolver para a IA: ela volta a responder quando o cliente escrever
  await t.ok(S, 'alterarConversaWhatsApp', { id: c.id, acao: 'devolver' });
  await t.recebe('Voltei');
  assert.equal((await t.rodar()).respondidas, 1);
});

test('encerra quando a pessoa pede para parar; limite de respostas por conversa e por dia; falha da IA passa para a equipe', async () => {
  const t = await base();
  await t.recebe('Parar');
  assert.equal((await t.db.ConversaWhatsApp.filter({}))[0].status, 'ENCERRADA');
  assert.equal((await t.rodar()).respondidas, 0);
  // limite por conversa
  const outro = '5511900001111';
  for (let i = 0; i < MAX_RESPOSTAS_IA; i++) { await t.recebe(`pergunta ${i}`, outro); t.passa(1); await t.rodar(); }
  const c2 = (await t.db.ConversaWhatsApp.filter({ telefone: outro }))[0];
  assert.equal(c2.status, 'HUMANO');
  assert.match(t.enviadas.at(-1).texto, /Vou chamar o Hugo/);
  // limite diário
  await t.recebe('olá', '5511900002222');
  assert.equal((await t.rodar({ limiteDiario: 1 })).passadas, 1);
  assert.equal((await t.db.ConversaWhatsApp.filter({ telefone: '5511900002222' }))[0].motivo_humano, 'Limite diário de respostas da IA atingido');
  // IA fora do ar: tenta 3 vezes, depois passa para a equipe
  await t.recebe('olá', '5511900003333');
  t.decisoes.push(new Error('timeout'), new Error('timeout'), new Error('timeout'));
  for (let i = 0; i < 3; i++) await t.rodar();
  const c4 = (await t.db.ConversaWhatsApp.filter({ telefone: '5511900003333' }))[0];
  assert.equal(c4.status, 'HUMANO');
  // a pessoa diz que não tem interesse
  await t.recebe('Não tenho interesse, obrigado', '5511900004444');
  t.decisoes.push(D({ resposta: 'Tudo bem, obrigado pelo retorno!', encerrar: true }));
  await t.rodar();
  assert.equal((await t.db.ConversaWhatsApp.filter({ telefone: '5511900004444' }))[0].status, 'ENCERRADA');
});

test('webhook: devedor continua no caso de cobrança; quem não é devedor vai para o atendimento', async () => {
  const t = await base();
  await t.db.Devedor.create({ nome: 'Fulano', whatsapp: '71999990000', empresa_id: 'e1', documento: '1' });
  const payload = (de, texto, id) => ({ entry: [{ changes: [{ value: { contacts: [{ wa_id: de, profile: { name: 'Perfil X' } }], messages: [{ id, from: de, timestamp: '1794416400', type: 'text', text: { body: texto } }] } }] }] });
  const r1 = await processarWebhookWhatsApp(t.sys(), payload('5571999990000', 'Quero negociar', 'w1'));
  assert.equal(r1.triagem, 1, 'número de devedor: não vai para a IA');
  const r2 = await processarWebhookWhatsApp(t.sys(), payload('5571988887777', 'Vim pelo site', 'w2'));
  assert.equal(r2.atendimento, 1);
  const [c] = await t.db.ConversaWhatsApp.filter({});
  assert.deepEqual([c.telefone, c.nome_perfil, c.pendente_ia], ['5571988887777', 'Perfil X', true]);
  assert.ok(await prepararTurno(t.sys(), c.id));
});

test('sem a IA configurada, a conversa vai direto para a equipe', async () => {
  const t = await base();
  await receberMensagemCliente({ ...t.sys(), ia: null }, { telefone: TEL, texto: 'Oi', nome: 'Ana' });
  const [c] = await t.db.ConversaWhatsApp.filter({});
  assert.equal(c.status, 'HUMANO');
  assert.ok((await t.db.Notificacao.filter({})).some((n) => /Nova conversa/.test(n.titulo)));
});

test('cliente da IA: Haiku 5.5, saída estruturada, cache do prompt e recusa tratada', async () => {
  const chamadas = [];
  class Cliente {
    constructor(o) { this.o = o; this.messages = { create: async (p) => { chamadas.push(p); return chamadas.length === 1 ? { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(D({ resposta: 'oi' })) }], usage: {} } : { stop_reason: 'refusal', content: [], usage: {} }; } }; }
  }
  assert.equal(criarIA({}, { Cliente }), null, 'sem chave, desligado');
  const ia = criarIA({ ANTHROPIC_API_KEY: 'x' }, { Cliente });
  const r = await ia.responder({ sistema: 'S', mensagens: [{ role: 'user', content: 'oi' }] });
  assert.equal(r.resposta, 'oi');
  const p = chamadas[0];
  assert.equal(p.model, MODELO_IA);
  assert.equal(MODELO_IA, 'claude-haiku-5-5');
  assert.equal(p.output_config.format.type, 'json_schema');
  assert.equal(p.output_config.effort, 'low');
  assert.deepEqual(p.system[0].cache_control, { type: 'ephemeral' });
  assert.equal((await ia.responder({ sistema: 'S', mensagens: [] })).recusa, true);
});
