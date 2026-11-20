import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, cenario, AUTORIZACAO } from './helpers.js';
import { avisosPilotos } from '../src/app/actions/resultados.js';

const S = 'super@hs.com';

test('diagnóstico: prévia e envio ao cliente com os números da planilha; pedido vira "Diagnóstico enviado"', async () => {
  const t = app();
  await t.db.UsuarioPlataforma.create({ nome: 'Hugo Sousa', email: S, perfil: 'SUPERADMIN_HS', empresa_id: null, status: 'ATIVO' });
  const enviados = [];
  t.estado.extras.email = { comercial: async (m) => { enviados.push(m); return { ok: true }; } };
  t.estado.extras.contato = { whatsapp: '71920054062' };
  const analise = { vencido_centavos: 1000000, atraso_medio_dias: 120, por_faixa: [{ faixa: 'até 180 dias', bps: 1000, quantidade: 8, valor_centavos: 600000 }, { faixa: 'acima de 180 dias', bps: 1500, quantidade: 4, valor_centavos: 400000 }] };
  const lead = await t.db.Lead.create({ nome: 'Ana Lima', empresa: 'Escola Alfa', email: 'ana@alfa.com.br', status: 'NOVO', analise: JSON.stringify(analise), proximo_followup: '2026-11-14' });
  const p = await t.ok(S, 'previaDiagnosticoLead', { id: lead.id, taxa_recuperacao: '25', prazo_dias: 90 });
  assert.equal(p.estimado_centavos, 250000);
  assert.equal(p.comissao_centavos, Math.round(250000 * 0.12));
  assert.match(p.assunto, /^Escola Alfa: diagnóstico gratuito, R\$ 2\.500,00 podem voltar/);
  assert.match(p.html, /Total em atraso:<\/strong> R\$ 10\.000,00 em 12 dívida/);
  assert.match(p.html, /não uma garantia de resultado/);
  assert.match(p.html, /wa\.me\/5571920054062/);
  assert.equal(enviados.length, 0, 'prévia não envia');
  await t.falha(S, 'previaDiagnosticoLead', { id: lead.id, taxa_recuperacao: '95' }, 422);
  const r = await t.ok(S, 'enviarDiagnosticoLead', { id: lead.id, taxa_recuperacao: '25', prazo_dias: 90, mensagem: 'Posso te ligar amanhã?' });
  assert.equal(enviados.length, 1);
  assert.match(enviados[0].html, /Posso te ligar amanhã\?/);
  const [l] = await t.db.Lead.filter({ id: lead.id });
  assert.equal(l.status, 'DIAGNOSTICO_ENVIADO');
  assert.equal(l.proximo_followup, null, 'cadência para');
  assert.equal(l.diagnostico_resumo.estimado_centavos, 250000);
  assert.ok(r.enviado_em);
  // sem planilha: usa o valor informado pela equipe
  const l2 = await t.db.Lead.create({ nome: 'Beto', empresa: 'Clínica Beta', email: 'b@beta.com.br', status: 'NOVO' });
  await t.falha(S, 'previaDiagnosticoLead', { id: l2.id }, 422);
  assert.equal((await t.ok(S, 'previaDiagnosticoLead', { id: l2.id, valor_em_atraso: '20.000,00', taxa_recuperacao: '20' })).estimado_centavos, 400000);
});

test('piloto: contrato com 20 casos, 30 dias e 10%; limite de casos; avisos de fim; resultados por faixa e funil', async () => {
  const t = await cenario();
  const { A } = t.empresas;
  await t.ok('super@hs.com', 'encerrarContrato', { contrato_id: A.contrato.id, motivo: 'troca pelo piloto' });
  const piloto = await t.ok('super@hs.com', 'salvarContrato', { empresa_id: A.empresa.id, modalidade: 'PILOTO', data_inicio: '2026-11-11' });
  assert.deepEqual([piloto.quantidade_casos_contratada, piloto.data_fim, piloto.valor_contratado_centavos], [20, '2026-12-10', 0]);
  assert.deepEqual(piloto.comissao_faixas, [{ ate_dias: null, bps: 1000 }]);
  assert.equal((await t.ok('super@hs.com', 'salvarContrato', { empresa_id: A.empresa.id, modalidade: 'PILOTO', data_inicio: '2026-11-11', quantidade_casos_contratada: 50 })).quantidade_casos_contratada, 20, 'no máximo 20');
  await t.ok(A.adm, 'aceitarContrato', { contrato_id: piloto.id, aceite: true });
  await t.ok(A.adm, 'encaminharParaHS', { tipo_selecao: 'DIVIDAS', divida_ids: [A.dividas[0].id, A.dividas[1].id], contrato_servico_id: piloto.id, autorizacao: AUTORIZACAO, confirmacao: true });
  const fila = await t.ok('gestor@hs.com', 'listarCasos', { escopo: 'validacao', filtros: { empresa_id: A.empresa.id } });
  await t.ok('gestor@hs.com', 'validarCaso', { caso_ids: fila.itens.map((c) => c.id), aprovado: true });
  const casos = [];
  for (const c of fila.itens) casos.push(await t.ok('gestor@hs.com', 'atribuirCaso', { caso_id: c.id, operador_id: t.op1.id }));
  assert.equal(casos[0].comissao_bps, 1000, '10% no piloto');
  // um pagamento confirmado
  await t.ok('op1@hs.com', 'registrarInteracao', { caso_id: casos[0].id, canal: 'WHATSAPP', tipo_interacao: 'MENSAGEM_ENVIADA', mensagem: 'Olá' });
  const pag = await t.ok('op1@hs.com', 'informarPagamento', { caso_id: casos[0].id, valor_centavos: 40000, data_informada: '2026-11-15' });
  await t.ok(A.fin, 'confirmarPagamento', { pagamento_id: pag.id, valor_confirmado_centavos: 40000 });
  // avisos: 5 dias antes e depois do fim
  const sys = { db: t.db, user: { id: 'sistema', perfil: 'SUPERADMIN_HS' }, now: () => t.estado.agora };
  assert.equal(await avisosPilotos(sys), 0);
  t.estado.agora = new Date('2026-12-06T14:00:00Z');
  assert.equal(await avisosPilotos(sys), 1);
  assert.equal(await avisosPilotos(sys), 0, 'uma vez');
  t.estado.agora = new Date('2026-12-11T14:00:00Z');
  assert.equal(await avisosPilotos(sys), 1);
  const ns = await t.db.Notificacao.filter({});
  assert.ok(ns.some((n) => /Piloto Sem Risco termina/.test(n.titulo) && n.empresa_id === A.empresa.id));
  assert.ok(ns.some((n) => /Piloto de Loja A terminou/.test(n.titulo) && /R\$ 400,00 recuperado/.test(n.mensagem)));
  // depois da vigência não entra caso novo no piloto
  await t.falha(A.adm, 'encaminharParaHS', { tipo_selecao: 'DIVIDAS', divida_ids: [A.dividas[2].id], contrato_servico_id: piloto.id, autorizacao: AUTORIZACAO, confirmacao: true });
  // resultados
  const r = await t.ok('super@hs.com', 'resultadosCobranca', {});
  const f = r.por_faixa.find((x) => x.faixa === '91 a 180 dias');
  assert.deepEqual([f.casos, f.recuperado_centavos, f.com_pagamento], [2, 40000, 1]);
  assert.equal(f.encaminhado_centavos, 200000);
  assert.equal(f.taxa_bps, 2000);
  assert.equal(r.tempo_primeiro_pagamento.casos, 1);
  assert.equal(r.funil.pilotos_iniciados, 1);
  const p = r.pilotos.find((x) => x.id === piloto.id);
  assert.deepEqual([p.casos, p.recuperado_centavos, p.comissao_centavos, p.limite], [2, 40000, 4000, 20]);
  await t.falha('gestor@hs.com', 'resultadosCobranca', {}, 403);
});
