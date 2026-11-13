import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cenario, AUTORIZACAO, envBanco } from './helpers.js';
import { garantirModelosPadrao, MODELOS_PADRAO } from '../src/app/actions/mensagens.js';
import { verificarMensagem } from '../src/core/compliance.js';
import { criarDescadastro } from '../src/server/descadastro.js';
import { criarApp } from '../src/server/app.js';

async function casoHS(t, canais = ['WHATSAPP', 'TELEFONE', 'EMAIL']) {
  const A = t.empresas.A;
  await t.ok(A.adm, 'encaminharParaHS', { tipo_selecao: 'DIVIDAS', divida_ids: [A.dividas[0].id], contrato_servico_id: A.contrato.id, autorizacao: { ...AUTORIZACAO, canais_autorizados: canais }, confirmacao: true });
  const fila = await t.ok('gestor@hs.com', 'listarCasos', { escopo: 'validacao', filtros: { empresa_id: A.empresa.id } });
  await t.ok('gestor@hs.com', 'validarCaso', { caso_ids: fila.itens.map((c) => c.id), aprovado: true });
  return t.ok('gestor@hs.com', 'atribuirCaso', { caso_id: fila.itens[0].id, operador_id: t.op1.id });
}

test('modelos padrão: respeitosos (passam no filtro) e criados uma única vez', async () => {
  for (const m of MODELOS_PADRAO) verificarMensagem(`${m.assunto || ''}\n${m.conteudo}`);
  const t = await cenario();
  assert.equal(await garantirModelosPadrao(t.db), MODELOS_PADRAO.length);
  assert.equal(await garantirModelosPadrao(t.db), 0);
});

test('WhatsApp assistido: registra o envio, devolve o link com o texto e permite desfazer em 30 minutos', async () => {
  const t = await cenario();
  await garantirModelosPadrao(t.db);
  const caso = await casoHS(t);
  const modelos = await t.ok('op1@hs.com', 'listarModelosMensagem', { caso_id: caso.id });
  const primeiro = modelos.find((m) => m.canal === 'WHATSAPP' && m.nome === 'Primeiro contato');
  const previa = await t.ok('op1@hs.com', 'prepararMensagem', { caso_id: caso.id, canal: 'WHATSAPP', modelo_id: primeiro.id });
  assert.match(previa.texto, /^Olá, Devedor, tudo bem\? .*Loja A.*R\$\s1\.000,00/);
  const r = await t.ok('op1@hs.com', 'enviarWhatsAppAssistido', { caso_id: caso.id, modelo_id: primeiro.id });
  assert.match(r.link, /^https:\/\/wa\.me\/5511988887777\?text=Ol%C3%A1/);
  const [inter] = await t.db.Interacao.filter({ id: r.interacao_id });
  assert.equal(inter.envio_assistido, true);
  assert.equal(inter.tipo_interacao, 'MENSAGEM_ENVIADA');
  assert.equal(inter.mensagem, previa.texto);
  await t.falha('op2@hs.com', 'desfazerEnvio', { interacao_id: r.interacao_id }, 404);
  await t.ok('op1@hs.com', 'desfazerEnvio', { interacao_id: r.interacao_id });
  const [desfeita] = await t.db.Interacao.filter({ id: r.interacao_id });
  assert.equal(desfeita.cancelada, true);
  assert.equal(desfeita.tipo_interacao, 'NOTA_INTERNA');
  await t.falha('op1@hs.com', 'desfazerEnvio', { interacao_id: r.interacao_id }, 422);
  // envio desfeito não conta no limite diário de 3 contatos
  for (let i = 0; i < 3; i++) await t.ok('op1@hs.com', 'enviarWhatsAppAssistido', { caso_id: caso.id, mensagem: `Olá, {{nome}}. Mensagem ${i}.` });
  const quarta = await t.falha('op1@hs.com', 'enviarWhatsAppAssistido', { caso_id: caso.id, mensagem: 'Mais uma' }, 422);
  assert.match(quarta.error, /Limite de 3/);
  // prazo para desfazer
  const ultima = (await t.db.Interacao.filter({ caso_id: caso.id })).filter((i) => !i.cancelada).pop();
  t.estado.agora = new Date(t.estado.agora.getTime() + 31 * 60000);
  const tarde = await t.falha('op1@hs.com', 'desfazerEnvio', { interacao_id: ultima.id }, 422);
  assert.match(tarde.error, /30 minutos/);
});

test('mensagens: regras de linguagem, canal autorizado e quem pode enviar', async () => {
  const t = await cenario();
  const caso = await casoHS(t, ['WHATSAPP']);
  const ruim = await t.falha('op1@hs.com', 'enviarWhatsAppAssistido', { caso_id: caso.id, mensagem: 'Pague ou vamos chamar a polícia' }, 422);
  assert.match(ruim.error, /bloqueada/);
  await t.falha(t.empresas.A.adm, 'enviarWhatsAppAssistido', { caso_id: caso.id, mensagem: 'Olá' }, 422);
  t.estado.extras.email = { cobrancaDisponivel: true, paraDevedor: async () => ({ ok: true }) };
  const semCanal = await t.falha('op1@hs.com', 'enviarEmailDevedor', { caso_id: caso.id, mensagem: 'Olá' }, 422);
  assert.match(semCanal.error, /Canal EMAIL não autorizado/);
});

test('e-mail ao devedor: remetente do domínio com nome da HS, resposta para o operador e link de descadastro', async () => {
  const t = await cenario();
  await garantirModelosPadrao(t.db);
  const caso = await casoHS(t);
  const semDominio = await t.falha('op1@hs.com', 'enviarEmailDevedor', { caso_id: caso.id, mensagem: 'Olá' }, 422);
  assert.match(semDominio.error, /domínio próprio/);
  const enviados = [];
  t.estado.extras.email = { cobrancaDisponivel: true, paraDevedor: async (o) => { enviados.push(o); return { ok: true, id: 'msg-1' }; } };
  t.estado.extras.descadastro = { link: (id) => `https://acorly.test/descadastrar/${id}.assinatura` };
  const modelo = (await t.ok('op1@hs.com', 'listarModelosMensagem', { caso_id: caso.id })).find((m) => m.canal === 'EMAIL' && m.nome === 'Primeiro contato');
  const r = await t.ok('op1@hs.com', 'enviarEmailDevedor', { caso_id: caso.id, modelo_id: modelo.id });
  assert.equal(r.para, 'd0@x.com');
  const e = enviados[0];
  assert.equal(e.nomeRemetente, 'HS Recuperação de Crédito');
  assert.equal(e.responderPara, 'op1@hs.com');
  assert.equal(e.assunto, 'Pendência financeira com Loja A');
  assert.match(e.rodape, /em nome de Empresa A Ltda \(CNPJ \d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\)/);
  assert.match(e.descadastrar, /descadastrar\//);
  const [inter] = await t.db.Interacao.filter({ id: r.interacao_id });
  assert.equal(inter.canal, 'EMAIL');
  assert.equal(inter.email_destino, 'd0@x.com');
  assert.match(inter.mensagem, /^Assunto: Pendência financeira com Loja A/);
  // falha no provedor vira erro claro
  t.estado.extras.email.paraDevedor = async () => ({ ok: false, erro: 'o provedor de e-mail recusou o envio' });
  const falhou = await t.falha('op1@hs.com', 'enviarEmailDevedor', { caso_id: caso.id, mensagem: 'Olá, {{nome}}' }, 422);
  assert.match(falhou.error, /Não foi possível enviar o e-mail agora/);
  // devedor descadastrado não recebe mais e-mail
  await t.db.Devedor.update(caso.devedor_id, { nao_contatar_email: true });
  const bloqueado = await t.falha('op1@hs.com', 'enviarEmailDevedor', { caso_id: caso.id, mensagem: 'Olá' }, 422);
  assert.match(bloqueado.error, /não receber e-mails/);
});

test('cobrança própria: e-mail sai com o nome do credor e a resposta vai para quem enviou', async () => {
  const t = await cenario();
  const A = t.empresas.A;
  const enviados = [];
  t.estado.extras.email = { cobrancaDisponivel: true, paraDevedor: async (o) => { enviados.push(o); return { ok: true }; } };
  const casoId = (await t.ok(A.adm, 'abrirCobrancaPropria', { divida_id: A.dividas[1].id })).id;
  await t.ok(A.adm, 'enviarEmailDevedor', { caso_id: casoId, assunto: 'Sua pendência', mensagem: 'Olá, {{nome}}. Vamos conversar?' });
  assert.equal(enviados[0].nomeRemetente, 'Loja A via Acorly');
  assert.equal(enviados[0].responderPara, 'admin@a.com');
  assert.match(enviados[0].rodape, /Mensagem enviada por Empresa A Ltda/);
});

test('fila do dia: primeiro contato, retorno agendado e casos sem contato', async () => {
  const t = await cenario();
  const caso = await casoHS(t);
  let fila = await t.ok('op1@hs.com', 'filaDoDia');
  assert.deepEqual(fila.itens.map((i) => i.caso_id), [caso.id]);
  assert.deepEqual(fila.itens[0].motivos, ['Primeiro contato']);
  assert.equal(fila.itens[0].tem_whatsapp, true);
  await t.ok('op1@hs.com', 'registrarInteracao', { caso_id: caso.id, canal: 'TELEFONE', tipo_interacao: 'LIGACAO', resultado: 'SEM_RESPOSTA', proxima_acao: 'Ligar de novo', proxima_acao_data: '2026-11-13' });
  assert.equal((await t.ok('op1@hs.com', 'filaDoDia')).total, 0, 'contatado hoje e retorno só depois');
  t.estado.agora = new Date('2026-11-13T14:00:00Z');
  fila = await t.ok('op1@hs.com', 'filaDoDia');
  assert.match(fila.itens[0].motivos[0], /Retorno agendado para hoje: Ligar de novo/);
  await t.ok('op1@hs.com', 'concluirTarefa', { tarefa_id: (await t.db.Tarefa.filter({ caso_id: caso.id }))[0].id });
  t.estado.agora = new Date('2026-11-16T14:00:00Z');
  fila = await t.ok('op1@hs.com', 'filaDoDia');
  assert.deepEqual(fila.itens[0].motivos, ['Sem contato há 5 dias']);
  assert.equal((await t.ok('op2@hs.com', 'filaDoDia')).total, 0, 'outro operador não vê');
});

test('descadastro: link assinado, confirmação por POST e devedor bloqueado para e-mail', async () => {
  const d = criarDescadastro({ segredo: 's3gr3do', urlBase: 'https://x' });
  const link = d.link('dev_123');
  const token = link.split('/').pop();
  assert.equal(d.validar(token), 'dev_123');
  assert.equal(d.validar(token.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'))), null);
  assert.equal(d.validar('dev_999.' + token.split('.')[1]), null);

  const dir = mkdtempSync(join(tmpdir(), 'hs-desc-'));
  const a = criarApp({ dataDir: dir, webDir: join(dir, 'web'), env: { ...envBanco(), SEGREDO: 'segredo-teste' }, urlBase: 'http://local' });
  const dev = await a.exclusivo(() => a.db.Devedor.create({ empresa_id: 'emp_x', nome: 'Fulano', cpf_cnpj: '52998224725', email: 'f@x.com' }));
  const caminho = new URL(criarDescadastro({ segredo: 'segredo-teste', urlBase: 'http://local' }).link(dev.id)).pathname;
  await new Promise((ok) => a.server.listen(0, ok));
  const b = `http://127.0.0.1:${a.server.address().port}`;
  const get = await fetch(b + caminho);
  assert.equal(get.status, 200);
  assert.match(await get.text(), /<form method="post">/);
  assert.equal((await a.exclusivo(() => a.db.Devedor.filter({ id: dev.id })))[0].nao_contatar_email, undefined, 'GET não descadastra');
  const post = await fetch(b + caminho, { method: 'POST' });
  assert.equal(post.status, 200);
  assert.equal((await a.exclusivo(() => a.db.Devedor.filter({ id: dev.id })))[0].nao_contatar_email, true);
  assert.equal((await fetch(b + '/descadastrar/xyz.invalido')).status, 404);
  a.server.close(); await a.banco.fechar(); rmSync(dir, { recursive: true, force: true });
});
