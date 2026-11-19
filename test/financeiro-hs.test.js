import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from './helpers.js';
import { avisoContasPagar, garantirRecorrencias } from '../src/app/actions/financeiroHS.js';

const S = 'super@hs.com';
async function base() {
  const t = app();
  await t.db.UsuarioPlataforma.create({ nome: 'Hugo', email: S, perfil: 'SUPERADMIN_HS', empresa_id: null, status: 'ATIVO' });
  return t;
}
const sys = (t) => ({ db: t.db, user: { id: 'sistema', perfil: 'SUPERADMIN_HS' }, now: () => t.estado.agora });

test('lançamentos: despesa avulsa, recorrente (equipe) gera os meses sozinha, pagamento e cancelamento', async () => {
  const t = await base(); // hoje: 11/11/2026
  await t.ok(S, 'salvarLancamentoHS', { tipo: 'DESPESA', categoria: 'MARKETING', descricao: 'Anúncio Instagram', valor: '150,00', vencimento: '2026-11-05' });
  await t.ok(S, 'salvarLancamentoHS', { tipo: 'DESPESA', categoria: 'EQUIPE', descricao: 'Salário operadora', fornecedor: 'Olívia', valor: '2.000,00', vencimento: '2026-11-11', recorrente: true });
  await t.ok(S, 'salvarLancamentoHS', { tipo: 'DESPESA', categoria: 'INFRAESTRUTURA', descricao: 'Render Starter', valor: '40,00', vencimento: '2026-11-20', recorrente: true, pago_em: '2026-11-11' });
  await t.falha(S, 'salvarLancamentoHS', { tipo: 'DESPESA', categoria: 'XYZ', descricao: 'x', valor: '1', vencimento: '2026-11-01' }, 422);
  let l = await t.ok(S, 'listarLancamentosHS', { mes: '2026-11' });
  assert.equal(l.total, 3);
  assert.equal(l.totais.despesas_centavos, 219000);
  assert.equal(l.totais.pago_centavos, 4000);
  assert.ok(l.itens.find((x) => x.descricao === 'Anúncio Instagram').vencido);
  const dez = await t.ok(S, 'listarLancamentosHS', { mes: '2026-12' });
  assert.deepEqual(dez.itens.map((x) => [x.descricao, x.vencimento, x.status]), [['Salário operadora', '2026-12-11', 'PENDENTE'], ['Render Starter', '2026-12-20', 'PENDENTE']]);
  assert.equal(await garantirRecorrencias(sys(t)), 0, 'não duplica');
  // pagar e cancelar
  const anuncio = l.itens.find((x) => x.descricao === 'Anúncio Instagram');
  await t.ok(S, 'pagarLancamentoHS', { id: anuncio.id, pago_em: '2026-11-11', forma_pagamento: 'PIX' });
  await t.falha(S, 'pagarLancamentoHS', { id: anuncio.id, pago_em: '11/11' }, 422);
  l = await t.ok(S, 'listarLancamentosHS', { mes: '2026-11', status: 'VENCIDO' });
  assert.equal(l.total, 0);
  // reajuste do salário vale para os meses em aberto
  const [rec] = (await t.ok(S, 'listarRecorrenciasHS')).filter((r) => r.categoria === 'EQUIPE');
  await t.ok(S, 'salvarRecorrenciaHS', { id: rec.id, valor: '2.200,00' });
  assert.equal((await t.ok(S, 'listarLancamentosHS', { mes: '2026-12' })).itens.find((x) => x.categoria === 'EQUIPE').valor_centavos, 220000);
  await t.ok(S, 'salvarRecorrenciaHS', { id: rec.id, ativa: false });
  assert.equal((await t.ok(S, 'listarLancamentosHS', { mes: '2026-12' })).itens.filter((x) => x.categoria === 'EQUIPE').length, 0);
});

test('DRE: receitas automáticas (Asaas com taxa, comissão), impostos estimados pela alíquota, parceiros, fechamento trava o mês', async () => {
  const t = await base();
  await t.db.EventoAssinatura.create({ empresa_id: 'e1', tipo: 'PAYMENT_RECEIVED', origem: 'GATEWAY', data_hora: '2026-10-05T12:00:00Z', payload: JSON.stringify({ pagamento: 'p1', valor: 89.9, liquido: 87.91 }) });
  await t.db.EventoAssinatura.create({ empresa_id: 'e1', tipo: 'PAYMENT_CONFIRMED', origem: 'GATEWAY', data_hora: '2026-10-05T12:01:00Z', payload: JSON.stringify({ pagamento: 'p1', valor: 89.9, liquido: 87.91 }) });
  await t.db.Pagamento.create({ empresa_id: 'e1', status_confirmacao: 'CONFIRMADO', data_confirmacao: '2026-10-20T12:00:00Z', comissao_hs_centavos: 30000, valor_centavos: 200000 });
  await t.db.PagamentoParceiro.create({ parceiro_id: 'p', valor_centavos: 3000, pago_em: '2026-10-10' });
  await t.ok(S, 'configurarFinanceiroHS', { aliquota: '6' });
  await t.ok(S, 'salvarLancamentoHS', { tipo: 'DESPESA', categoria: 'EQUIPE', descricao: 'Pró-labore', valor: '1.000,00', vencimento: '2026-10-30', competencia: '2026-10' });
  await t.ok(S, 'salvarLancamentoHS', { tipo: 'DESPESA', categoria: 'INFRAESTRUTURA', descricao: 'Brevo', valor: '50,00', vencimento: '2026-10-15' });
  await t.ok(S, 'salvarLancamentoHS', { tipo: 'RECEITA', categoria: 'RECEITAS_FINANCEIRAS', descricao: 'Rendimento', valor: '10,00', vencimento: '2026-10-31', pago_em: '2026-10-31' });
  const d = await t.ok(S, 'dreMensal', { mes: '2026-10' });
  const v = (r) => d.linhas.find((x) => x.rotulo.startsWith(r)).valor_centavos;
  assert.equal(v('Receita bruta'), 8990 + 30000);
  assert.equal(v('Impostos sobre o faturamento (estimado: 6,00%)'), -Math.round(38990 * 0.06));
  assert.equal(v('Taxas de cobrança'), -199);
  assert.equal(v('Comissões de parceiros'), -3000);
  assert.equal(v('Equipe'), -100000);
  const esperado = 38990 - 2339 - 199 - 5000 - 3000 - 100000 + 1000;
  assert.equal(d.lucro_centavos, esperado);
  assert.equal(v('(=) Lucro líquido'), esperado);
  assert.equal(d.historico.length, 6);
  // imposto lançado substitui a estimativa
  await t.ok(S, 'salvarLancamentoHS', { tipo: 'DESPESA', categoria: 'IMPOSTOS', descricao: 'DAS outubro', valor: '2.000,00', vencimento: '2026-11-20', competencia: '2026-10' });
  assert.equal((await t.ok(S, 'dreMensal', { mes: '2026-10' })).linhas.find((x) => x.rotulo === 'Impostos sobre o faturamento').valor_centavos, -200000);
  // fechamento
  await t.falha(S, 'fecharMesHS', { mes: '2026-11' }, 422);
  await t.ok(S, 'fecharMesHS', { mes: '2026-10', observacao: 'Conferido' });
  await t.falha(S, 'salvarLancamentoHS', { tipo: 'DESPESA', categoria: 'MARKETING', descricao: 'Atrasado', valor: '10', vencimento: '2026-10-10' }, 422);
  const das = (await t.ok(S, 'listarLancamentosHS', { mes: '2026-10' })).itens.find((x) => x.descricao === 'DAS outubro');
  await t.ok(S, 'pagarLancamentoHS', { id: das.id, pago_em: '2026-11-11' }); // pagar pode, o DRE é por competência
  await t.falha(S, 'cancelarLancamentoHS', { id: das.id }, 422);
  const fechado = await t.ok(S, 'dreMensal', { mes: '2026-10' });
  assert.equal(fechado.fechado, true);
  await t.falha(S, 'reabrirMesHS', { mes: '2026-10', motivo: '' }, 422);
  await t.ok(S, 'reabrirMesHS', { mes: '2026-10', motivo: 'Faltou lançar uma nota' });
  await t.ok(S, 'salvarLancamentoHS', { tipo: 'DESPESA', categoria: 'MARKETING', descricao: 'Atrasado', valor: '10', vencimento: '2026-10-10' });
});

test('aviso diário de contas a pagar e acesso só do superadmin', async () => {
  const t = await base();
  await t.ok(S, 'salvarLancamentoHS', { tipo: 'DESPESA', categoria: 'ADMINISTRATIVO', descricao: 'Contador', valor: '300', vencimento: '2026-11-10' });
  await t.ok(S, 'salvarLancamentoHS', { tipo: 'DESPESA', categoria: 'INFRAESTRUTURA', descricao: 'Domínio', valor: '40', vencimento: '2026-11-11' });
  assert.equal(await avisoContasPagar(sys(t)), 2);
  assert.equal(await avisoContasPagar(sys(t)), 0, 'uma vez por dia');
  assert.ok((await t.db.Notificacao.filter({})).some((n) => /2 conta\(s\) a pagar \(1 vencida/.test(n.titulo)));
  const p = await t.ok(S, 'painelFinanceiroHS');
  assert.deepEqual([p.vencidas.qtd, p.hoje_pagar.qtd], [1, 1]);
  for (const perfil of ['GESTOR_OPERACOES_HS', 'OPERADOR_HS', 'MARKETING_HS']) {
    const email = `${perfil}@hs.com`;
    await t.db.UsuarioPlataforma.create({ nome: perfil, email, perfil, empresa_id: null, status: 'ATIVO' });
    await t.falha(email, 'painelFinanceiroHS', {}, 403);
    await t.falha(email, 'dreMensal', {}, 403);
  }
});
