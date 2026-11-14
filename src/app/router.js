import { requirePerm, isHS, AccessError } from '../core/permissions.js';
import { ValidationError } from '../core/money.js';
import { getById } from './context.js';
import { verificarAcessoDaAcao } from './acesso.js';
import { actions as empresa } from './actions/empresa.js';
import { actions as devedores } from './actions/devedores.js';
import { actions as carteiras } from './actions/carteiras.js';
import { actions as operacoes } from './actions/operacoes.js';
import { actions as negociacao } from './actions/negociacao.js';
import { actions as pagamentos } from './actions/pagamentos.js';
import { actions as relatorios } from './actions/relatorios.js';
import { actions as comercial } from './actions/comercial.js';
import { actions as lgpd } from './actions/lgpd.js';
import { actions as whatsapp } from './actions/whatsapp.js';
import { actions as mensagens } from './actions/mensagens.js';
import { actions as negocio } from './actions/negocio.js';
import { actions as boletos } from './actions/boletos.js';

export const ACTIONS = { ...empresa, ...devedores, ...carteiras, ...operacoes, ...negociacao, ...pagamentos, ...relatorios, ...comercial, ...lgpd, ...whatsapp, ...mensagens, ...negocio, ...boletos };

// Ações permitidas mesmo com empresa suspensa/cancelada (somente consulta essencial)
const LIBERADAS_EMPRESA_BLOQUEADA = new Set(['meuPerfil', 'minhaAssinatura', 'listarNotificacoes', 'marcarNotificacaoLida', 'listarContratos', 'exportarDadosTitular']);

/**
 * Ponto único de entrada: autenticação → perfil → status da empresa → permissão → ação.
 * Retorna { status, body } para o adaptador HTTP.
 */
export async function handle(ctx, action, payload = {}) {
  try {
    const def = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
    if (!def) throw new ValidationError(`Ação desconhecida: ${String(action).slice(0, 60)}`);
    if (!ctx.authEmail) throw new AccessError('Não autenticado', 401);
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) throw new ValidationError('Payload inválido');
    if (!def.publico) {
      if (!ctx.user) throw new AccessError('Usuário sem perfil na plataforma. Conclua o cadastro ou peça acesso ao administrador.', 403);
      if (ctx.user.status !== 'ATIVO') throw new AccessError('Usuário inativo ou bloqueado');
      if (!isHS(ctx.user)) {
        if (!ctx.user.empresa_id) throw new AccessError('Usuário sem empresa vinculada');
        const emp = await getById(ctx, 'Empresa', ctx.user.empresa_id);
        if (!emp) throw new AccessError('Empresa não encontrada', 404);
        if ((emp.status === 'SUSPENSA' || emp.status === 'CANCELADA') && !LIBERADAS_EMPRESA_BLOQUEADA.has(action)) {
          throw new AccessError(`Empresa ${emp.status.toLowerCase()}: acesso limitado. Contate o Acorly.`);
        }
      }
      if (def.perm) requirePerm(ctx.user, def.perm);
      if (!isHS(ctx.user)) await verificarAcessoDaAcao(ctx, ctx.user.empresa_id, action);
    }
    const data = await def.run(ctx, payload);
    return { status: 200, body: { ok: true, data } };
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) {
      console.error('[hsApi]', action, e);
      return { status, body: { ok: false, error: 'Erro interno. Tente novamente ou contate o suporte.' } };
    }
    return { status, body: { ok: false, error: e.message, details: e.details } };
  }
}
