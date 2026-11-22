// Regression: ISSUE-001 — formulário de diagnóstico vazio mostrava "Pedido recebido!" sem gravar nada
// Found by /qa on 2026-11-22
// Report: .gstack/qa-reports/qa-report-acorly.com.br-2026-11-22.md
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conferirPedidoDiagnostico, esperaAntiRobo, TEMPO_MINIMO_MS } from '../src/core/diagnostico.js';

const valido = { nome: 'Ana Souza', empresa: 'Colégio Exemplo', email: 'ana@colegio.com.br', whatsapp: '71999990000', aceite_privacidade: true };

test('pedido de diagnóstico: a mesma regra do servidor barra o envio no navegador', () => {
  assert.equal(conferirPedidoDiagnostico({}), 'Informe o seu nome');
  assert.equal(conferirPedidoDiagnostico({ ...valido, empresa: ' ' }), 'Informe o nome da empresa');
  assert.equal(conferirPedidoDiagnostico({ ...valido, email: 'ana@' }), 'Informe um e-mail válido');
  assert.equal(conferirPedidoDiagnostico({ ...valido, whatsapp: '9999' }), 'WhatsApp inválido: informe DDD e número');
  assert.equal(conferirPedidoDiagnostico({ ...valido, aceite_privacidade: false }), 'É preciso concordar com a Política de Privacidade');
  assert.equal(conferirPedidoDiagnostico(valido), null);
});

test('pedido de diagnóstico: quem preenche rápido (autopreenchimento) espera o mínimo em vez de ser descartado como robô', () => {
  assert.equal(esperaAntiRobo(1000, 1000 + 400), TEMPO_MINIMO_MS - 400 + 200);
  assert.equal(esperaAntiRobo(1000, 1000 + TEMPO_MINIMO_MS + 5000), 0);
});
