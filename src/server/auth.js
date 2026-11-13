// Contas, senhas (scrypt), sessões (cookie httpOnly) e convites por link.
import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { novoSegredo, verificar, otpauth, cifrador } from './totp.js';

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

export function criarAuth({ db, agora = () => new Date(), urlBase = '', segredo = 'dev', codigoPorEmail = null }) {
  const cripto = cifrador(segredo);
  async function conta(email) { return (await db.Conta.filter({ email: normEmail(email) }))[0] || null; }

  async function abrirSessao(email) {
    const token = randomBytes(32).toString('base64url');
    const expira = new Date(agora().getTime() + SESSAO_HORAS * 3600e3).toISOString();
    await db.Sessao.create({ token_hash: hashToken(token), email: normEmail(email), expira_em: expira });
    return { token, expira };
  }

  const mascarar = (e) => { const [u, d] = String(e).split('@'); return `${u.slice(0, 1)}${'*'.repeat(Math.max(3, u.length - 2))}${u.length > 1 ? u.slice(-1) : ''}@${d}`; };
  const novoCodigo = () => String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, '0');

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
      if (codigoPorEmail) {
        // Senha correta: envia um código de 6 dígitos para o e-mail da conta (vale 10 minutos)
        const desafio = randomBytes(24).toString('base64url');
        const codigo = novoCodigo();
        await db.Desafio2FA.create({ token_hash: hashToken(desafio), email: c.email, metodo: 'email', codigo_hash: hashToken(`${desafio}:${codigo}`), expira_em: new Date(agora().getTime() + 10 * 60e3).toISOString(), tentativas: 0, envios: 1, ultimo_envio: agora().toISOString() });
        if (!(await codigoPorEmail(c.email, codigo))) {
          // Falha no envio: quem tem aplicativo autenticador continua podendo entrar por ele
          if (c.totp_ativo) {
            const d = (await db.Desafio2FA.filter({ token_hash: hashToken(desafio) }))[0];
            await db.Desafio2FA.update(d.id, { metodo: 'app', codigo_hash: null });
            return { precisa_2fa: true, desafio, metodo: 'app', aviso: 'Não conseguimos enviar o código por e-mail. Use o aplicativo autenticador.' };
          }
          return { erro: 'Não foi possível enviar o código para o seu e-mail agora. Tente novamente em instantes ou fale com o administrador.' };
        }
        return { precisa_2fa: true, desafio, metodo: 'email', destino: mascarar(c.email) };
      }
      if (c.totp_ativo) {
        // Senha correta: falta o segundo fator. Emite um desafio curto (5 min).
        const desafio = randomBytes(24).toString('base64url');
        await db.Desafio2FA.create({ token_hash: hashToken(desafio), email: c.email, expira_em: new Date(agora().getTime() + 5 * 60e3).toISOString(), tentativas: 0 });
        return { precisa_2fa: true, desafio, metodo: 'app' };
      }
      return abrirSessao(c.email);
    },

    /** Conclui o login com código do aplicativo autenticador ou código de recuperação. */
    async verificar2fa(desafio, codigoInformado) {
      const d = (await db.Desafio2FA.filter({ token_hash: hashToken(String(desafio || '')) }))[0];
      if (!d || d.expira_em < agora().toISOString() || d.tentativas >= 5) return { erro: 'Verificação expirada. Entre novamente.' };
      const c = await conta(d.email);
      const informado = String(codigoInformado || '').replace(/\s/g, '');
      if (d.codigo_hash && /^\d{6}$/.test(informado)) {
        const a = Buffer.from(hashToken(`${desafio}:${informado}`)), b = Buffer.from(d.codigo_hash);
        if (a.length === b.length && timingSafeEqual(a, b)) { await db.Desafio2FA.delete(d.id); return abrirSessao(c.email); }
      }
      const passo = c?.totp_ativo ? verificar(cripto.decifrar(c.totp_segredo), codigoInformado, agora().getTime()) : null;
      if (passo !== null && passo > (c.totp_ultimo_passo ?? -1)) {
        await db.Conta.update(c.id, { totp_ultimo_passo: passo });
      } else {
        const rec = String(codigoInformado || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        const codigos = c?.totp_recuperacao || [];
        const idx = rec.length === 10 ? codigos.indexOf(hashToken(rec)) : -1;
        if (idx < 0) {
          await db.Desafio2FA.update(d.id, { tentativas: (d.tentativas || 0) + 1 });
          return { erro: 'Código inválido' };
        }
        await db.Conta.update(c.id, { totp_recuperacao: codigos.filter((_, i) => i !== idx) });
      }
      await db.Desafio2FA.delete(d.id);
      return abrirSessao(c.email);
    },

    /** Reenvia o código por e-mail (no máximo 5 envios; intervalo mínimo de 60 segundos). */
    async reenviarCodigo(desafio) {
      if (!codigoPorEmail) return { erro: 'Envio por e-mail indisponível' };
      const d = (await db.Desafio2FA.filter({ token_hash: hashToken(String(desafio || '')) }))[0];
      if (!d || d.metodo !== 'email' || d.expira_em < agora().toISOString()) return { erro: 'Verificação expirada. Entre novamente.' };
      if ((d.envios || 1) >= 5) return { erro: 'Limite de reenvios atingido. Entre novamente.' };
      if (agora().getTime() - new Date(d.ultimo_envio).getTime() < 60e3) return { erro: 'Aguarde 1 minuto para pedir um novo código.' };
      const codigo = novoCodigo();
      await db.Desafio2FA.update(d.id, { codigo_hash: hashToken(`${desafio}:${codigo}`), tentativas: 0, envios: (d.envios || 1) + 1, ultimo_envio: agora().toISOString(), expira_em: new Date(agora().getTime() + 10 * 60e3).toISOString() });
      if (!(await codigoPorEmail(d.email, codigo))) return { erro: 'Não foi possível enviar o código agora.' };
      return { ok: true, destino: mascarar(d.email) };
    },

    async status2fa(email) {
      const c = await conta(email);
      return { ativo: !!c?.totp_ativo, codigos_recuperacao_restantes: (c?.totp_recuperacao || []).length };
    },

    async iniciar2fa(email) {
      const c = await conta(email);
      if (!c) return { erro: 'Conta não encontrada' };
      if (c.totp_ativo) return { erro: 'A verificação em duas etapas já está ativa' };
      const s = novoSegredo();
      await db.Conta.update(c.id, { totp_pendente: cripto.cifrar(s) });
      return { segredo: s.replace(/(.{4})/g, '$1 ').trim(), otpauth: otpauth(s, c.email) };
    },

    async ativar2fa(email, codigoInformado) {
      const c = await conta(email);
      if (!c?.totp_pendente) return { erro: 'Inicie a configuração novamente' };
      const s = cripto.decifrar(c.totp_pendente);
      const passo = verificar(s, codigoInformado, agora().getTime());
      if (passo === null) return { erro: 'Código inválido. Confira a hora do celular e tente de novo.' };
      const codigos = Array.from({ length: 8 }, () => randomBytes(8).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toUpperCase().padEnd(10, 'X'));
      await db.Conta.update(c.id, { totp_ativo: true, totp_segredo: c.totp_pendente, totp_pendente: null, totp_ultimo_passo: passo, totp_recuperacao: codigos.map(hashToken), totp_ativado_em: agora().toISOString() });
      return { codigos_recuperacao: codigos.map((x) => `${x.slice(0, 5)}-${x.slice(5)}`) };
    },

    async desativar2fa(email, senha, codigoInformado) {
      const c = await conta(email);
      if (!c?.totp_ativo) return { erro: 'Verificação em duas etapas não está ativa' };
      if (!conferirSenha(String(senha || ''), c.senha_hash)) return { erro: 'Senha incorreta' };
      if (verificar(cripto.decifrar(c.totp_segredo), codigoInformado, agora().getTime()) === null) return { erro: 'Código inválido' };
      await db.Conta.update(c.id, { totp_ativo: false, totp_segredo: null, totp_recuperacao: [], totp_ultimo_passo: null });
      return { ok: true };
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
    async gerarConvite(email, { invalidarAnteriores = true, tokenFixo = null } = {}) {
      const e = normEmail(email);
      if (invalidarAnteriores) for (const c of await db.Convite.filter({ email: e, usado: false })) await db.Convite.update(c.id, { usado: true });
      const token = tokenFixo || randomBytes(24).toString('base64url');
      if (tokenFixo && (await db.Convite.filter({ token_hash: hashToken(token), usado: false })).length) {
        return { link: `${urlBase}/convite/${token}`, expira_em: null };
      }
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
        await db.Conta.update(existente.id, { senha_hash: hashSenha(senha), falhas: 0, bloqueado_ate: null, status: 'ATIVA', totp_ativo: false, totp_segredo: null, totp_pendente: null, totp_recuperacao: [] });
        await encerrarSessoes(c.email);
      } else {
        await db.Conta.create({ email: c.email, nome: String(nome || '').slice(0, 120), senha_hash: hashSenha(senha), status: 'ATIVA', falhas: 0, criado_em: agora().toISOString() });
      }
      await db.Convite.update(c.id, { usado: true, usado_em: agora().toISOString() });
      // Qualquer outro link pendente para este e-mail deixa de valer
      for (const outro of await db.Convite.filter({ email: c.email, usado: false })) await db.Convite.update(outro.id, { usado: true });
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
