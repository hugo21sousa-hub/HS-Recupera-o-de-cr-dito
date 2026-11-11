// Contas, senhas (scrypt), sessões (cookie httpOnly) e convites por link.
import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

const SESSAO_HORAS = 12;
const CONVITE_DIAS = 7;
const MAX_FALHAS = 5;
const BLOQUEIO_MIN = 15;

export const hashToken = (t) => createHash('sha256').update(t).digest('hex');

export function hashSenha(senha) {
  const salt = randomBytes(16);
  const h = scryptSync(senha, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
}

export function conferirSenha(senha, armazenado) {
  const [alg, saltHex, hHex] = String(armazenado || '').split('$');
  if (alg !== 'scrypt' || !saltHex || !hHex) return false;
  const h = scryptSync(senha, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const esperado = Buffer.from(hHex, 'hex');
  return h.length === esperado.length && timingSafeEqual(h, esperado);
}

export function validarSenha(senha) {
  if (typeof senha !== 'string' || senha.length < 8) return 'A senha deve ter pelo menos 8 caracteres';
  if (senha.length > 200) return 'Senha muito longa';
  if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) return 'Use letras e números na senha';
  return null;
}

const normEmail = (e) => String(e || '').trim().toLowerCase();
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

export function criarAuth({ db, agora = () => new Date(), urlBase = '' }) {
  async function conta(email) { return (await db.Conta.filter({ email: normEmail(email) }))[0] || null; }

  async function abrirSessao(email) {
    const token = randomBytes(32).toString('base64url');
    const expira = new Date(agora().getTime() + SESSAO_HORAS * 3600e3).toISOString();
    await db.Sessao.create({ token_hash: hashToken(token), email: normEmail(email), expira_em: expira });
    return { token, expira };
  }

  async function encerrarSessoes(email) {
    for (const s of await db.Sessao.filter({ email: normEmail(email) })) await db.Sessao.delete(s.id);
  }

  return {
    async sessao(token) {
      if (!token) return null;
      const s = (await db.Sessao.filter({ token_hash: hashToken(token) }))[0];
      if (!s) return null;
      if (s.expira_em < agora().toISOString()) { await db.Sessao.delete(s.id); return null; }
      const c = await conta(s.email);
      if (!c || c.status === 'DESATIVADA') return null;
      return { email: c.email, nome: c.nome, sessao_id: s.id };
    },

    async login(email, senha) {
      const c = await conta(email);
      const falha = { erro: 'E-mail ou senha incorretos' };
      if (!c) { conferirSenha(String(senha || ''), 'scrypt$00$00'); return falha; }
      if (c.bloqueado_ate && c.bloqueado_ate > agora().toISOString()) return { erro: 'Muitas tentativas. Tente novamente em alguns minutos.' };
      if (!conferirSenha(String(senha || ''), c.senha_hash)) {
        const falhas = (c.falhas || 0) + 1;
        await db.Conta.update(c.id, { falhas, bloqueado_ate: falhas >= MAX_FALHAS ? new Date(agora().getTime() + BLOQUEIO_MIN * 60e3).toISOString() : null });
        return falha;
      }
      await db.Conta.update(c.id, { falhas: 0, bloqueado_ate: null, ultimo_login: agora().toISOString() });
      return abrirSessao(c.email);
    },

    async logout(token) {
      const s = token && (await db.Sessao.filter({ token_hash: hashToken(token) }))[0];
      if (s) await db.Sessao.delete(s.id);
    },

    /** Cadastro público (para empresas novas). E-mails já convidados devem usar o link do convite. */
    async cadastrar({ email, senha, nome }) {
      const e = normEmail(email);
      if (!emailOk(e)) return { erro: 'E-mail inválido' };
      const ps = validarSenha(senha);
      if (ps) return { erro: ps };
      if (await conta(e)) return { erro: 'Já existe uma conta com este e-mail. Faça login.' };
      if ((await db.UsuarioPlataforma.filter({ email: e })).length) return { erro: 'Este e-mail foi convidado. Use o link de convite recebido.' };
      await db.Conta.create({ email: e, nome: String(nome || '').slice(0, 120), senha_hash: hashSenha(senha), status: 'ATIVA', falhas: 0, criado_em: agora().toISOString() });
      return abrirSessao(e);
    },

    /** Gera link de convite/redefinição (o administrador envia ao usuário). */
    async gerarConvite(email) {
      const e = normEmail(email);
      for (const c of await db.Convite.filter({ email: e, usado: false })) await db.Convite.update(c.id, { usado: true });
      const token = randomBytes(24).toString('base64url');
      const expira = new Date(agora().getTime() + CONVITE_DIAS * 86400e3).toISOString();
      await db.Convite.create({ token_hash: hashToken(token), email: e, expira_em: expira, usado: false });
      return { link: `${urlBase}/convite/${token}`, expira_em: expira };
    },

    async lerConvite(token) {
      const c = (await db.Convite.filter({ token_hash: hashToken(String(token || '')) }))[0];
      if (!c || c.usado || c.expira_em < agora().toISOString()) return null;
      return c;
    },

    /** Aceite do convite: define (ou redefine) a senha e invalida sessões antigas da conta. */
    async aceitarConvite(token, senha, nome) {
      const c = await this.lerConvite(token);
      if (!c) return { erro: 'Convite inválido ou expirado. Peça um novo link ao administrador.' };
      const ps = validarSenha(senha);
      if (ps) return { erro: ps };
      const existente = await conta(c.email);
      if (existente) {
        await db.Conta.update(existente.id, { senha_hash: hashSenha(senha), falhas: 0, bloqueado_ate: null, status: 'ATIVA' });
        await encerrarSessoes(c.email);
      } else {
        await db.Conta.create({ email: c.email, nome: String(nome || '').slice(0, 120), senha_hash: hashSenha(senha), status: 'ATIVA', falhas: 0, criado_em: agora().toISOString() });
      }
      await db.Convite.update(c.id, { usado: true, usado_em: agora().toISOString() });
      return abrirSessao(c.email);
    },

    async trocarSenha(email, atual, nova) {
      const c = await conta(email);
      if (!c || !conferirSenha(String(atual || ''), c.senha_hash)) return { erro: 'Senha atual incorreta' };
      const ps = validarSenha(nova);
      if (ps) return { erro: ps };
      await db.Conta.update(c.id, { senha_hash: hashSenha(nova) });
      await encerrarSessoes(email);
      return abrirSessao(email);
    },
  };
}
