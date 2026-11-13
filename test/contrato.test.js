import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario, casosHS, AGORA } from './helpers.js';
import { confirmarPorDecursoDePrazo } from '../src/app/actions/pagamentos.js';
import { hashTexto } from '../src/core/contrato.js';

const SISTEMA = { id: 'sistema', nome: 'Sistema', email: 'sistema', perfil: 'SISTEMA', status: 'ATIVO' };

test('contrato de cobrança: minuta com os dados da empresa, aceite guarda texto, hash, quem aceitou e IP', async () => {
  const t = await cenario();
  const { A, B } = t.empresas;
  const novo = await t.ok('super@hs.com', 'salvarContrato', { empresa_id: A.empresa.id, modalidade: 'CARTEIRA_COMPLETA', valor_contratado_centavos: 0, data_inicio: '2026-11-11' });
  const minuta = await t.ok(A.adm, 'textoContrato', { contrato_id: novo.id });
  assert.equal(minuta.aceito, false);
  assert.deepEqual(minuta.pendencias, []);
  assert.match(minuta.texto, /HS RECUPERAÇÃO DE CRÉDITO, CNPJ 37\.573\.934\/0001-22/);
  assert.match(minuta.texto, /CONTRATANTE: Empresa A Ltda, CNPJ \d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
  assert.match(minuta.texto, /não garante o recebimento/);
  assert.match(minuta.texto, /• Até 90 dias de atraso: 10%\n• 91 a 180 dias de atraso: 15%/);
  assert.match(minuta.texto, /não há valor fixo/);
  await t.falha(B.adm, 'textoContrato', { contrato_id: novo.id }, 404);
  await t.falha(A.vis, 'aceitarContrato', { contrato_id: novo.id, aceite: true }, 403);

  t.estado.extras.ip = '203.0.113.7';
  await t.ok(A.adm, 'aceitarContrato', { contrato_id: novo.id, aceite: true });
  const aceito = await t.ok(A.adm, 'textoContrato', { contrato_id: novo.id });
  assert.equal(aceito.aceito, true);
  assert.match(aceito.texto, /Admin A \(admin@a\.com\), em nome de Empresa A Ltda, em .*IP 203\.0\.113\.7/);
  assert.equal(aceito.hash, await hashTexto(aceito.texto));
  assert.equal(aceito.versao, 'cobranca-v1');
  // o texto aceito não muda se os dados da empresa mudarem depois
  await t.db.Empresa.update(A.empresa.id, { endereco: 'Outro endereço' });
  assert.equal((await t.ok(A.adm, 'textoContrato', { contrato_id: novo.id })).texto, aceito.texto);
});

test('contrato: aceite exige endereço e responsável legal da empresa', async () => {
  const t = await cenario();
  const { B } = t.empresas;
  const novo = await t.ok('super@hs.com', 'salvarContrato', { empresa_id: B.empresa.id, modalidade: 'CARTEIRA_COMPLETA', valor_contratado_centavos: 9900, forma_cobranca_servico: 'MENSAL', data_inicio: '2026-11-11' });
  await t.db.Empresa.update(B.empresa.id, { responsavel_legal: '' });
  assert.deepEqual((await t.ok(B.adm, 'textoContrato', { contrato_id: novo.id })).pendencias, ['responsável legal']);
  const r = await t.falha(B.adm, 'aceitarContrato', { contrato_id: novo.id, aceite: true }, 422);
  assert.match(r.error, /responsável legal/);
  await t.db.Empresa.update(B.empresa.id, { responsavel_legal: 'Beltrano' });
  await t.ok(B.adm, 'aceitarContrato', { contrato_id: novo.id, aceite: true });
  assert.match((await t.ok(B.adm, 'textoContrato', { contrato_id: novo.id })).texto, /Valor fixo combinado: R\$\s99,00 \(mensal\)/);
});

test('cláusula 3.3: pagamento com comprovante não conferido em 5 dias úteis vira confirmado (com comissão)', async () => {
  const t = await cenario();
  const { A } = t.empresas;
  const [caso] = await casosHS(t, 'A', [0]);
  const comComprovante = await t.ok('op1@hs.com', 'informarPagamento', { caso_id: caso.id, valor_centavos: 30000, data_informada: '2026-11-11', comprovante_file_uri: 'private/A/comp1.pdf' });
  await t.ok('op1@hs.com', 'informarPagamento', { caso_id: caso.id, valor_centavos: 1000, data_informada: '2026-11-11', identificador_transacao: 'sem-comprovante' });
  const lista = await t.ok(A.fin, 'listarPagamentos', {});
  assert.equal(lista.itens.find((p) => p.id === comComprovante.id).confirmar_ate.slice(0, 16), '2026-11-18T14:00', 'quarta + 5 dias úteis');
  const sys = () => ({ db: t.db, now: () => t.estado.agora, user: SISTEMA, authEmail: 'sistema', aposConfirmar: [] });
  t.estado.agora = new Date('2026-11-17T14:00:00Z');
  assert.equal((await confirmarPorDecursoDePrazo(sys())).confirmados, 0, 'ainda no prazo');
  t.estado.agora = new Date('2026-11-18T15:00:00Z');
  assert.equal((await confirmarPorDecursoDePrazo(sys())).confirmados, 1, 'só o que tem comprovante');
  const pag = await t.db.Pagamento.filter({ id: comComprovante.id });
  assert.equal(pag[0].status_confirmacao, 'CONFIRMADO');
  assert.equal(pag[0].confirmado_por_decurso, true);
  assert.ok(pag[0].comissao_hs_centavos > 0);
  assert.equal((await confirmarPorDecursoDePrazo(sys())).confirmados, 0, 'não repete');
  assert.ok(AGORA);
});
