import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularInadimplencia } from '../src/core/calculadora.js';

test('calculadora do site: valor parado vem só dos números informados; recuperação é simulação', () => {
  const r = calcularInadimplencia({ alunos: 300, mensalidadeCentavos: 85000, percentualAtraso: 10, faixa: 'ate180', percentualRecuperado: 30 });
  assert.equal(r.inadimplentes, 30);
  assert.equal(r.por_mes_centavos, 30 * 85000, 'mensalidades que deixam de entrar por mês');
  assert.equal(r.parado_centavos, Math.round(30 * 85000 * 4.5));
  assert.equal(r.recuperado_centavos, Math.round(r.parado_centavos * 0.3));
  assert.equal(r.comissao_piloto_centavos, Math.round(r.recuperado_centavos * 0.1));
  assert.equal(r.liquido_piloto_centavos, r.recuperado_centavos - r.comissao_piloto_centavos);
  assert.equal(r.comissao_tabela_centavos, Math.round(r.recuperado_centavos * 0.15), 'faixa de 3 a 6 meses: 15%');
  const vazio = calcularInadimplencia({ alunos: 'abc', mensalidadeCentavos: -5, percentualAtraso: 500, faixa: 'x', percentualRecuperado: 50 });
  assert.equal(vazio.parado_centavos, 0);
  assert.equal(vazio.faixa.id, 'ate90');
});
