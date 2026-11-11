import assert from 'node:assert/strict';
import { handle } from '../src/app/router.js';
import { ENTITIES } from '../src/schema/entities.mjs';

/** Banco em memória com a mesma interface usada pelo adaptador Base44 (filter/create/update/delete). */
export function fakeDB() {
  const tables = {};
  let seq = 0;
  const handler = (name) => {
    tables[name] ??= new Map();
    const t = tables[name];
    return {
      async filter(q = {}) {
        return [...t.values()].filter((r) => Object.entries(q).every(([k, v]) => r[k] === v)).map((r) => structuredClone(r));
      },
      async create(d) {
        const id = `${name.slice(0, 3).toLowerCase()}_${String(++seq).padStart(6, '0')}`;
        const rec = { ...structuredClone(d), id, created_date: new Date(Date.UTC(2026, 10, 11, 14, 0, 0, seq)).toISOString() };
        t.set(id, rec);
        return structuredClone(rec);
      },
      async update(id, d) {
        const r = t.get(id);
        if (!r) throw new Error('not found ' + id);
        Object.assign(r, structuredClone(d));
        return structuredClone(r);
      },
      async delete(id) { t.delete(id); },
    };
  };
  const db = new Proxy({}, {
    get(_, name) {
      if (name === '__tables') return tables;
      if (!ENTITIES[name]) throw new Error(`Entidade inexistente no esquema: ${String(name)}`);
      return handler(name);
    },
  });
  return db;
}

export const AGORA = new Date('2026-11-11T14:00:00Z'); // quarta-feira, 11h em Brasília

export function cpf(seed) {
  const base = String(100000000 + seed * 7919).slice(0, 9).split('').map(Number);
  const dv = (arr) => { const s = arr.reduce((a, d, i) => a + d * (arr.length + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  base.push(dv(base)); base.push(dv(base));
  return base.join('');
}

export function cnpj(seed) {
  const base = String(10000000 + seed * 104729).slice(0, 8).split('').map(Number).concat([0, 0, 0, 1]);
  const calc = (arr) => { const pesos = arr.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const r = arr.reduce((a, d, i) => a + d * pesos[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
  base.push(calc(base)); base.push(calc(base));
  return base.join('');
}

export function app() {
  const db = fakeDB();
  const signed = [];
  const estado = { agora: AGORA, extras: {} };
  async function as(email, action, payload = {}) {
    const perfis = await db.UsuarioPlataforma.filter({ email });
    const ctx = { db, user: perfis[0] || null, authEmail: email, authName: email, now: () => estado.agora, files: { signedUrl: async (uri) => { signed.push(uri); return `https://signed/${uri}`; } }, invite: async () => {}, ...estado.extras };
    return handle(ctx, action, payload);
  }
  async function ok(email, action, payload) {
    const r = await as(email, action, payload);
    assert.equal(r.status, 200, `${action} por ${email} falhou: ${JSON.stringify(r.body)}`);
    return r.body.data;
  }
  async function falha(email, action, payload, status) {
    const r = await as(email, action, payload);
    assert.notEqual(r.status, 200, `${action} por ${email} deveria falhar`);
    if (status) assert.equal(r.status, status, `${action}: esperado ${status}, veio ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }
  return { db, as, ok, falha, signed, estado };
}

/** Cenário completo: HS (superadmin, gestor, 2 operadores) + empresas A e B com usuários, contrato e dívidas. */
export async function cenario() {
  const t = app();
  const { db, ok } = t;
  await db.UsuarioPlataforma.create({ nome: 'Super', email: 'super@hs.com', perfil: 'SUPERADMIN_HS', empresa_id: null, status: 'ATIVO' });
  await ok('super@hs.com', 'seedPlanos');
  await ok('super@hs.com', 'convidarUsuario', { nome: 'Gestor', email: 'gestor@hs.com', perfil: 'GESTOR_OPERACOES_HS' });
  const op1 = await ok('super@hs.com', 'convidarUsuario', { nome: 'Op1', email: 'op1@hs.com', perfil: 'OPERADOR_HS', capacidade_casos: 2, alcada_desconto_bps: 2000 });
  const op2 = await ok('super@hs.com', 'convidarUsuario', { nome: 'Op2', email: 'op2@hs.com', perfil: 'OPERADOR_HS', capacidade_casos: 2 });

  const empresas = {};
  for (const [k, seed] of [['A', 1], ['B', 2]]) {
    const adm = `admin@${k.toLowerCase()}.com`;
    const { empresa } = await ok(adm, 'registrarEmpresa', {
      razao_social: `Empresa ${k} Ltda`, nome_fantasia: `Loja ${k}`, cnpj: cnpj(seed), email: `contato@${k.toLowerCase()}.com.br`, telefone: '11999990000',
      endereco: 'Rua X, 1', responsavel_legal: 'Fulano', admin_nome: `Admin ${k}`, aceite_termos: true, aceite_privacidade: true,
    });
    await ok(adm, 'escolherServico', { modalidade_servico: 'AMBOS', tipo_carteira: 'CARTEIRA_SELECIONADA' });
    await ok('super@hs.com', 'alterarStatusEmpresa', { empresa_id: empresa.id, status: 'ATIVA', motivo: 'Documentação conferida' });
    await ok(adm, 'convidarUsuario', { nome: `Fin ${k}`, email: `fin@${k.toLowerCase()}.com`, perfil: 'FINANCEIRO_EMPRESA' });
    await ok(adm, 'convidarUsuario', { nome: `Vis ${k}`, email: `vis@${k.toLowerCase()}.com`, perfil: 'VISUALIZADOR_EMPRESA' });
    const contrato = await ok('super@hs.com', 'salvarContrato', { empresa_id: empresa.id, modalidade: 'CARTEIRA_ESPECIFICA', valor_contratado_centavos: 50000, data_inicio: '2026-11-01', data_fim: '2027-10-31' });
    await ok(adm, 'aceitarContrato', { contrato_id: contrato.id, aceite: true });
    const devedores = [], dividas = [];
    for (let i = 0; i < 3; i++) {
      const dev = await ok(adm, 'salvarDevedor', { nome: `Devedor ${k}${i}`, tipo_pessoa: 'PF', cpf_cnpj: cpf(seed * 10 + i), whatsapp: '11988887777', email: `d${i}@x.com` });
      const div = await ok(adm, 'salvarDivida', { devedor_id: dev.id, descricao: 'Mensalidade', documento_referencia: `NF-${k}${i}`, valor_original_centavos: 100000, encargos_centavos: 0, data_vencimento: '2026-08-10' });
      await ok(adm, 'anexarDocumento', { divida_id: div.id, file_uri: `private/${k}/nf${i}.pdf`, nome_arquivo: `nf${i}.pdf`, tipo_documento: 'NOTA_FISCAL' });
      devedores.push(dev); dividas.push(div);
    }
    empresas[k] = { empresa, contrato, devedores, dividas, adm, fin: `fin@${k.toLowerCase()}.com`, vis: `vis@${k.toLowerCase()}.com` };
  }
  return { ...t, empresas, op1, op2 };
}

export const AUTORIZACAO = { limite_desconto_bps: 3000, limite_parcelamento: 6, entrada_minima_bps: 1000, canais_autorizados: ['WHATSAPP', 'TELEFONE'] };

/** Encaminha dívidas da empresa à HS, valida e atribui ao op1. Retorna os casos. */
export async function casosHS(t, k = 'A', idx = [0]) {
  const E = t.empresas[k];
  await t.ok(E.adm, 'encaminharParaHS', { tipo_selecao: 'DIVIDAS', divida_ids: idx.map((i) => E.dividas[i].id), contrato_servico_id: E.contrato.id, autorizacao: AUTORIZACAO, confirmacao: true });
  const fila = await t.ok('gestor@hs.com', 'listarCasos', { escopo: 'validacao', filtros: { empresa_id: E.empresa.id } });
  await t.ok('gestor@hs.com', 'validarCaso', { caso_ids: fila.itens.map((c) => c.id), aprovado: true });
  const casos = [];
  for (const c of fila.itens) casos.push(await t.ok('gestor@hs.com', 'atribuirCaso', { caso_id: c.id, operador_id: t.op1.id }));
  return casos;
}
