import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario, AUTORIZACAO } from './helpers.js';
import { lembretesParcelas } from '../src/app/lembretes.js';

const SISTEMA = { id: 'sistema', nome: 'Sistema', email: 'sistema', perfil: 'SISTEMA', status: 'ATIVO' };
const LINHA = '23793.38128 60000.000003 00000.000400 1 84340000015000';
const PIX = '00020126580014BR.GOV.BCB.PIX0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Loja A Ltda6008SAOPAULO62070503***6304ABCD';

async function montarAcordo() {
  const t = await cenario();
  const A = t.empresas.A;
  await t.ok(A.adm, 'encaminharParaHS', { tipo_selecao: 'DIVIDAS', divida_ids: [A.dividas[0].id], contrato_servico_id: A.contrato.id, autorizacao: { ...AUTORIZACAO, canais_autorizados: ['WHATSAPP', 'EMAIL'] }, confirmacao: true });
  const fila = await t.ok('gestor@hs.com', 'listarCasos', { escopo: 'validacao', filtros: { empresa_id: A.empresa.id } });
  await t.ok('gestor@hs.com', 'validarCaso', { caso_ids: fila.itens.map((c) => c.id), aprovado: true });
  const caso = await t.ok('gestor@hs.com', 'atribuirCaso', { caso_id: fila.itens[0].id, operador_id: t.op1.id });
  const neg = await t.ok('op1@hs.com', 'proporNegociacao', { caso_id: caso.id, desconto_bps: 1000, entrada_centavos: 15000, quantidade_parcelas: 2, primeira_data_vencimento: '2026-12-10', data_entrada: '2026-11-14' });
  const r = await t.ok('op1@hs.com', 'formalizarAcordo', { negociacao_id: neg.id, aceite_devedor: true, meio_aceite: 'WHATSAPP', data_aceite: '2026-11-11' });
  const parcelas = (await t.db.Parcela.filter({ acordo_id: r.acordo.id })).sort((a, b) => a.numero - b.numero);
  return { t, A, caso, acordo: r.acordo, parcelas };
}

test('acordo da cobrança gerenciada pede ao credor o boleto ou o Pix; credor informa e o operador é avisado', async () => {
  const { t, A, caso, acordo, parcelas } = await montarAcordo();
  const aviso = (await t.db.Notificacao.filter({ empresa_id: A.empresa.id })).find((n) => n.tipo === 'BOLETOS_PENDENTES');
  assert.match(aviso.titulo, /Acordo com Devedor A0: envie os boletos ou o Pix/);
  let pend = await t.ok(A.fin, 'boletosPendentes');
  assert.equal(pend[0].parcelas_sem_pagamento, 3);

  // regras de quem informa e validações
  await t.falha('op1@hs.com', 'salvarPagamentoParcela', { parcela_id: parcelas[0].id, linha_digitavel: LINHA }, 403);
  await t.falha(t.empresas.B.adm, 'salvarPagamentoParcela', { parcela_id: parcelas[0].id, linha_digitavel: LINHA }, 404);
  assert.match((await t.falha(A.fin, 'salvarPagamentoParcela', { parcela_id: parcelas[0].id, linha_digitavel: '123' }, 422)).error, /Linha digitável inválida/);
  assert.match((await t.falha(A.fin, 'salvarPagamentoParcela', { parcela_id: parcelas[0].id }, 422)).error, /Anexe o boleto/);
  assert.match((await t.falha(A.fin, 'salvarPagamentoParcela', { parcela_id: parcelas[0].id, linha_digitavel: LINHA, aplicar_todas: true }, 422)).error, /Boletos são individuais/);

  await t.ok(A.fin, 'salvarPagamentoParcela', { parcela_id: parcelas[0].id, linha_digitavel: LINHA, arquivo_uri: 'arq_boleto1', arquivo_nome: 'boleto-entrada.pdf' });
  assert.ok((await t.db.Notificacao.filter({ usuario_id: t.op1.id })).some((n) => n.tipo === 'BOLETO_DISPONIVEL'));
  const r = await t.ok(A.adm, 'salvarPagamentoParcela', { parcela_id: parcelas[1].id, pix_copia_cola: PIX, aplicar_todas: true });
  assert.equal(r.registradas, 3, 'Pix para todas as parcelas em aberto (substitui a da entrada)');
  pend = await t.ok(A.fin, 'boletosPendentes');
  assert.equal(pend.length, 0);
  const lista = await t.ok('op1@hs.com', 'pagamentosDoAcordo', { acordo_id: acordo.id });
  assert.equal(lista.length, 3);
  assert.equal(lista[0].forma.tipo, 'PIX');
  assert.equal(lista[0].substituicoes, 1, 'o boleto da entrada fica no histórico');
  await t.falha('op2@hs.com', 'pagamentosDoAcordo', { acordo_id: acordo.id }, 404);
  assert.ok(caso);
});

test('operador envia ao devedor: WhatsApp com linha digitável e link do boleto; e-mail com o PDF anexado', async () => {
  const { t, A, parcelas } = await montarAcordo();
  t.estado.extras.urlBase = 'https://acorly.com.br';
  t.estado.extras.files = { signedUrl: async (uri, seg) => `/arquivos/${uri}?exp=${seg}&sig=x`, reivindicar: async () => true, conteudo: async () => ({ buffer: Buffer.from('%PDF-1.4'), mime: 'application/pdf' }) };
  await t.falha('op1@hs.com', 'enviarPagamentoParcela', { parcela_id: parcelas[0].id, canal: 'WHATSAPP' }, 422);
  await t.ok(A.fin, 'salvarPagamentoParcela', { parcela_id: parcelas[0].id, linha_digitavel: LINHA, arquivo_uri: 'arq_b1', arquivo_nome: 'boleto.pdf' });
  const w = await t.ok('op1@hs.com', 'enviarPagamentoParcela', { parcela_id: parcelas[0].id, canal: 'WHATSAPP' });
  assert.match(w.mensagem, /Valor: R\$\s150,00/);
  assert.match(w.mensagem, /Vencimento: 14\/11\/2026/);
  assert.match(w.mensagem, /Linha digitável do boleto: 2379338128600000000030000000040018434000001500|Linha digitável do boleto: \d{47}/);
  assert.match(w.mensagem, /Boleto em PDF: https:\/\/acorly\.com\.br\/arquivos\/arq_b1/);
  assert.match(w.link, /^https:\/\/wa\.me\/5511988887777\?text=/);
  const enviados = [];
  t.estado.extras.email = { cobrancaDisponivel: true, paraDevedor: async (o) => { enviados.push(o); return { ok: true }; } };
  const e = await t.ok('op1@hs.com', 'enviarPagamentoParcela', { parcela_id: parcelas[0].id, canal: 'EMAIL' });
  assert.equal(e.anexou_boleto, true);
  assert.equal(enviados[0].anexos.length, 1);
  assert.equal(enviados[0].anexos[0].nome, 'boleto.pdf');
  assert.match(enviados[0].assunto, /^Entrada do seu acordo com Loja A: vencimento 14\/11\/2026/);
  assert.match(enviados[0].texto, /O boleto está anexado/);
  await t.falha(A.adm, 'enviarPagamentoParcela', { parcela_id: parcelas[0].id, canal: 'WHATSAPP' }, 422);

  // o lembrete automático da parcela leva os dados de pagamento
  const lembretes = [];
  const sys = { db: t.db, now: () => t.estado.agora, user: SISTEMA, authEmail: 'sistema', aposConfirmar: [], urlBase: 'https://acorly.com.br', files: t.estado.extras.files, email: { cobrancaDisponivel: true, paraDevedor: async (o) => { lembretes.push(o); return { ok: true }; } } };
  assert.equal(await lembretesParcelas(sys), 1);
  assert.match(lembretes[0].texto, /Linha digitável do boleto/);
  assert.match(lembretes[0].texto, /Boleto em PDF: https:\/\/acorly\.com\.br/);
});

// ---------- Pix automático com a chave do credor ----------
import { crc16, brCodePix, normalizarChavePix } from '../src/core/pix.js';
import { pagamentoPublico } from '../src/app/actions/boletos.js';

test('BR Code do Pix: CRC do exemplo oficial do Banco Central, chaves e campos', () => {
  assert.equal(crc16('00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304'), '1D3D');
  assert.deepEqual(normalizarChavePix('37.573.934/0001-22'), { tipo: 'CNPJ', chave: '37573934000122' });
  assert.deepEqual(normalizarChavePix('(71) 92005-4062'), { tipo: 'TELEFONE', chave: '+5571920054062' });
  assert.deepEqual(normalizarChavePix('Financeiro@Escola.com.br'), { tipo: 'EMAIL', chave: 'financeiro@escola.com.br' });
  assert.throws(() => normalizarChavePix('123'), /não reconhecida/);
  const c = brCodePix({ chave: '37573934000122', nome: 'Colégio São João Ação Ltda', cidade: 'São Paulo', valorCentavos: 25000, txid: 'ACPAR1' });
  assert.ok(c.startsWith('000201'));
  assert.match(c, /0014br\.gov\.bcb\.pix011437573934000122/);
  assert.match(c, /5406250\.00/);
  assert.match(c, /5925COLEGIO SAO JOAO ACAO LTD6009/, 'nome sem acentos, em maiúsculas, até 25 letras');
  assert.match(c, /6009SAO PAULO/);
  assert.equal(c.slice(-4), crc16(c.slice(0, -4)));
});

test('Pix automático: com a chave cadastrada, cada parcela ganha o Pix na conta do credor e a página pública de pagamento', async () => {
  const t = await cenario();
  const A = t.empresas.A;
  t.estado.extras.urlBase = 'https://acorly.com.br';
  await t.falha(A.fin, 'salvarRecebimentoPix', { chave: '37573934000122', nome: 'Loja A', cidade: 'Salvador' }, 403);
  await t.falha(A.adm, 'salvarRecebimentoPix', { chave: '999', nome: 'Loja A', cidade: 'Salvador' }, 422);
  const cfg = await t.ok(A.adm, 'salvarRecebimentoPix', { chave: '37.573.934/0001-22', nome: 'Loja A', cidade: 'Salvador' });
  assert.equal(cfg.tipo, 'CNPJ');
  assert.match(cfg.teste, /54040\.01/, 'código de teste de R$ 0,01');

  await t.ok(A.adm, 'encaminharParaHS', { tipo_selecao: 'DIVIDAS', divida_ids: [A.dividas[0].id], contrato_servico_id: A.contrato.id, autorizacao: { ...AUTORIZACAO, canais_autorizados: ['WHATSAPP', 'EMAIL'] }, confirmacao: true });
  const fila = await t.ok('gestor@hs.com', 'listarCasos', { escopo: 'validacao', filtros: { empresa_id: A.empresa.id } });
  await t.ok('gestor@hs.com', 'validarCaso', { caso_ids: fila.itens.map((c) => c.id), aprovado: true });
  const caso = await t.ok('gestor@hs.com', 'atribuirCaso', { caso_id: fila.itens[0].id, operador_id: t.op1.id });
  const neg = await t.ok('op1@hs.com', 'proporNegociacao', { caso_id: caso.id, desconto_bps: 1000, entrada_centavos: 15000, quantidade_parcelas: 2, primeira_data_vencimento: '2026-12-10', data_entrada: '2026-11-14' });
  const { acordo } = await t.ok('op1@hs.com', 'formalizarAcordo', { negociacao_id: neg.id, aceite_devedor: true, meio_aceite: 'WHATSAPP', data_aceite: '2026-11-11' });
  assert.ok(!(await t.db.Notificacao.filter({ empresa_id: A.empresa.id })).some((n) => n.tipo === 'BOLETOS_PENDENTES'), 'com Pix automático, o credor não precisa informar nada');
  assert.equal((await t.ok(A.fin, 'boletosPendentes')).length, 0);

  let lista = await t.ok('op1@hs.com', 'pagamentosDoAcordo', { acordo_id: acordo.id });
  assert.equal(lista.length, 3);
  assert.ok(lista.every((p) => p.forma?.automatico && p.forma.tipo === 'PIX' && p.forma.pagina?.startsWith('/pagar/')));
  assert.match(lista[0].forma.pix_copia_cola, /5406150\.00/, 'entrada de R$ 150,00');

  const w = await t.ok('op1@hs.com', 'enviarPagamentoParcela', { parcela_id: lista[0].id, canal: 'WHATSAPP' });
  assert.match(w.mensagem, /Pix copia e cola:\n000201/);
  assert.match(w.mensagem, /QR Code e versão para imprimir: https:\/\/acorly\.com\.br\/pagar\/[a-z0-9]+/);

  // página pública: sem dados pessoais do devedor
  const token = lista[0].forma.pagina.split('/').pop();
  const sys = { db: t.db, now: () => t.estado.agora, user: SISTEMA, authEmail: 'sistema', aposConfirmar: [] };
  const pub = await pagamentoPublico(sys, token);
  assert.equal(pub.situacao, 'ABERTA');
  assert.equal(pub.descricao, 'Entrada do acordo');
  assert.equal(pub.valor_centavos, 15000);
  assert.ok(pub.pix_copia_cola.startsWith('000201'));
  assert.ok(!JSON.stringify(pub).includes('Devedor A0'), 'não expõe o devedor');
  assert.equal(await pagamentoPublico(sys, 'naoexiste12345'), null);

  // valor muda (pagamento parcial): o Pix é refeito com o novo valor e o link continua o mesmo
  await t.db.Parcela.update(lista[1].id, { saldo_centavos: 10000 });
  lista = await t.ok('op1@hs.com', 'pagamentosDoAcordo', { acordo_id: acordo.id });
  assert.match(lista[1].forma.pix_copia_cola, /5406100\.00/);
  assert.equal(lista[1].substituicoes, 1);
  const token2 = lista[1].forma.pagina;
  await t.db.Parcela.update(lista[1].id, { saldo_centavos: 9000 });
  lista = await t.ok('op1@hs.com', 'pagamentosDoAcordo', { acordo_id: acordo.id });
  assert.equal(lista[1].forma.pagina, token2, 'mesmo link para o devedor');

  // forma informada à mão pelo credor prevalece e não é sobrescrita
  await t.ok(A.fin, 'salvarPagamentoParcela', { parcela_id: lista[2].id, linha_digitavel: LINHA });
  lista = await t.ok('op1@hs.com', 'pagamentosDoAcordo', { acordo_id: acordo.id });
  assert.equal(lista[2].forma.tipo, 'BOLETO');
  assert.ok(!lista[2].forma.automatico);

  // parcela paga: a página mostra que já foi paga e não exibe mais o código
  await t.db.Parcela.update(lista[0].id, { saldo_centavos: 0, status: 'PAGA' });
  const paga = await pagamentoPublico(sys, token);
  assert.equal(paga.situacao, 'PAGA');
  assert.equal(paga.pix_copia_cola, null);
});
