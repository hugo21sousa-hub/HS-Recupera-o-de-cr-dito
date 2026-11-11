import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario, casosHS } from './helpers.js';

test('empresas diferentes não acessam dados uma da outra', async () => {
  const t = await cenario();
  const { A, B } = t.empresas;
  // listagens só trazem a própria empresa
  const devsA = await t.ok(A.adm, 'listarDevedores', {});
  assert.equal(devsA.total, 3);
  assert.ok(devsA.itens.every((d) => d.empresa_id === A.empresa.id));
  // acesso direto por id de outra empresa → 404 (não revela existência)
  await t.falha(B.adm, 'detalheDevedor', { devedor_id: A.devedores[0].id }, 404);
  await t.falha(B.adm, 'detalheDivida', { divida_id: A.dividas[0].id }, 404);
  await t.falha(B.fin, 'historicoFinanceiro', { divida_id: A.dividas[0].id }, 404);
  // tentar forçar empresa_id de outra empresa no payload
  await t.falha(B.adm, 'listarDevedores', { empresa_id: A.empresa.id }, 404);
  await t.falha(B.adm, 'salvarDivida', { empresa_id: A.empresa.id, devedor_id: A.devedores[0].id, valor_original_centavos: 1, data_vencimento: '2026-01-01' }, 404);
  await t.falha(B.adm, 'salvarDevedor', { id: A.devedores[0].id, nome: 'hack' }, 404);
  await t.falha(B.adm, 'adicionarDividasCarteira', { carteira_id: (await t.ok(A.adm, 'salvarCarteira', { nome: 'C' })).id, divida_ids: [B.dividas[0].id] }, 404);
  // carteira de B não aceita dívida de A
  const cB = await t.ok(B.adm, 'salvarCarteira', { nome: 'CB' });
  await t.falha(B.adm, 'adicionarDividasCarteira', { carteira_id: cB.id, divida_ids: [A.dividas[0].id] }, 404);
  // anexos
  const detA = await t.ok(A.adm, 'detalheDivida', { divida_id: A.dividas[0].id });
  assert.equal(detA.documentos[0].arquivo, undefined, 'file_uri nunca vai para o cliente');
  await t.falha(B.adm, 'urlDocumento', { documento_id: detA.documentos[0].id }, 404);
  const url = await t.ok(A.vis, 'urlDocumento', { documento_id: detA.documentos[0].id });
  assert.match(url.url, /^https:\/\/signed\//);
  // relatórios
  const dashB = await t.ok(B.adm, 'dashboardEmpresa', {});
  assert.equal(dashB.financeiro.quantidade_dividas, 3);
  await t.falha(B.adm, 'dashboardEmpresa', { empresa_id: A.empresa.id }, 404);
});

test('operador só vê casos atribuídos a ele; gestor não acessa cadastro da empresa', async () => {
  const t = await cenario();
  const { A, B } = t.empresas;
  const [casoA] = await casosHS(t, 'A', [0]);
  // caso autocontratado da empresa B (fora da HS)
  const casoB = await t.ok(B.adm, 'abrirCobrancaPropria', { divida_id: B.dividas[0].id });

  const meus = await t.ok('op1@hs.com', 'listarCasos', {});
  assert.deepEqual(meus.itens.map((c) => c.id), [casoA.id]);
  assert.equal((await t.ok('op2@hs.com', 'listarCasos', {})).total, 0);
  await t.falha('op2@hs.com', 'detalheCaso', { caso_id: casoA.id }, 404);
  await t.falha('op1@hs.com', 'detalheCaso', { caso_id: casoB.id }, 404);
  await t.falha('gestor@hs.com', 'detalheCaso', { caso_id: casoB.id }, 404);
  await t.falha('op2@hs.com', 'registrarInteracao', { caso_id: casoA.id, canal: 'WHATSAPP', tipo_interacao: 'MENSAGEM_ENVIADA', mensagem: 'Olá' }, 404);
  // HS não lista devedores/dívidas da empresa diretamente
  await t.falha('gestor@hs.com', 'listarDevedores', { empresa_id: A.empresa.id }, 403);
  await t.falha('op1@hs.com', 'detalheDivida', { divida_id: A.dividas[0].id }, 403);
  // anexos: op1 (com caso) pode; op2 não; documento de dívida fora da HS ninguém da HS acessa
  const det = await t.ok('op1@hs.com', 'detalheCaso', { caso_id: casoA.id });
  await t.ok('op1@hs.com', 'urlDocumento', { documento_id: det.documentos[0].id });
  await t.falha('op2@hs.com', 'urlDocumento', { documento_id: det.documentos[0].id }, 404);
  const docB = (await t.ok(B.adm, 'detalheDivida', { divida_id: B.dividas[0].id })).documentos[0];
  await t.falha('gestor@hs.com', 'urlDocumento', { documento_id: docB.id }, 404);
  // operador não altera status para recuperado/pagamento manualmente
  await t.falha('op1@hs.com', 'alterarStatusCaso', { caso_id: casoA.id, status: 'RECUPERADO_INTEGRALMENTE' }, 422);
  // operador não suspende (perfil sem caso.suspender)
  await t.falha('op1@hs.com', 'alterarStatusCaso', { caso_id: casoA.id, status: 'SUSPENSO', motivo: 'x' }, 403);
});

test('usuário sem permissão não aprova negociação nem confirma pagamento', async () => {
  const t = await cenario();
  const { A, B } = t.empresas;
  const [caso] = await casosHS(t, 'A', [0]);
  const neg = await t.ok('op1@hs.com', 'proporNegociacao', { caso_id: caso.id, desconto_bps: 5000, entrada_centavos: 0, quantidade_parcelas: 1, primeira_data_vencimento: '2026-12-10' });
  assert.equal(neg.status, 'AGUARDANDO_APROVACAO_CREDOR');
  await t.falha('op1@hs.com', 'decidirNegociacao', { negociacao_id: neg.id, decisao: 'APROVAR' }, 403);
  await t.falha('gestor@hs.com', 'decidirNegociacao', { negociacao_id: neg.id, decisao: 'APROVAR' }, 403);
  await t.falha(A.vis, 'decidirNegociacao', { negociacao_id: neg.id, decisao: 'APROVAR' }, 403);
  await t.falha(B.adm, 'decidirNegociacao', { negociacao_id: neg.id, decisao: 'APROVAR' }, 404);
  await t.ok(A.fin, 'decidirNegociacao', { negociacao_id: neg.id, decisao: 'APROVAR' });

  const pag = await t.ok('op1@hs.com', 'informarPagamento', { caso_id: caso.id, valor_centavos: 10000, data_informada: '2026-11-10' });
  await t.falha('op1@hs.com', 'confirmarPagamento', { pagamento_id: pag.id }, 403);
  await t.falha('super@hs.com', 'confirmarPagamento', { pagamento_id: pag.id }, 403);
  await t.falha(A.vis, 'confirmarPagamento', { pagamento_id: pag.id }, 403);
  await t.falha(B.fin, 'confirmarPagamento', { pagamento_id: pag.id }, 404);
});

test('escalada de privilégio e usuários sem vínculo são bloqueados', async () => {
  const t = await cenario();
  const { A } = t.empresas;
  await t.falha('intruso@x.com', 'listarDevedores', {}, 403);
  await t.falha(A.adm, 'convidarUsuario', { email: 'x@x.com', perfil: 'SUPERADMIN_HS' }, 403);
  await t.falha(A.fin, 'convidarUsuario', { email: 'y@x.com', perfil: 'ADMIN_EMPRESA' }, 403);
  const users = await t.ok(A.adm, 'listarUsuarios', {});
  const fin = users.itens.find((u) => u.perfil === 'FINANCEIRO_EMPRESA');
  await t.falha(A.adm, 'alterarUsuario', { usuario_id: fin.id, perfil: 'GESTOR_OPERACOES_HS' }, 422);
  const me = users.itens.find((u) => u.perfil === 'ADMIN_EMPRESA');
  await t.falha(A.adm, 'alterarUsuario', { usuario_id: me.id, status: 'ATIVO' }, 422);
  await t.falha(A.vis, 'salvarDevedor', { nome: 'X', tipo_pessoa: 'PF', cpf_cnpj: '1' }, 403);
  await t.falha(A.fin, 'atualizarEmpresa', { nome_fantasia: 'x' }, 403);
  await t.falha(A.adm, 'listarAuditoria', {}, 403);
  await t.falha(A.adm, 'registrarEmpresa', { razao_social: 'Outra' }, 422);
  await t.falha(A.adm, 'acaoInexistente', {}, 422);
  // usuário bloqueado perde acesso
  await t.ok(A.adm, 'alterarUsuario', { usuario_id: fin.id, status: 'BLOQUEADO' });
  await t.falha(A.fin, 'listarDividas', {}, 403);
});

test('acesso administrativo é auditado e empresa suspensa fica bloqueada', async () => {
  const t = await cenario();
  const { A } = t.empresas;
  await t.ok('super@hs.com', 'listarDevedores', { empresa_id: A.empresa.id });
  const aud = await t.ok('super@hs.com', 'listarAuditoria', { filtros: { acao: 'ACESSO_ADMINISTRATIVO' } });
  assert.ok(aud.total >= 1);
  await t.ok('super@hs.com', 'alterarStatusEmpresa', { empresa_id: A.empresa.id, status: 'SUSPENSA', motivo: 'Inadimplência da assinatura' });
  await t.falha(A.adm, 'listarDevedores', {}, 403);
  await t.ok(A.adm, 'meuPerfil', {});
});
