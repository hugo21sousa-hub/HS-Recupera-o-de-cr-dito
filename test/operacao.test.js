import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario, casosHS, cpf, AUTORIZACAO } from './helpers.js';

test('importação de carteira por CSV: prévia, erros por linha e deduplicação', async () => {
  const t = await cenario();
  const { A } = t.empresas;
  const csv = `nome;cpf_cnpj;whatsapp;documento_referencia;valor_original;data_vencimento\nAna;${cpf(77)};11977776666;C-1;"2.500,00";15/07/2026\nAna;${cpf(77)};11977776666;C-2;300;2026-07-20\nErro;000;;C-3;-5;2026-13-01\n`;
  const previa = await t.ok(A.adm, 'importarPlanilha', { csv });
  assert.equal(previa.importado, false);
  assert.equal(previa.validas, 2);
  assert.equal(previa.com_erro, 1);
  const r = await t.ok(A.adm, 'importarPlanilha', { csv, dryRun: false });
  assert.equal(r.devedores_novos, 1);
  assert.equal(r.dividas_criadas, 2);
  const again = await t.ok(A.adm, 'importarPlanilha', { csv, dryRun: false });
  assert.equal(again.dividas_criadas, 0);
  assert.equal(again.duplicadas_ignoradas, 2);
  await t.falha(A.vis, 'importarPlanilha', { csv, dryRun: false }, 403);
});

test('seleção e autorização: prévia, confirmação expressa, contrato e elegibilidade', async () => {
  const t = await cenario();
  const { A } = t.empresas;
  // dívida sem documento e devedor sem contato → não elegível
  const dev = await t.ok(A.adm, 'salvarDevedor', { nome: 'Sem contato', tipo_pessoa: 'PF', cpf_cnpj: cpf(55) });
  const div = await t.ok(A.adm, 'salvarDivida', { devedor_id: dev.id, valor_original_centavos: 5000, data_vencimento: '2026-05-01' });
  const carteira = await t.ok(A.adm, 'salvarCarteira', { nome: 'Lote nov', modalidade: 'HS_GERENCIADA' });
  await t.ok(A.adm, 'adicionarDividasCarteira', { carteira_id: carteira.id, divida_ids: [A.dividas[0].id, A.dividas[1].id, div.id] });
  const prev = await t.ok(A.adm, 'previewEncaminhamento', { tipo_selecao: 'CARTEIRA', carteira_ids: [carteira.id] });
  assert.equal(prev.resumo.quantidade_dividas, 3);
  assert.equal(prev.resumo.elegiveis, 2);
  assert.equal(prev.resumo.registros_incompletos, 1);
  assert.equal(prev.resumo.valor_total_centavos, 205000);
  const base = { tipo_selecao: 'CARTEIRA', carteira_ids: [carteira.id], contrato_servico_id: A.contrato.id, autorizacao: AUTORIZACAO };
  await t.falha(A.adm, 'encaminharParaHS', base, 422); // sem confirmação expressa
  await t.falha(A.fin, 'encaminharParaHS', { ...base, confirmacao: true }, 403);
  await t.falha(A.adm, 'encaminharParaHS', { ...base, confirmacao: true, contrato_servico_id: t.empresas.B.contrato.id }, 404);
  await t.falha(A.adm, 'encaminharParaHS', { ...base, confirmacao: true, autorizacao: { ...AUTORIZACAO, canais_autorizados: ['POMBO'] } }, 422);
  await t.falha(A.adm, 'encaminharParaHS', { ...base, tipo_selecao: 'TODOS_ELEGIVEIS', confirmacao: true }, 422); // contrato não cobre "todos"
  const r = await t.ok(A.adm, 'encaminharParaHS', { ...base, confirmacao: true });
  assert.equal(r.casos_criados, 2);
  assert.equal(r.autorizacao.versao, 1);
  assert.equal(r.autorizacao.responsavel, (await t.ok(A.adm, 'meuPerfil')).usuario.id);
  assert.equal(r.nao_encaminhadas.length, 1);
  // nenhum caso entra na fila sem validação
  const fila = await t.ok('gestor@hs.com', 'listarCasos', { escopo: 'fila' });
  assert.equal(fila.total, 0);
  await t.falha('gestor@hs.com', 'atribuirCaso', { caso_id: (await t.ok('gestor@hs.com', 'listarCasos', { escopo: 'validacao' })).itens[0].id, operador_id: t.op1.id }, 422);
  // dívida já encaminhada não pode ser encaminhada de novo
  const prev2 = await t.ok(A.adm, 'previewEncaminhamento', { tipo_selecao: 'DIVIDAS', divida_ids: [A.dividas[0].id] });
  assert.match(prev2.itens[0].problemas.join(), /caso de cobrança ativo/);
});

test('validação, reprovação e distribuição por capacidade', async () => {
  const t = await cenario();
  const { A, B } = t.empresas;
  for (const k of ['A', 'B']) {
    const E = t.empresas[k];
    await t.ok(E.adm, 'encaminharParaHS', { tipo_selecao: 'DIVIDAS', divida_ids: E.dividas.map((d) => d.id), contrato_servico_id: E.contrato.id, autorizacao: AUTORIZACAO, confirmacao: true });
  }
  const val = await t.ok('gestor@hs.com', 'listarCasos', { escopo: 'validacao' });
  assert.equal(val.total, 6);
  assert.ok(val.itens.every((c) => c.credor && c.devedor_nome && c.valor_original_centavos === 100000));
  await t.falha('op1@hs.com', 'validarCaso', { caso_id: val.itens[0].id, aprovado: true }, 403);
  const reprovado = val.itens.find((c) => c.empresa_id === B.empresa.id);
  await t.falha('gestor@hs.com', 'validarCaso', { caso_id: reprovado.id, aprovado: false }, 422);
  await t.ok('gestor@hs.com', 'validarCaso', { caso_id: reprovado.id, aprovado: false, motivo: 'Documento ilegível' });
  const notifsB = await t.ok(B.adm, 'listarNotificacoes', {});
  assert.ok(notifsB.itens.some((n) => n.tipo === 'VALIDACAO_REPROVADA'));
  const r = await t.ok('gestor@hs.com', 'validarCaso', { caso_ids: val.itens.filter((c) => c.id !== reprovado.id).map((c) => c.id), aprovado: true });
  assert.equal(r.aprovados, 5);
  // capacidade: 2 operadores × 2 = 4 casos; 1 fica na fila
  const dist = await t.ok('gestor@hs.com', 'distribuirAutomatico', {});
  assert.equal(dist.atribuidos, 4);
  assert.equal(dist.restantes_na_fila, 1);
  const ops = await t.ok('gestor@hs.com', 'listarOperadores');
  assert.deepEqual(ops.map((o) => o.carga_atual).sort(), [2, 2]);
  // manual acima da capacidade só com "forcar"
  const fila = await t.ok('gestor@hs.com', 'listarCasos', { escopo: 'fila' });
  await t.falha('gestor@hs.com', 'atribuirCaso', { caso_id: fila.itens[0].id, operador_id: t.op1.id }, 422);
  const at = await t.ok('gestor@hs.com', 'atribuirCaso', { caso_id: fila.itens[0].id, operador_id: t.op1.id, forcar: true });
  assert.equal(at.operador_id, t.op1.id);
  const det = await t.ok('gestor@hs.com', 'detalheCaso', { caso_id: at.id });
  assert.equal(det.atribuicoes[0].atribuido_por, (await t.ok('gestor@hs.com', 'meuPerfil')).usuario.id);
  // reatribuição registra histórico
  await t.ok('super@hs.com', 'alterarUsuario', { usuario_id: t.op2.id, capacidade_casos: 10 });
  await t.ok('gestor@hs.com', 'atribuirCaso', { caso_id: at.id, operador_id: t.op2.id });
  const det2 = await t.ok('gestor@hs.com', 'detalheCaso', { caso_id: at.id });
  assert.equal(det2.atribuicoes.filter((a) => a.status === 'ATIVA').length, 1);
  assert.equal(det2.atribuicoes.length, 2);
});

test('registro de contato com salvaguardas (canal, interrupção, abuso, limite diário)', async () => {
  const t = await cenario();
  const { A } = t.empresas;
  const [caso] = await casosHS(t, 'A', [0]);
  await t.falha('op1@hs.com', 'registrarInteracao', { caso_id: caso.id, canal: 'EMAIL', tipo_interacao: 'MENSAGEM_ENVIADA', mensagem: 'Olá' }, 422);
  await t.falha('op1@hs.com', 'registrarInteracao', { caso_id: caso.id, canal: 'WHATSAPP', tipo_interacao: 'MENSAGEM_ENVIADA', mensagem: 'Pague senão vai ser preso' }, 422);
  const wa = await t.ok('op1@hs.com', 'prepararWhatsApp', { caso_id: caso.id, mensagem: 'Olá! Podemos conversar sobre uma proposta?' });
  assert.equal(wa.modo, 'MANUAL');
  assert.match(wa.link, /^https:\/\/wa\.me\/5511988887777\?text=/);
  const i1 = await t.ok('op1@hs.com', 'registrarInteracao', { caso_id: caso.id, canal: 'WHATSAPP', tipo_interacao: 'MENSAGEM_ENVIADA', mensagem: wa.mensagem, resultado: 'SEM_RESPOSTA', proxima_acao: 'Ligar', proxima_acao_data: '2026-11-12' });
  assert.equal(i1.envio_automatico, false);
  let det = await t.ok('op1@hs.com', 'detalheCaso', { caso_id: caso.id });
  assert.equal(det.caso.status_operacional, 'EM_CONTATO');
  assert.equal(det.tarefas.length, 1);
  await t.ok('op1@hs.com', 'registrarInteracao', { caso_id: caso.id, canal: 'TELEFONE', tipo_interacao: 'LIGACAO', resultado: 'SEM_RESPOSTA' });
  await t.ok('op1@hs.com', 'registrarInteracao', { caso_id: caso.id, canal: 'TELEFONE', tipo_interacao: 'LIGACAO', resultado: 'SEM_RESPOSTA' });
  await t.falha('op1@hs.com', 'registrarInteracao', { caso_id: caso.id, canal: 'TELEFONE', tipo_interacao: 'LIGACAO' }, 422); // 4ª tentativa no dia
  await t.ok('op1@hs.com', 'registrarInteracao', { caso_id: caso.id, canal: 'WHATSAPP', tipo_interacao: 'RESPOSTA_DEVEDOR', resposta: 'Não me procurem mais', resultado: 'SOLICITOU_INTERRUPCAO' });
  det = await t.ok('op1@hs.com', 'detalheCaso', { caso_id: caso.id });
  assert.equal(det.devedor.nao_contatar, true);
  assert.equal(det.caso.status_operacional, 'DEVEDOR_RESPONDEU');
  await t.falha('op1@hs.com', 'prepararWhatsApp', { caso_id: caso.id, mensagem: 'Oi' }, 422);
  // a empresa acompanha as interações pelo painel
  const ints = await t.ok(A.adm, 'listarInteracoes', { caso_id: caso.id });
  assert.equal(ints.total, 4);
  // empresa não interage em caso HS
  await t.falha(A.adm, 'registrarInteracao', { caso_id: caso.id, canal: 'TELEFONE', tipo_interacao: 'NOTA_INTERNA' }, 422);
});

test('negociação: dentro da alçada segue; fora vai ao credor; acordo formalizado', async () => {
  const t = await cenario();
  const { A } = t.empresas;
  const [c1, c2] = await casosHS(t, 'A', [0, 1]);
  const sim = await t.ok('op1@hs.com', 'simularNegociacao', { caso_id: c1.id, desconto_bps: 1000, entrada_centavos: 20000, quantidade_parcelas: 4, primeira_data_vencimento: '2026-12-10' });
  assert.equal(sim.valor_proposto_centavos, 90000);
  assert.equal(sim.valor_parcela_centavos, 17500);
  assert.equal(sim.dentro_alcada, true);
  const dentro = await t.ok('op1@hs.com', 'proporNegociacao', { caso_id: c1.id, desconto_bps: 1000, entrada_centavos: 20000, quantidade_parcelas: 4, primeira_data_vencimento: '2026-12-10' });
  assert.equal(dentro.status, 'APROVADA_ALCADA');
  await t.falha('op1@hs.com', 'proporNegociacao', { caso_id: c1.id, desconto_bps: 0, entrada_centavos: 100000, quantidade_parcelas: 0 }, 422); // já há proposta aberta
  // fora da alçada individual do operador (20%) embora dentro do credor (30%)
  const fora = await t.ok('op1@hs.com', 'proporNegociacao', { caso_id: c2.id, desconto_bps: 2500, entrada_centavos: 15000, quantidade_parcelas: 2, primeira_data_vencimento: '2026-12-10' });
  assert.equal(fora.status, 'AGUARDANDO_APROVACAO_CREDOR');
  await t.falha('op1@hs.com', 'formalizarAcordo', { negociacao_id: fora.id, aceite_devedor: true }, 422);
  const pend = await t.ok(A.fin, 'listarAprovacoesPendentes', {});
  assert.equal(pend.total, 1);
  await t.falha(A.fin, 'decidirNegociacao', { negociacao_id: fora.id, decisao: 'REJEITAR' }, 422); // sem justificativa
  await t.ok(A.fin, 'decidirNegociacao', { negociacao_id: fora.id, decisao: 'REJEITAR', justificativa: 'Desconto alto' });
  // acordo da proposta dentro da alçada
  await t.falha('op1@hs.com', 'formalizarAcordo', { negociacao_id: dentro.id }, 422);
  const { acordo, parcelas } = await t.ok('op1@hs.com', 'formalizarAcordo', { negociacao_id: dentro.id, aceite_devedor: true, data_aceite: '2026-11-11' });
  assert.equal(parcelas, 5);
  assert.equal(acordo.valor_acordado_centavos, 90000);
  const div = await t.ok(A.adm, 'detalheDivida', { divida_id: A.dividas[0].id });
  assert.equal(div.divida.valor_original_centavos, 100000, 'valor original nunca muda');
  assert.equal(div.divida.saldo_atual_centavos, 100000, 'acordo não altera saldo');
  assert.equal(div.casos[0].status_operacional, 'ACORDO_AGUARDANDO_PAGAMENTO');
});

test('suspensão e reativação autorizadas; revogação suspende casos', async () => {
  const t = await cenario();
  const { A } = t.empresas;
  const [caso] = await casosHS(t, 'A', [0]);
  await t.falha('gestor@hs.com', 'alterarStatusCaso', { caso_id: caso.id, status: 'SUSPENSO' }, 422);
  await t.ok('gestor@hs.com', 'alterarStatusCaso', { caso_id: caso.id, status: 'SUSPENSO', motivo: 'Devedor em tratamento de saúde' });
  await t.falha('op1@hs.com', 'detalheCaso', { caso_id: caso.id }, 404); // operador perde acesso ao caso suspenso
  await t.falha(A.fin, 'alterarStatusCaso', { caso_id: caso.id, status: 'REATIVAR', motivo: 'ok' }, 403);
  const r = await t.ok(A.adm, 'alterarStatusCaso', { caso_id: caso.id, status: 'REATIVAR', motivo: 'Liberado' });
  assert.equal(r.status_operacional, 'ATRIBUIDO');
  const auts = await t.ok(A.adm, 'listarAutorizacoes', {});
  const rev = await t.ok(A.adm, 'revogarAutorizacao', { autorizacao_id: auts.itens[0].id, motivo: 'Cliente quitou fora' });
  assert.equal(rev.casos_suspensos, 1);
  await t.falha('gestor@hs.com', 'alterarStatusCaso', { caso_id: caso.id, status: 'REATIVAR', motivo: 'x' }, 422);
  // retirada da HS (troca de modalidade) auditada
  await t.ok(A.adm, 'alterarModalidade', { divida_id: A.dividas[0].id, para: 'AUTOCONTRATADA', motivo: 'Cobrança interna' });
  const aud = await t.ok('super@hs.com', 'listarAuditoria', { filtros: { acao: 'ALTERAR_MODALIDADE', registro_id: A.dividas[0].id } });
  assert.equal(aud.total, 2);
});

test('não permite nova proposta enquanto há acordo ativo', async () => {
  const t = await cenario();
  const [caso] = await casosHS(t, 'A', [0]);
  const n = await t.ok('op1@hs.com', 'proporNegociacao', { caso_id: caso.id, desconto_bps: 0, entrada_centavos: 100000, quantidade_parcelas: 0 });
  await t.ok('op1@hs.com', 'formalizarAcordo', { negociacao_id: n.id, aceite_devedor: true });
  await t.falha('op1@hs.com', 'proporNegociacao', { caso_id: caso.id, desconto_bps: 0, entrada_centavos: 100000, quantidade_parcelas: 0 }, 422);
  const ac = (await t.ok('op1@hs.com', 'listarAcordos', {})).itens[0];
  await t.ok('op1@hs.com', 'encerrarAcordo', { acordo_id: ac.id, motivo: 'Devedor desistiu' });
  await t.ok('op1@hs.com', 'proporNegociacao', { caso_id: caso.id, desconto_bps: 0, entrada_centavos: 100000, quantidade_parcelas: 0 });
});
