import { writeFileSync } from 'node:fs';
import { ACTIONS } from '../src/app/router.js';
import { MATRIZ } from '../src/core/permissions.js';

const perfisCom = (perm) => Object.entries(MATRIZ).filter(([, ps]) => ps.includes(perm)).map(([p]) => p.replace('_EMPRESA', '_EMP').replace('_HS', '')).join(', ');
let md = '# Referência da API `hsApi`\n\nGerado por `node scripts/gen-api-doc.mjs`. Chamada: `hs(acao, payload)` (ver `base44/frontend/hsApi.js`).\n\n';
md += 'Perfis: SUPERADMIN, GESTOR_OPERACOES, OPERADOR (HS) · ADMIN_EMP, FINANCEIRO_EMP, VISUALIZADOR_EMP.\n"verificação interna" = a ação decide a permissão conforme o caso (ex.: perfil HS × empresa).\n\n';
md += '| Ação | Permissão | Perfis |\n|---|---|---|\n';
for (const [nome, def] of Object.entries(ACTIONS).sort(([a], [b]) => a.localeCompare(b))) {
  md += `| \`${nome}\` | ${def.publico ? 'autenticado (sem perfil)' : def.perm ? `\`${def.perm}\`` : 'verificação interna'} | ${def.publico ? 'todos' : def.perm ? perfisCom(def.perm) : '—'} |\n`;
}
md += '\n## Matriz de permissões\n\n| Permissão | ' + Object.keys(MATRIZ).join(' | ') + ' |\n|---|' + Object.keys(MATRIZ).map(() => ':-:').join('|') + '|\n';
const todas = [...new Set(Object.values(MATRIZ).flat())].sort();
for (const p of todas) md += `| \`${p}\` | ` + Object.values(MATRIZ).map((ps) => (ps.includes(p) ? '✔' : '')).join(' | ') + ' |\n';
writeFileSync('docs/API.md', md);
console.log(`OK docs/API.md (${Object.keys(ACTIONS).length} ações)`);
