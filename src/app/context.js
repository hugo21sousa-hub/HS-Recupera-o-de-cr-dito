import { AccessError, requirePerm, isHS, assertAcessoCaso, can } from '../core/permissions.js';
import { ValidationError } from '../core/money.js';

export { AccessError, ValidationError, requirePerm, can, isHS };

/**
 * ctx = {
 *   db:      entidades com service role (base44.asServiceRole.entities)
 *   user:    registro UsuarioPlataforma do chamador (perfil/empresa_id vêm DAQUI, nunca do cliente)
 *   authEmail, now(), files: { signedUrl(uri) }, invite(email)
 * }
 */

export async function getById(ctx, entidade, id) {
  if (!id || typeof id !== 'string') return null;
  const r = await ctx.db[entidade].filter({ id });
  return r[0] || null;
}

export const find = (ctx, entidade, query = {}) => ctx.db[entidade].filter(query);

export async function auditar(ctx, { acao, entidade, registro_id, antes = null, depois = null, empresa_id = null }) {
  await ctx.db.HistoricoAuditoria.create({
    empresa_id: empresa_id ?? depois?.empresa_id ?? antes?.empresa_id ?? null,
    usuario_id: ctx.user?.id ?? null,
    usuario_email: ctx.user?.email ?? ctx.authEmail ?? null,
    perfil: ctx.user?.perfil ?? null,
    acao,
    entidade,
    registro_id: registro_id ?? null,
    dados_anteriores: antes ? JSON.stringify(antes) : null,
    dados_novos: depois ? JSON.stringify(depois) : null,
    data_hora: ctx.now().toISOString(),
  });
}

export async function criar(ctx, entidade, dados, acao = 'CRIAR') {
  const rec = await ctx.db[entidade].create(dados);
  await auditar(ctx, { acao, entidade, registro_id: rec.id, depois: rec });
  return rec;
}

export async function alterar(ctx, entidade, antes, patch, acao = 'ALTERAR') {
  const rec = await ctx.db[entidade].update(antes.id, patch);
  const depois = rec && rec.id ? rec : { ...antes, ...patch };
  await auditar(ctx, { acao, entidade, registro_id: antes.id, antes: pick(antes, Object.keys(patch)), depois: patch, empresa_id: antes.empresa_id });
  return depois;
}

export function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));
}

/**
 * Resolve a empresa alvo da operação.
 * - Usuário de empresa: SEMPRE a própria (qualquer empresa_id enviado é ignorado/recusado).
 * - SUPERADMIN_HS: precisa informar empresa_id; o acesso é auditado.
 * - Demais perfis Acorly: não acessam dados de empresa fora dos casos.
 */
export async function empresaAlvo(ctx, input = {}) {
  const u = ctx.user;
  if (!isHS(u)) {
    if (input.empresa_id && input.empresa_id !== u.empresa_id) throw new AccessError('Registro não encontrado', 404);
    return u.empresa_id;
  }
  if (u.perfil === 'SUPERADMIN_HS') {
    if (!input.empresa_id) throw new ValidationError('Informe empresa_id');
    await auditar(ctx, { acao: 'ACESSO_ADMINISTRATIVO', entidade: 'Empresa', registro_id: input.empresa_id, empresa_id: input.empresa_id });
    return input.empresa_id;
  }
  throw new AccessError('Perfil Acorly sem acesso direto aos dados da empresa');
}

export async function exigirEmpresaOperante(ctx, empresa_id, { exigirAtiva = false } = {}) {
  const emp = await getById(ctx, 'Empresa', empresa_id);
  if (!emp) throw new AccessError('Empresa não encontrada', 404);
  if (emp.status === 'SUSPENSA' || emp.status === 'CANCELADA') throw new AccessError(`Empresa ${emp.status.toLowerCase()}`);
  if (exigirAtiva && emp.status !== 'ATIVA') throw new ValidationError('A empresa precisa estar ATIVA (validada pelo Acorly) para esta operação');
  return emp;
}

/** Carrega registro de empresa garantindo isolamento (404 se for de outra empresa). */
export async function carregarDaEmpresa(ctx, entidade, id, input = {}) {
  const rec = await getById(ctx, entidade, id);
  if (!rec) throw new AccessError('Registro não encontrado', 404);
  const empresa_id = await empresaAlvo(ctx, { empresa_id: isHS(ctx.user) ? rec.empresa_id : input.empresa_id });
  if (rec.empresa_id !== empresa_id) throw new AccessError('Registro não encontrado', 404);
  return rec;
}

export async function carregarCaso(ctx, caso_id) {
  const caso = await getById(ctx, 'CasoCobranca', caso_id);
  assertAcessoCaso(ctx.user, caso);
  if (ctx.user.perfil === 'SUPERADMIN_HS') {
    await auditar(ctx, { acao: 'ACESSO_ADMINISTRATIVO', entidade: 'CasoCobranca', registro_id: caso.id, empresa_id: caso.empresa_id });
  }
  return caso;
}

export async function notificar(ctx, empresa_id, { perfis, tipo, titulo, mensagem, link }) {
  const usuarios = await find(ctx, 'UsuarioPlataforma', empresa_id ? { empresa_id, status: 'ATIVO' } : { status: 'ATIVO' });
  const alvo = usuarios.filter((u) => !perfis || perfis.includes(u.perfil));
  for (const u of alvo) {
    const n = await ctx.db.Notificacao.create({
      empresa_id, usuario_id: u.id, tipo, titulo, mensagem, link: link || null, lida: false, data_criacao: ctx.now().toISOString(),
    });
    // E-mails saem só depois que a transação for confirmada (ver servidor)
    if (ctx.aposConfirmar && ctx.email?.disponivel) ctx.aposConfirmar.push(() => ctx.email.notificacao(u.email, n));
  }
  return alvo.length;
}

export function paginar(rows, { page = 1, pageSize = 20, busca, camposBusca = [], ordenarPor, ordem = 'desc' } = {}) {
  let r = rows;
  if (busca && camposBusca.length) {
    const b = String(busca).toLowerCase();
    r = r.filter((x) => camposBusca.some((c) => String(x[c] ?? '').toLowerCase().includes(b)));
  }
  const campo = ordenarPor || 'created_date';
  r = [...r].sort((a, b) => {
    const va = a[campo] ?? '', vb = b[campo] ?? '';
    return (va > vb ? 1 : va < vb ? -1 : 0) * (ordem === 'asc' ? 1 : -1);
  });
  pageSize = Math.min(Math.max(1, Number(pageSize) || 20), 200);
  page = Math.max(1, Number(page) || 1);
  return { total: r.length, page, pageSize, itens: r.slice((page - 1) * pageSize, page * pageSize) };
}

/** Aplica apenas filtros de igualdade em campos permitidos (evita consulta arbitrária). */
export function filtrosPermitidos(filtros = {}, permitidos) {
  const q = {};
  for (const k of permitidos) if (filtros[k] !== undefined && filtros[k] !== '' && filtros[k] !== null) q[k] = filtros[k];
  return q;
}

export function exigir(cond, msg) {
  if (!cond) throw new ValidationError(msg);
}

/** Acrescenta nome do devedor/credor às linhas já autorizadas (via divida_id ou caso_id). */
export async function comNomes(ctx, pagina) {
  const cache = new Map();
  const get = async (ent, id) => {
    if (!id) return null;
    const k = ent + id;
    if (!cache.has(k)) cache.set(k, await getById(ctx, ent, id));
    return cache.get(k);
  };
  const itens = [];
  for (const r of pagina.itens) {
    let divida_id = r.divida_id;
    if (!divida_id && r.caso_id) divida_id = (await get('CasoCobranca', r.caso_id))?.divida_id;
    const div = await get('Divida', divida_id);
    const dev = div ? await get('Devedor', div.devedor_id) : null;
    const emp = await get('Empresa', r.empresa_id);
    const autor = r.operador_id ? await get('UsuarioPlataforma', r.operador_id) : null;
    itens.push({ ...r, ...(autor ? { operador_nome: autor.nome } : {}), devedor_nome: dev?.nome ?? null, documento_referencia: r.documento_referencia ?? div?.documento_referencia ?? null, credor: emp?.nome_fantasia || emp?.razao_social || null });
  }
  return { ...pagina, itens };
}
