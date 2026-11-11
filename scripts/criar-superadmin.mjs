// Uso: node --disable-warning=ExperimentalWarning scripts/criar-superadmin.mjs email@dominio.com "Seu Nome"
import { join } from 'node:path';
import { abrirBanco } from '../src/server/db.js';
import { criarAuth } from '../src/server/auth.js';

const [email, nome = 'Administrador HS'] = process.argv.slice(2);
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { console.error('Informe um e-mail válido.'); process.exit(1); }
const dataDir = process.env.DATA_DIR || './data';
const { db, exclusivo, fechar } = abrirBanco(join(dataDir, 'hs.sqlite'));
const auth = criarAuth({ db, urlBase: process.env.URL_BASE || `http://localhost:${process.env.PORT || 3000}` });
const e = email.trim().toLowerCase();
await exclusivo(async () => {
  const existe = (await db.UsuarioPlataforma.filter({ email: e }))[0];
  if (existe && existe.perfil !== 'SUPERADMIN_HS') throw new Error(`E-mail já vinculado ao perfil ${existe.perfil}`);
  if (!existe) await db.UsuarioPlataforma.create({ nome, email: e, perfil: 'SUPERADMIN_HS', empresa_id: null, status: 'ATIVO', data_criacao: new Date().toISOString() });
  if (!(await db.ConfiguracaoComunicacao.filter({})).length) await db.ConfiguracaoComunicacao.create({ whatsapp_api_status: 'INDISPONIVEL', email_status: 'INDISPONIVEL', ia_status: 'INDISPONIVEL' });
  const { PLANOS_PADRAO } = await import('../src/app/actions/comercial.js');
  const planos = await db.Plano.filter({});
  for (const p of PLANOS_PADRAO) if (!planos.some((x) => x.nome === p.nome)) await db.Plano.create(p);
  const c = await auth.gerarConvite(e);
  console.log(`\nSuperadmin: ${e}\nAbra este link para definir a senha (válido por 7 dias):\n\n  ${c.link}\n`);
});
fechar();
