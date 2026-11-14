import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario, casosHS } from './helpers.js';
import { prestacoesAutomaticas } from '../src/app/lembretes.js';

const SISTEMA = { id: 'sistema', nome: 'Sistema', email: 'sistema', perfil: 'SISTEMA', status: 'ATIVO' };

async function comAcordo() {
  const t = await cenario();
  const A = t.empresas.A;
  const [c1, c2] = await casosHS(t, 'A', [0, 1]);
  const neg = await t.ok('op1@hs.com', 'proporNegociacao', { caso_id: c1.id, desconto_bps: 1000, entrada_centavos: 15000, quantidade_parcelas: 3, primeira_data_vencimento: '2026-12-10', data_entrada: '2026-11-11' });
  await t.ok('op1@hs.com', 'formalizarAcordo', { negociacao_id: neg.id, aceite_devedor: true, meio_aceite: 'WHATSAPP', data_aceite: '2026-11-11' });
  const entrada = (await t.db.Parcela.filter({ divida_id: A.dividas[0].id })).find((p) => p.acordo_id && p.numero === 0);
  const pag = await t.ok('op1@hs.com', 'informarPagamento', { caso_id: c1.id, parcela_id: entrada.id, valor_centavos: 15000, data_informada: '2026-11-11' });
  await t.ok(A.fin, 'confirmarPagamento', { pagamento_id: pag.id });
  return { t, A, c1, c2 };
}

test('prestação de contas: recuperado, acordos, parcelas a receber e casos em cobrança', async () => {
  const { t, A } = await comAcordo();
  const p = await t.ok('super@hs.com', 'gerarPrestacaoContas', { contrato_servico_id: A.contrato.id, periodo_inicio: '2026-11-01', periodo_fim: '2026-11-30' });
  const r = JSON.parse(p.relatorio);
  assert.equal(r.valor_recuperado_centavos, 15000);
  assert.equal(r.recuperado_acumulado_centavos, 15000);
  assert.equal(r.comissoes.length, 1);
  assert.equal(r.acordos.length, 1);
  const ac = r.acordos[0];
  assert.equal(ac.devedor, 'Devedor A0');
  assert.equal(ac.parcelas_total, 4);
  assert.equal(ac.parcelas_pagas, 1);
  assert.equal(ac.pago_centavos, 15000);
  assert.equal(ac.a_receber_centavos, ac.valor_acordado_centavos - 15000);
  assert.equal(ac.proximo_vencimento, '2026-12-10');
  assert.equal(r.a_receber.length, 3);
  assert.equal(r.a_receber_centavos, ac.a_receber_centavos);
  assert.deepEqual(r.a_receber_por_mes.map((m) => m.mes), ['2026-12', '2027-01', '2027-02']);
  assert.equal(r.em_cobranca.length, 1, 'o outro caso segue em cobrança');
  assert.equal(r.em_cobranca[0].devedor, 'Devedor A1');
  assert.equal(r.saldo_em_cobranca_centavos, 100000);
  assert.equal(p.enviado_em, undefined, 'sem "enviar", só gera');
});

test('prestação de contas: envio ao admin e financeiro, e geração automática no dia 1º sem duplicar', async () => {
  const { t, A } = await comAcordo();
  const p = await t.ok('super@hs.com', 'gerarPrestacaoContas', { contrato_servico_id: A.contrato.id, periodo_inicio: '2026-11-01', periodo_fim: '2026-11-30', enviar: true });
  assert.ok(p.enviado_em);
  assert.deepEqual(p.enviado_para.sort(), ['admin@a.com', 'fin@a.com']);
  const avisos = (await t.db.Notificacao.filter({ empresa_id: A.empresa.id })).filter((n) => n.tipo === 'PRESTACAO_CONTAS');
  assert.equal(avisos.length, 2);
  assert.equal(avisos[0].titulo, 'Prestação de contas de novembro/2026');
  assert.match(avisos[0].mensagem, /Recuperado no período: R\$\s150,00/);
  assert.match(avisos[0].mensagem, /A receber em acordos: R\$/);
  await t.falha(A.adm, 'enviarPrestacaoContas', { prestacao_id: p.id }, 403);

  const sys = () => ({ db: t.db, now: () => t.estado.agora, user: SISTEMA, authEmail: 'sistema', aposConfirmar: [] });
  t.estado.agora = new Date('2026-12-01T03:30:00Z'); // 1º de dezembro, 0h30 em Brasília
  assert.equal(await prestacoesAutomaticas(sys()), 1, 'A já tinha a de novembro; só B é gerada');
  const doB = await t.db.PrestacaoContas.filter({ empresa_id: t.empresas.B.empresa.id });
  assert.equal(doB.length, 1);
  assert.equal(doB[0].periodo_inicio, '2026-11-01');
  assert.ok(doB[0].enviado_em);
  t.estado.agora = new Date('2026-12-01T15:00:00Z');
  assert.equal(await prestacoesAutomaticas(sys()), 0, 'não repete no mesmo dia');
  t.estado.agora = new Date('2026-12-02T15:00:00Z');
  assert.equal(await prestacoesAutomaticas(sys()), 0, 'só no dia 1º');
  const manual = await t.ok('super@hs.com', 'gerarPrestacoesDoMes', { mes: '2026-11' });
  assert.deepEqual([manual.geradas, manual.ja_existiam], [0, 2]);
});
