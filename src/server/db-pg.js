// Armazenamento em PostgreSQL (ex.: Supabase) com a MESMA interface do SQLite (db.js):
// db.Entidade.filter(query) / create(data) / update(id, patch) / delete(id) e exclusivo(fn).
// Uma conexão única + fila: cada requisição roda isolada numa transação.
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { ENTITIES } from '../schema/entities.mjs';
import { ENTIDADES_INTERNAS } from './db.js';

const CHAVE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NOMES = [...Object.keys(ENTITIES), ...ENTIDADES_INTERNAS];

function configSSL(url, env) {
  if (/sslmode=disable/.test(url) || /@(localhost|127\.0\.0\.1)[:/]/.test(url)) return undefined;
  const ca = env.PGSSL_CA ? (existsSync(env.PGSSL_CA) ? readFileSync(env.PGSSL_CA, 'utf8') : env.PGSSL_CA) : null;
  // Com o certificado do Supabase (PGSSL_CA) a conexão é verificada; sem ele, é cifrada sem verificar a cadeia.
  return ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
}

export function abrirBancoPg(url, { schema = null, env = process.env } = {}) {
  // No Supabase, o esquema "public" é exposto pela API REST do projeto: os dados ficam no esquema "hs".
  if (!schema && /supabase\.(co|com)/.test(url)) schema = 'hs';
  let cliente = null;
  let pronto = null;

  async function conectar() {
    const c = new pg.Client({ connectionString: url.replace(/[?&]sslmode=[^&]+/, ''), ssl: configSSL(url, env), application_name: 'hs-recuperacao' });
    c.on('error', (e) => { console.error('[hs] conexão com o banco caiu:', e.message); if (cliente === c) { cliente = null; pronto = null; } });
    await c.connect();
    if (schema) {
      await c.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      await c.query(`SET search_path TO "${schema}"`);
    }
    for (const n of NOMES) {
      await c.query(`CREATE TABLE IF NOT EXISTS "${n}" (id text PRIMARY KEY, created_date text NOT NULL, updated_date text NOT NULL, data jsonb NOT NULL)`);
      await c.query(`CREATE INDEX IF NOT EXISTS "ix_${n}_data" ON "${n}" USING gin (data jsonb_path_ops)`);
      await c.query(`CREATE INDEX IF NOT EXISTS "ix_${n}_criado" ON "${n}" (created_date, id)`);
    }
    cliente = c;
  }
  const DICAS = {
    '28P01': 'o banco recusou a SENHA. Confira a senha dentro do DATABASE_URL (sem colchetes; prefira só letras e números).',
    'ENOTFOUND': 'endereço do banco não encontrado. Confira o host no DATABASE_URL.',
    'ECONNREFUSED': 'conexão recusada. Confira o host e a porta (Supabase: Session pooler, porta 5432).',
    'ETIMEDOUT': 'tempo esgotado ao conectar. Use o endereço do Session pooler do Supabase (IPv4).',
    'ENETUNREACH': 'rede inalcançável (provavelmente IPv6). Use o endereço do Session pooler do Supabase.',
    '3D000': 'banco de dados inexistente. O final do DATABASE_URL deve ser /postgres.',
  };
  let ultimoAviso = 0;
  const garantir = () => (pronto ??= conectar().catch((e) => {
    pronto = null;
    if (Date.now() - ultimoAviso > 60000) { ultimoAviso = Date.now(); console.error(`[hs] Não foi possível conectar ao banco (${e.code || e.message}): ${DICAS[e.code] || e.message}`); }
    throw e;
  }));
  async function q(sql, params) { await garantir(); return cliente.query(sql, params); }

  const toRow = (r) => r && { ...r.data, id: r.id, created_date: r.created_date, updated_date: r.updated_date };

  function handler(nome) {
    if (!NOMES.includes(nome)) throw new Error(`Entidade inexistente: ${String(nome)}`);
    return {
      async filter(query = {}) {
        const where = [], vals = [], contem = {};
        for (const [k, v] of Object.entries(query)) {
          if (!CHAVE.test(k)) throw new Error('Campo de filtro inválido');
          if (k === 'id') { vals.push(v); where.push(`id = $${vals.length}`); continue; }
          if (v === null || v === undefined) where.push(`(data->'${k}' IS NULL OR data->'${k}' = 'null'::jsonb)`);
          else contem[k] = v;
        }
        if (Object.keys(contem).length) { vals.push(JSON.stringify(contem)); where.push(`data @> $${vals.length}::jsonb`); }
        const r = await q(`SELECT * FROM "${nome}"${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY created_date, id`, vals);
        return r.rows.map(toRow);
      },
      async create(dados) {
        const agora = new Date().toISOString();
        const id = `${nome.slice(0, 3).toLowerCase()}_${Date.now().toString(36)}${randomBytes(6).toString('hex')}`;
        const { id: _i, created_date: _c, updated_date: _u, ...d } = dados;
        await q(`INSERT INTO "${nome}" (id, created_date, updated_date, data) VALUES ($1, $2, $3, $4::jsonb)`, [id, agora, agora, JSON.stringify(d)]);
        return { ...JSON.parse(JSON.stringify(d)), id, created_date: agora, updated_date: agora };
      },
      async update(id, patch) {
        const { id: _i, created_date: _c, updated_date: _u, ...p } = patch;
        const r = await q(`UPDATE "${nome}" SET data = data || $2::jsonb, updated_date = $3 WHERE id = $1 RETURNING *`, [id, JSON.stringify(p), new Date().toISOString()]);
        if (!r.rows.length) throw new Error(`Registro não encontrado: ${nome}/${id}`);
        return toRow(r.rows[0]);
      },
      async delete(id) { await q(`DELETE FROM "${nome}" WHERE id = $1`, [id]); },
    };
  }

  const db = new Proxy({}, { get: (_, n) => handler(String(n)) });

  let fila = Promise.resolve();
  function exclusivo(fn) {
    const exec = async () => {
      await q('BEGIN');
      try {
        const r = await fn();
        await q(r && r.__rollback ? 'ROLLBACK' : 'COMMIT');
        return r;
      } catch (e) {
        try { await cliente?.query('ROLLBACK'); } catch { /* conexão caiu */ }
        throw e;
      }
    };
    const p = fila.then(exec, exec);
    fila = p.catch(() => {});
    return p;
  }

  /** Exporta todas as tabelas (backup lógico). */
  async function exportar() {
    const out = {};
    for (const n of NOMES) out[n] = (await q(`SELECT * FROM "${n}" ORDER BY created_date, id`)).rows;
    return out;
  }

  return {
    db, exclusivo, exportar, tipo: 'postgres',
    ping: () => q('SELECT 1'),
    fechar: async () => { if (schema && env.HS_TESTE_DROP_SCHEMA === '1' && cliente) await cliente.query(`DROP SCHEMA "${schema}" CASCADE`).catch(() => {}); await cliente?.end().catch(() => {}); cliente = null; pronto = null; },
  };
}
