// Backend da DEMONSTRAÇÃO: as mesmas regras do servidor (router/ações), executadas no navegador.
import { handle } from '../../../src/app/router.js';
import { memDB } from './memdb.js';
import { semear, SENHA_DEMO } from './seed.js';

const banco = memDB();
const db = banco.db;
let sessao = null; // { email, nome }
const contasExtras = new Map(); // contas criadas durante a demonstração

class Erro extends Error { constructor(m, status, details) { super(m); this.status = status; this.details = details; } }

function ctxPara(email, nome) {
  return {
    db, user: null, authEmail: email, authName: nome || email, now: () => new Date(),
    files: { signedUrl: async (uri) => `demo:${uri}`, reivindicar: async () => true },
    invite: async (para) => ({ link: `(demonstração) o convite para ${para} seria enviado por e-mail ou link`, expira_em: new Date(Date.now() + 7 * 864e5).toISOString(), enviado_por_email: false }),
  };
}

async function executar(email, action, payload, nome) {
  const ctx = ctxPara(email, nome);
  ctx.user = (await db.UsuarioPlataforma.filter({ email }))[0] || null;
  const r = await handle(ctx, action, payload);
  if (r.status !== 200) throw new Erro(r.body.error, r.status, r.body.details);
  return r.body.data;
}

let pronto = null;
export function iniciar() {
  pronto ??= (async () => {
    if (!banco.carregar()) { await semear(db, (email, action, payload = {}, nome) => executar(email, action, payload, nome)); banco.salvar(); }
    try { sessao = JSON.parse(sessionStorage.getItem('hs-demo-sessao') || 'null'); } catch { sessao = null; }
  })();
  return pronto;
}

const lembrarSessao = () => { try { sessionStorage.setItem('hs-demo-sessao', JSON.stringify(sessao)); } catch { /* */ } };

export async function rpc(action, payload) {
  await iniciar();
  if (!sessao) throw new Erro('Sessão expirada. Entre novamente.', 401);
  const data = await executar(sessao.email, action, payload, sessao.nome);
  if (action === 'meuPerfil') data.seguranca = { exige_2fa: false, dois_fatores_ativo: false, codigos_recuperacao_restantes: 0, email_disponivel: false };
  if (!/^(listar|detalhe|meuPerfil|dashboard|simular|minha|obter|status|preview|exportar|url)/.test(action)) banco.salvar();
  return data;
}

export async function publico() {
  await iniciar();
  const planos = (await db.Plano.filter({ status: 'ATIVO' })).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  return { planos, contato: { email: null, whatsapp: null } };
}

const indisponivel = () => { throw new Erro('Indisponível na demonstração.', 422); };

export const authDemo = {
  async sessao() { await iniciar(); return { logado: !!sessao, email_disponivel: false }; },
  async login(email, senha) {
    await iniciar();
    const e = String(email || '').trim().toLowerCase();
    const existe = (await db.UsuarioPlataforma.filter({ email: e })).length || contasExtras.has(e);
    if (!existe || senha !== (contasExtras.get(e) || SENHA_DEMO)) throw new Erro(`E-mail ou senha incorretos. Na demonstração, a senha é ${SENHA_DEMO}.`, 401);
    sessao = { email: e, nome: e }; lembrarSessao();
    return null;
  },
  async cadastro({ email, senha, nome }) {
    await iniciar();
    const e = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) throw new Erro('E-mail inválido', 422);
    if (String(senha || '').length < 8) throw new Erro('A senha deve ter pelo menos 8 caracteres', 422);
    if ((await db.UsuarioPlataforma.filter({ email: e })).length || contasExtras.has(e)) throw new Erro('Já existe uma conta com este e-mail. Faça login.', 422);
    contasExtras.set(e, senha);
    sessao = { email: e, nome }; lembrarSessao();
    return null;
  },
  async logout() { sessao = null; lembrarSessao(); return null; },
  convite: indisponivel, aceitarConvite: indisponivel, trocarSenha: indisponivel,
  verificar2fa: indisponivel, iniciar2fa: indisponivel, ativar2fa: indisponivel, desativar2fa: indisponivel,
  async esqueci() { return { email_disponivel: false }; },
};

export async function enviarArquivoDemo(file) {
  if (file.size > 10 * 1024 * 1024) throw new Erro('Arquivo maior que 10 MB', 413);
  return { file_uri: `demo-up-${Date.now().toString(36)}` };
}

export function restaurarDemo() {
  banco.limpar();
  try { sessionStorage.removeItem('hs-demo-sessao'); } catch { /* */ }
  pronto = null; sessao = null;
}
