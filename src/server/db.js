// Armazenamento em SQLite (node:sqlite) com a interface usada pelas ações:
// db.Entidade.filter(query) / create(data) / update(id, patch) / delete(id).
// Cada requisição roda sozinha numa transação (BEGIN IMMEDIATE): atomicidade e sem corridas.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ENTITIES } from '../schema/entities.mjs';

export const ENTIDADES_INTERNAS = ['Conta', 'Sessao', 'Convite', 'Arquivo', 'Desafio2FA'];
const CAMPOS_INDEXADOS = ['externo_id', 'mensagem_externa_id', 'telefone_destino', 'gateway_assinatura_id', 'empresa_id', 'caso_id', 'divida_id', 'devedor_id', 'usuario_id', 'email', 'operador_id', 'pagamento_id', 'carteira_id', 'acordo_id', 'negociacao_id', 'contrato_servico_id', 'autorizacao_id', 'token_hash', 'file_uri', 'responsavel_id', 'cpf_cnpj'];
const CHAVE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function abrirBanco(arquivo) {
  if (arquivo !== ':memory:') mkdirSync(dirname(arquivo), { recursive: true });
  const sql = new DatabaseSync(arquivo);
  sql.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const nomes = [...Object.keys(ENTITIES), ...ENTIDADES_INTERNAS];
  for (const n of nomes) {
    sql.exec(`CREATE TABLE IF NOT EXISTS "${n}" (id TEXT PRIMARY KEY, created_date TEXT NOT NULL, updated_date TEXT NOT NULL, data TEXT NOT NULL)`);
    const props = ENTITIES[n]?.properties || {};
    for (const c of CAMPOS_INDEXADOS) {
      if (ENTITIES[n] && !(c in props)) continue;
      sql.exec(`CREATE INDEX IF NOT EXISTS "ix_${n}_${c}" ON "${n}" (json_extract(data, '$.${c}'))`);
    }
  }
  const stmts = new Map();
  const prep = (q) => { if (!stmts.has(q)) stmts.set(q, sql.prepare(q)); return stmts.get(q); };
  const toRow = (r) => r && { ...JSON.parse(r.data), id: r.id, created_date: r.created_date, updated_date: r.updated_date };
  const bind = (v) => (v === true ? 1 : v === false ? 0 : v);

  function handler(nome) {
    if (!nomes.includes(nome)) throw new Error(`Entidade inexistente: ${String(nome)}`);
    return {
      async filter(query = {}) {
        const where = [], vals = [];
        for (const [k, v] of Object.entries(query)) {
          if (!CHAVE.test(k)) throw new Error('Campo de filtro inválido');
          if (k === 'id') { where.push('id = ?'); vals.push(v); continue; }
          if (v === null || v === undefined) where.push(`json_extract(data, '$.${k}') IS NULL`);
          else { where.push(`json_extract(data, '$.${k}') = ?`); vals.push(bind(v)); }
        }
        const q = `SELECT * FROM "${nome}"${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY created_date, id`;
        return prep(q).all(...vals).map(toRow);
      },
      async create(dados) {
        const agora = new Date().toISOString();
        const id = `${nome.slice(0, 3).toLowerCase()}_${Date.now().toString(36)}${randomBytes(6).toString('hex')}`;
        const { id: _i, created_date: _c, updated_date: _u, ...d } = dados;
        prep(`INSERT INTO "${nome}" (id, created_date, updated_date, data) VALUES (?, ?, ?, ?)`).run(id, agora, agora, JSON.stringify(d));
        return { ...d, id, created_date: agora, updated_date: agora };
      },
      async update(id, patch) {
        const atual = prep(`SELECT * FROM "${nome}" WHERE id = ?`).get(id);
        if (!atual) throw new Error(`Registro não encontrado: ${nome}/${id}`);
        const { id: _i, created_date: _c, updated_date: _u, ...p } = patch;
        const novo = { ...JSON.parse(atual.data), ...p };
        const agora = new Date().toISOString();
        prep(`UPDATE "${nome}" SET data = ?, updated_date = ? WHERE id = ?`).run(JSON.stringify(novo), agora, id);
        return { ...novo, id, created_date: atual.created_date, updated_date: agora };
      },
      async delete(id) {
        prep(`DELETE FROM "${nome}" WHERE id = ?`).run(id);
      },
    };
  }

  const db = new Proxy({}, { get: (_, n) => handler(String(n)) });

  // Fila única: cada operação roda isolada numa transação; erro (ou status ≠ 200) desfaz tudo.
  let fila = Promise.resolve();
  function exclusivo(fn) {
    const exec = async () => {
      sql.exec('BEGIN IMMEDIATE');
      try {
        const r = await fn();
        if (r && r.__rollback) sql.exec('ROLLBACK'); else sql.exec('COMMIT');
        return r;
      } catch (e) {
        try { sql.exec('ROLLBACK'); } catch {}
        throw e;
      }
    };
    const p = fila.then(exec, exec);
    fila = p.catch(() => {});
    return p;
  }

  return { db, sql, exclusivo, fechar: () => sql.close() };
}
