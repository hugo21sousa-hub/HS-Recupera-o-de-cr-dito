// Banco em memória para a demonstração (mesma interface do SQLite do servidor), com cópia no navegador.
import { ENTITIES } from '../../../src/schema/entities.mjs';

const CHAVE = 'hs-demo-v1';

export function memDB() {
  const tabelas = {};
  let seq = 0;
  const tab = (n) => (tabelas[n] ??= new Map());
  const h = (nome) => {
    if (!ENTITIES[nome]) throw new Error(`Entidade inexistente: ${nome}`);
    const t = tab(nome);
    return {
      async filter(q = {}) { return [...t.values()].filter((r) => Object.entries(q).every(([k, v]) => (v === null ? r[k] == null : r[k] === v))).map((r) => structuredClone(r)); },
      async create(d) {
        const agora = new Date().toISOString();
        const id = `${nome.slice(0, 3).toLowerCase()}_${Date.now().toString(36)}${(++seq).toString(36).padStart(4, '0')}`;
        const rec = { ...structuredClone(d), id, created_date: agora, updated_date: agora };
        t.set(id, rec);
        return structuredClone(rec);
      },
      async update(id, p) { const r = t.get(id); if (!r) throw new Error('não encontrado'); Object.assign(r, structuredClone(p), { updated_date: new Date().toISOString() }); return structuredClone(r); },
      async delete(id) { t.delete(id); },
    };
  };
  const db = new Proxy({}, { get: (_, n) => h(String(n)) });
  return {
    db,
    salvar() { try { localStorage.setItem(CHAVE, JSON.stringify({ seq, tabelas: Object.fromEntries(Object.entries(tabelas).map(([k, m]) => [k, [...m.values()]])) })); } catch { /* armazenamento indisponível */ } },
    carregar() {
      try {
        const j = JSON.parse(localStorage.getItem(CHAVE) || 'null');
        if (!j) return false;
        seq = j.seq || 0;
        for (const [k, rows] of Object.entries(j.tabelas)) tabelas[k] = new Map(rows.map((r) => [r.id, r]));
        return true;
      } catch { return false; }
    },
    limpar() { for (const k of Object.keys(tabelas)) delete tabelas[k]; try { localStorage.removeItem(CHAVE); } catch { /* */ } },
  };
}
