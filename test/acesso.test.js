import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, cenario, cnpj, cpf, AGORA } from './helpers.js';
import { processarWebhookAsaas } from '../src/app/actions/comercial.js';

const DIA = 86400000;
const depois = (t, dias) => { t.estado.agora = new Date(AGORA.getTime() + dias * DIA); };

async function empresaNova(seed = 7) {
  const t = app();
  await t.db.UsuarioPlataforma.create({ nome: 'Super', email: 'super@hs.com', perfil: 'SUPERADMIN_HS', empresa_id: null, status: 'ATIVO' });
  await t.ok('super@hs.com', 'seedPlanos');
  const adm = 'dono@nova.com';
  const { empresa } = await t.ok(adm, 'registrarEmpresa', {
    razao_social: 'Nova Ltda', nome_fantasia: 'Nova', cnpj: cnpj(seed), email: 'contato@nova.com.br', telefone: '11999990000',
    endereco: 'Rua Y, 2', responsavel_legal: 'Ciclano', admin_nome: 'Dono', aceite_termos: true, aceite_privacidade: true,
  });
  await t.ok(adm, 'escolherServico', { modalidade_servico: 'PLATAFORMA' });
  const planos = await t.ok(adm, 'listarPlanos');
  const plano = (nome) => planos.find((p) => p.nome === nome);
  let n = 0;
  const devedor = () => t.as(adm, 'salvarDevedor', { nome: `Devedor ${++n}`, tipo_pessoa: 'PF', cpf_cnpj: cpf(500 + n) });
  return { t, adm, empresa, plano, devedor };
}

test('teste grátis de 7 dias: tudo liberado com 20 devedores e 3 usuários', async () => {
  const { t, adm, devedor } = await empresaNova();
  const perfil = await t.ok(adm, 'meuPerfil');
  assert.equal(perfil.acesso.modo, 'TESTE');
  assert.equal(perfil.acesso.dias_restantes, 7);
  assert.equal(perfil.acesso.teste_ate, '2026-11-17');
  for (let i = 0; i < 20; i++) assert.equal((await devedor()).status, 200);
  const r = await devedor();
  assert.equal(r.status, 422);
  assert.match(r.body.error, /Limite de 20 devedores do teste grátis/);
  await t.ok(adm, 'convidarUsuario', { nome: 'Fin', email: 'fin@nova.com', perfil: 'FINANCEIRO_EMPRESA' });
  await t.ok(adm, 'convidarUsuario', { nome: 'Vis', email: 'vis@nova.com', perfil: 'VISUALIZADOR_EMPRESA' });
  await t.falha(adm, 'convidarUsuario', { nome: 'Mais', email: 'mais@nova.com', perfil: 'VISUALIZADOR_EMPRESA' }, 422);
  // recursos de todos os planos durante o teste
  await t.ok(adm, 'salvarCarteira', { nome: 'Teste' });
  depois(t, 6);
  assert.equal((await t.ok(adm, 'meuPerfil')).acesso.dias_restantes, 1, 'último dia do teste');
});

test('teste encerrado sem assinatura: somente leitura, mas pode consultar, exportar e assinar', async () => {
  const { t, adm, devedor, plano } = await empresaNova();
  assert.equal((await devedor()).status, 200);
  depois(t, 7);
  const perfil = await t.ok(adm, 'meuPerfil');
  assert.equal(perfil.acesso.modo, 'SOMENTE_LEITURA');
  assert.equal(perfil.acesso.motivo, 'TESTE_ENCERRADO');
  const r = await devedor();
  assert.equal(r.status, 403);
  assert.match(r.body.error, /teste grátis de 7 dias terminou/);
  assert.equal(r.body.details.assinatura, 'TESTE_ENCERRADO');
  assert.equal((await t.ok(adm, 'listarDevedores')).total, 1, 'consulta continua liberada');
  await t.ok(adm, 'exportarCSV', { tipo: 'dividas' });
  t.estado.extras.asaas = { disponivel: true, ambiente: 'sandbox', criarCliente: async () => ({ id: 'cus_9' }), criarAssinatura: async () => ({ id: 'sub_9' }), cobrancasDaAssinatura: async () => ({ data: [{ invoiceUrl: 'https://asaas/f/9' }] }), cancelarAssinatura: async () => {} };
  const a = await t.ok(adm, 'assinarPlano', { plano_id: plano('ACORLY ESSENCIAL').id });
  assert.equal(a.fatura_url, 'https://asaas/f/9');
  const sys = { db: t.db, now: () => t.estado.agora, user: { id: 'sistema', email: 'sistema', perfil: 'SISTEMA' } };
  await processarWebhookAsaas(sys, { id: 'e1', event: 'PAYMENT_CONFIRMED', payment: { id: 'p1', subscription: 'sub_9', dueDate: '2026-11-18' } });
  assert.equal((await t.ok(adm, 'meuPerfil')).acesso.modo, 'ATIVO');
  assert.equal((await devedor()).status, 200, 'pagou: volta a cadastrar');
});

test('com contrato de cobrança gerenciada, a empresa sem assinatura segue cadastrando e encaminhando', async () => {
  const t = await cenario();
  const { A } = t.empresas;
  depois(t, 30);
  const perfil = await t.ok(A.adm, 'meuPerfil');
  assert.equal(perfil.acesso.modo, 'SOMENTE_LEITURA');
  assert.equal(perfil.acesso.com_contrato, true);
  await t.ok(A.adm, 'salvarDevedor', { nome: 'Novo', tipo_pessoa: 'PF', cpf_cnpj: cpf(999) });
  // cobrança própria e negociação pela plataforma ficam bloqueadas
  await t.falha(A.adm, 'abrirCobrancaPropria', { divida_ids: [A.dividas[2].id] }, 403);
  await t.falha(A.adm, 'salvarTarefa', { titulo: 'Ligar', data_prevista: '2026-12-20' }, 403);
});

test('recursos por plano: Essencial não importa planilha nem usa carteiras', async () => {
  const { t, adm, empresa, plano, devedor } = await empresaNova(8);
  await t.ok('super@hs.com', 'salvarAssinatura', { empresa_id: empresa.id, plano_id: plano('ACORLY ESSENCIAL').id, data_inicio: '2026-11-11', data_vencimento: '2026-12-11' });
  const perfil = await t.ok(adm, 'meuPerfil');
  assert.equal(perfil.acesso.modo, 'ATIVO');
  assert.equal(perfil.acesso.plano_nome, 'ACORLY ESSENCIAL');
  assert.equal((await devedor()).status, 200);
  const imp = await t.falha(adm, 'importarPlanilha', { csv: 'nome;cpf_cnpj\n' }, 403);
  assert.match(imp.error, /Importação de planilhas não faz parte do seu plano \(ACORLY ESSENCIAL\)\. Disponível a partir do plano ACORLY PROFISSIONAL/);
  assert.equal(imp.details.recurso, 'importacao');
  await t.falha(adm, 'salvarCarteira', { nome: 'X' }, 403);
  await t.falha(adm, 'exportarCSV', { tipo: 'dividas' }, 403);
  await t.ok('super@hs.com', 'salvarAssinatura', { empresa_id: empresa.id, plano_id: plano('ACORLY PROFISSIONAL').id, data_inicio: '2026-11-11', data_vencimento: '2026-12-11' });
  await t.ok(adm, 'salvarCarteira', { nome: 'X' });
});

test('atraso: 5 dias de tolerância com acesso normal, depois somente leitura', async () => {
  const { t, adm, empresa, plano, devedor } = await empresaNova(9);
  await t.ok('super@hs.com', 'salvarAssinatura', { empresa_id: empresa.id, plano_id: plano('ACORLY PROFISSIONAL').id, data_inicio: '2026-10-11', data_vencimento: '2026-11-11' });
  depois(t, 3);
  let acesso = (await t.ok(adm, 'meuPerfil')).acesso;
  assert.equal(acesso.modo, 'TOLERANCIA');
  assert.equal(acesso.bloqueio_em, '2026-11-17');
  assert.equal(acesso.dias_restantes, 3);
  assert.equal((await devedor()).status, 200);
  depois(t, 6);
  acesso = (await t.ok(adm, 'meuPerfil')).acesso;
  assert.equal(acesso.modo, 'SOMENTE_LEITURA');
  assert.equal(acesso.motivo, 'ATRASO');
  const r = await devedor();
  assert.equal(r.status, 403);
  assert.match(r.body.error, /mensalidade está em atraso/);
});

test('fatura inicial não paga não tira o teste grátis; equipe Acorly não é afetada', async () => {
  const { t, adm, empresa, plano, devedor } = await empresaNova(10);
  t.estado.extras.asaas = { disponivel: true, ambiente: 'sandbox', criarCliente: async () => ({ id: 'cus_1' }), criarAssinatura: async () => ({ id: 'sub_1' }), cobrancasDaAssinatura: async () => ({ data: [] }), cancelarAssinatura: async () => {} };
  await t.ok(adm, 'assinarPlano', { plano_id: plano('ACORLY ESSENCIAL').id });
  const sys = { db: t.db, now: () => t.estado.agora, user: { id: 'sistema', email: 'sistema', perfil: 'SISTEMA' } };
  await processarWebhookAsaas(sys, { id: 'o1', event: 'PAYMENT_OVERDUE', payment: { id: 'p1', subscription: 'sub_1', dueDate: '2026-11-11' } });
  assert.equal((await t.ok(adm, 'meuPerfil')).acesso.modo, 'TESTE');
  assert.equal((await devedor()).status, 200);
  depois(t, 20);
  await t.ok('super@hs.com', 'alterarStatusEmpresa', { empresa_id: empresa.id, status: 'ATIVA', motivo: 'ok' });
});
