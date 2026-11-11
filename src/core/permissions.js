// Matriz de perfis × permissões e regras de escopo (multiempresa).
// Esta é a ÚNICA fonte de verdade de autorização; a interface apenas espelha.

export class AccessError extends Error {
  constructor(message = 'Acesso negado', status = 403) {
    super(message);
    this.name = 'AccessError';
    this.status = status;
  }
}

export const PERFIS_HS = ['SUPERADMIN_HS', 'GESTOR_OPERACOES_HS', 'OPERADOR_HS'];
export const PERFIS_EMPRESA = ['ADMIN_EMPRESA', 'FINANCEIRO_EMPRESA', 'VISUALIZADOR_EMPRESA'];
export const PERFIS = [...PERFIS_HS, ...PERFIS_EMPRESA];

const LEITURA_EMPRESA = ['empresa.ler', 'devedor.ler', 'divida.ler', 'carteira.ler', 'caso.ler_empresa', 'negociacao.ler', 'acordo.ler', 'pagamento.ler', 'relatorio.empresa', 'contrato.ler', 'assinatura.ler', 'documento.ler'];

export const MATRIZ = {
  SUPERADMIN_HS: [
    'global', 'empresa.gerenciar_todas', 'usuario.gerenciar_interno', 'usuario.gerenciar_empresa', 'plano.gerenciar',
    'assinatura.gerenciar', 'contrato.gerenciar', 'auditoria.ler', 'config.sistema', 'relatorio.hs',
    'carteira.validar', 'caso.distribuir', 'caso.ler_todos_hs', 'caso.suspender', 'operador.gerenciar',
    'interacao.registrar', 'tarefa.gerenciar', 'negociacao.propor', 'negociacao.revisar', 'pagamento.informar',
    'documento.ler', 'prestacao.gerar', 'lgpd.gerenciar',
    // leitura global de dados de empresas — sempre auditada como ACESSO_ADMINISTRATIVO
    'empresa.ler', 'devedor.ler', 'divida.ler', 'carteira.ler', 'relatorio.empresa', 'contrato.ler', 'assinatura.ler', 'pagamento.ler',
  ],
  GESTOR_OPERACOES_HS: [
    'carteira.validar', 'caso.distribuir', 'caso.ler_todos_hs', 'caso.suspender', 'operador.ver',
    'interacao.registrar', 'tarefa.gerenciar', 'negociacao.propor', 'negociacao.revisar', 'pagamento.informar',
    'relatorio.hs', 'documento.ler', 'prestacao.gerar',
  ],
  OPERADOR_HS: [
    'caso.ler_atribuidos', 'caso.puxar_fila', 'interacao.registrar', 'tarefa.gerenciar', 'negociacao.propor',
    'pagamento.informar', 'documento.ler',
  ],
  ADMIN_EMPRESA: [
    ...LEITURA_EMPRESA, 'empresa.editar', 'usuario.gerenciar_empresa', 'devedor.editar', 'divida.editar',
    'carteira.editar', 'carteira.encaminhar_hs', 'autorizacao.conceder', 'negociacao.aprovar_empresa',
    'negociacao.propor', 'interacao.registrar', 'tarefa.gerenciar', 'pagamento.informar', 'pagamento.confirmar',
    'contrato.contratar', 'assinatura.gerenciar_propria', 'documento.enviar', 'caso.suspender_proprio',
    'lgpd.atender', 'relatorio.exportar',
  ],
  FINANCEIRO_EMPRESA: [
    ...LEITURA_EMPRESA, 'negociacao.aprovar_empresa', 'pagamento.informar', 'pagamento.confirmar', 'relatorio.exportar',
  ],
  VISUALIZADOR_EMPRESA: [...LEITURA_EMPRESA],
};

export function isHS(user) {
  return PERFIS_HS.includes(user?.perfil);
}

export function can(user, perm) {
  if (!user || user.status !== 'ATIVO') return false;
  const perms = MATRIZ[user.perfil] || [];
  return perms.includes(perm);
}

export function requirePerm(user, perm) {
  if (!user) throw new AccessError('Não autenticado', 401);
  if (user.status !== 'ATIVO') throw new AccessError('Usuário inativo ou bloqueado');
  if (!can(user, perm)) throw new AccessError(`Permissão necessária: ${perm}`);
}

/** Usuário de empresa só toca registros da própria empresa. */
export function assertMesmaEmpresa(user, registro) {
  if (!registro) throw new AccessError('Registro não encontrado', 404);
  if (isHS(user)) return; // HS passa pelas regras de caso (assertAcessoCasoHS)
  if (!user.empresa_id || registro.empresa_id !== user.empresa_id) {
    // 404 em vez de 403 para não revelar a existência do registro
    throw new AccessError('Registro não encontrado', 404);
  }
}

/** Regras de acesso de usuários HS a um caso de cobrança. */
export function podeAcessarCasoHS(user, caso) {
  if (!caso || caso.modalidade_cobranca !== 'HS_GERENCIADA') return user?.perfil === 'SUPERADMIN_HS' && !!caso;
  if (user.perfil === 'SUPERADMIN_HS' || user.perfil === 'GESTOR_OPERACOES_HS') return true;
  if (user.perfil === 'OPERADOR_HS') {
    return caso.operador_id === user.id && STATUS_OPERAVEIS_OPERADOR.has(caso.status_operacional);
  }
  return false;
}

// Operador perde acesso aos casos antes da validação/autorização e após o encerramento
const STATUS_OPERAVEIS_OPERADOR = new Set([
  'ATRIBUIDO', 'PRIMEIRO_CONTATO_PENDENTE', 'EM_CONTATO', 'DEVEDOR_RESPONDEU', 'EM_NEGOCIACAO',
  'ACORDO_AGUARDANDO_PAGAMENTO', 'PAGAMENTO_INFORMADO', 'PAGAMENTO_EM_CONFIRMACAO', 'PARCIALMENTE_RECUPERADO',
  'CONTESTACAO',
]);

export function assertAcessoCaso(user, caso) {
  if (!caso) throw new AccessError('Caso não encontrado', 404);
  if (isHS(user)) {
    if (!podeAcessarCasoHS(user, caso)) throw new AccessError('Caso não encontrado', 404);
    return;
  }
  assertMesmaEmpresa(user, caso);
}

/** Campos do caso que um operador pode ver (minimização de dados - LGPD). */
export function filtrarDevedorParaHS(devedor) {
  if (!devedor) return devedor;
  const { observacoes_internas, ...rest } = devedor;
  return rest;
}
