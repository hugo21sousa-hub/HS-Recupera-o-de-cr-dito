// Onde ficam os bytes dos anexos: disco local (VPS) ou Supabase Storage (bucket privado).
import { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export function armazenamentoDisco(dir) {
  mkdirSync(dir, { recursive: true });
  return {
    tipo: 'disco',
    async put(nome, buffer) { writeFileSync(join(dir, nome), buffer, { mode: 0o600 }); },
    async get(nome) { const p = join(dir, nome); return existsSync(p) ? readFileSync(p) : null; },
    async del(nome) { const p = join(dir, nome); if (existsSync(p)) unlinkSync(p); },
  };
}

export function configSupabase(env = process.env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return null;
  return { url: env.SUPABASE_URL.replace(/\/+$/, ''), chave: env.SUPABASE_SERVICE_KEY, bucket: env.SUPABASE_BUCKET || 'hs-arquivos' };
}

/** Supabase Storage via API REST, com a chave de serviço (só no servidor; nunca vai para o navegador). */
export function armazenamentoSupabase({ url, chave, bucket }, fetchImpl = fetch) {
  const h = (extra = {}) => ({ apikey: chave, ...(chave.startsWith('eyJ') ? { Authorization: `Bearer ${chave}` } : {}), ...extra });
  const caminho = (nome) => `${url}/storage/v1/object/${bucket}/${nome.split('/').map(encodeURIComponent).join('/')}`;
  let pronto = null;
  const garantirBucket = () => (pronto ??= (async () => {
    const r = await fetchImpl(`${url}/storage/v1/bucket`, { method: 'POST', headers: h({ 'Content-Type': 'application/json' }), body: JSON.stringify({ id: bucket, name: bucket, public: false }) });
    if (!r.ok && ![400, 409].includes(r.status)) { pronto = null; throw new Error(`Supabase Storage: não foi possível criar o bucket (${r.status})`); }
  })());
  async function chamar(metodo, nome, corpo, tipo) {
    await garantirBucket();
    let r;
    try {
      r = await fetchImpl(caminho(nome), { method: metodo, signal: AbortSignal.timeout(30000), headers: h(tipo ? { 'Content-Type': tipo, 'x-upsert': 'true' } : {}), body: corpo });
    } catch (e) {
      throw Object.assign(new Error('Armazenamento de arquivos indisponível no momento. Tente novamente.'), { status: 502, causa: e.message });
    }
    return r;
  }
  return {
    tipo: 'supabase',
    async put(nome, buffer, mime = 'application/octet-stream') {
      const r = await chamar('POST', nome, buffer, mime);
      if (!r.ok) throw Object.assign(new Error(`Falha ao guardar o arquivo (${r.status})`), { status: 502 });
    },
    async get(nome) {
      const r = await chamar('GET', nome);
      if (r.status === 404 || r.status === 400) return null;
      if (!r.ok) throw Object.assign(new Error(`Falha ao ler o arquivo (${r.status})`), { status: 502 });
      return Buffer.from(await r.arrayBuffer());
    },
    async del(nome) { await chamar('DELETE', nome); },
    async listar(prefixo) {
      await garantirBucket();
      const r = await fetchImpl(`${url}/storage/v1/object/list/${bucket}`, { method: 'POST', headers: h({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefix: prefixo, limit: 1000, sortBy: { column: 'name', order: 'asc' } }) });
      return r.ok ? (await r.json()).map((o) => `${prefixo}${o.name}`) : [];
    },
  };
}
