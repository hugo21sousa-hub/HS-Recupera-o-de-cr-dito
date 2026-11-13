import { MATRIZ, PERFIS_EMPRESA, PERFIS_HS, PERFIS } from '../../core/permissions.js';
import { cnpjValido, somenteDigitos, emailValido } from '../../core/documento.js';
import {
  AccessError, ValidationError, requirePerm, isHS, getById, find, criar, alterar, auditar,
  empresaAlvo, paginar, filtrosPermitidos, exigir, notificar,
} from '../context.js';
import { situacaoAcesso, resumoAcesso } from '../acesso.js';

const STATUS_EMPRESA = ['CADASTRO_INCOMPLETO', 'AGUARDANDO_VALIDACAO', 'ATIVA', 'SUSPENSA', 'CANCELADA'];
const CAMPOS_EMPRESA = ['razao_social', 'nome_fantasia', 'email', 'telefone', 'endereco', 'responsavel_legal', 'contato_nome', 'contato_telefone', 'contato_email'];

function validarEmpresa(d, parcial = false) {
  const req = ['razao_social', 'cnpj', 'email', 'telefone', 'endereco', 'responsavel_legal'];
  if (!parcial) for (const k of req) exigir(String(d[k] ?? '').trim(), `Campo obrigatório: ${k}`);
  if (d.cnpj !== undefined) exigir(cnpjValido(d.cnpj), 'CNPJ inválido');
  if (d.email !== undefined) exigir(emailValido(d.email), 'E-mail inválido');
}

function completo(e) {
  return ['razao_social', 'cnpj', 'email', 'telefone', 'endereco', 'responsavel_legal'].every((k) => String(e[k] ?? '').trim());
}

export const actions = {
  /** Retorna o perfil do usuário autenticado (ou null se ainda não vinculado). */
  meuPerfil: {
    publico: true,
    async run(ctx) {
      if (!ctx.user) return { usuario: null, conta: { email: ctx.authEmail, nome: ctx.authName || '' }, permissoes: [], empresa: null, precisa_onboarding: true };
      const empresa = ctx.user.empresa_id ? await getById(ctx, 'Empresa', ctx.user.empresa_id) : null;
      return {
        usuario: { id: ctx.user.id, nome: ctx.user.nome, email: ctx.user.email, perfil: ctx.user.perfil, status: ctx.user.status },
        permissoes: ctx.user.status === 'ATIVO' ? MATRIZ[ctx.user.perfil] || [] : [],
        empresa,
        acesso: empresa && !isHS(ctx.user) ? resumoAcesso(await situacaoAcesso(ctx, empresa.id)) : null,
        precisa_onboarding: !isHS(ctx.user) && (!empresa || !empresa.modalidade_servico),
      };
    },
  },

  /** Onboarding: usuário autenticado sem vínculo cria a empresa e vira ADMIN_EMPRESA. */
  registrarEmpresa: {
    publico: true,
    async run(ctx, input) {
      if (ctx.user) throw new ValidationError('Usuário já vinculado a uma empresa ou à equipe Acorly');
      exigir(input.aceite_termos === true, 'É necessário aceitar os termos de uso');
      exigir(input.aceite_privacidade === true, 'É necessário aceitar a política de privacidade');
      validarEmpresa(input);
      const cnpj = somenteDigitos(input.cnpj);
      const existente = await find(ctx, 'Empresa', { cnpj });
      if (existente.length) throw new ValidationError('CNPJ já cadastrado. Solicite acesso ao administrador da empresa.');
      const agora = ctx.now().toISOString();
      const dados = Object.fromEntries(CAMPOS_EMPRESA.map((k) => [k, input[k] ?? '']));
      const empresa = await ctx.db.Empresa.create({
        ...dados, cnpj, status: 'CADASTRO_INCOMPLETO', data_cadastro: agora,
        aceite_termos_em: agora, aceite_privacidade_em: agora, versao_termos: input.versao_termos || 'v1',
        modalidade_servico: null,
      });
      const user = await ctx.db.UsuarioPlataforma.create({
        nome: input.admin_nome || ctx.authName || ctx.authEmail, email: ctx.authEmail, perfil: 'ADMIN_EMPRESA',
        empresa_id: empresa.id, status: 'ATIVO', data_criacao: agora,
      });
      ctx.user = user;
      await auditar(ctx, { acao: 'CRIAR', entidade: 'Empresa', registro_id: empresa.id, depois: empresa });
      await auditar(ctx, { acao: 'ACEITE_TERMOS', entidade: 'Empresa', registro_id: empresa.id, empresa_id: empresa.id, depois: { versao_termos: empresa.versao_termos, em: agora } });
      return { empresa, usuario: user };
    },
  },

  /** Onboarding: escolha do serviço (A = plataforma, B = cobrança gerenciada). */
  escolherServico: {
    perm: 'empresa.editar',
    async run(ctx, input) {
      const empresa = await getById(ctx, 'Empresa', ctx.user.empresa_id);
      exigir(['PLATAFORMA', 'HS_GERENCIADA', 'AMBOS'].includes(input.modalidade_servico), 'Modalidade de serviço inválida');
      let contrato = null;
      if (input.modalidade_servico !== 'PLATAFORMA') {
        exigir(['CARTEIRA_SELECIONADA', 'TODOS_ELEGIVEIS'].includes(input.tipo_carteira), 'Escolha cobrança por carteira selecionada ou de todos os elegíveis');
        contrato = await criar(ctx, 'ContratoServico', {
          empresa_id: empresa.id, modalidade: input.tipo_carteira === 'TODOS_ELEGIVEIS' ? 'CARTEIRA_COMPLETA' : 'CARTEIRA_ESPECIFICA',
          tipo_carteira: input.tipo_carteira, status: 'SOLICITADO', aceite: false, observacoes: input.observacoes || '',
        });
        await notificar(ctx, null, { perfis: ['SUPERADMIN_HS'], tipo: 'CONTRATO_SOLICITADO', titulo: 'Nova solicitação de cobrança gerenciada', mensagem: `${empresa.razao_social} solicitou cobrança gerenciada.` });
      }
      const patch = { modalidade_servico: input.modalidade_servico };
      if (empresa.status === 'CADASTRO_INCOMPLETO' && completo(empresa)) patch.status = 'AGUARDANDO_VALIDACAO';
      const emp = await alterar(ctx, 'Empresa', empresa, patch, 'ESCOLHER_SERVICO');
      return { empresa: emp, contrato };
    },
  },

  atualizarEmpresa: {
    perm: null,
    async run(ctx, input) {
      const id = isHS(ctx.user) ? input.empresa_id : ctx.user.empresa_id;
      requirePerm(ctx.user, isHS(ctx.user) ? 'empresa.gerenciar_todas' : 'empresa.editar');
      const empresa = await getById(ctx, 'Empresa', id);
      if (!empresa) throw new AccessError('Empresa não encontrada', 404);
      const patch = Object.fromEntries(CAMPOS_EMPRESA.filter((k) => input[k] !== undefined).map((k) => [k, input[k]]));
      validarEmpresa(patch, true);
      if (empresa.status === 'CADASTRO_INCOMPLETO' && empresa.modalidade_servico && completo({ ...empresa, ...patch })) patch.status = 'AGUARDANDO_VALIDACAO';
      return alterar(ctx, 'Empresa', empresa, patch);
    },
  },

  alterarStatusEmpresa: {
    perm: 'empresa.gerenciar_todas',
    async run(ctx, { empresa_id, status, motivo }) {
      exigir(STATUS_EMPRESA.includes(status), 'Status inválido');
      exigir(motivo, 'Motivo obrigatório');
      const empresa = await getById(ctx, 'Empresa', empresa_id);
      if (!empresa) throw new AccessError('Empresa não encontrada', 404);
      if (status === 'ATIVA') exigir(completo(empresa), 'Cadastro da empresa incompleto');
      const r = await alterar(ctx, 'Empresa', empresa, { status, motivo_status: motivo }, 'ALTERAR_STATUS_EMPRESA');
      await notificar(ctx, empresa.id, { perfis: ['ADMIN_EMPRESA'], tipo: 'EMPRESA_STATUS', titulo: `Empresa ${status}`, mensagem: motivo });
      return r;
    },
  },

  listarEmpresas: {
    perm: 'empresa.gerenciar_todas',
    async run(ctx, input = {}) {
      const rows = await find(ctx, 'Empresa', filtrosPermitidos(input.filtros, ['status', 'modalidade_servico']));
      return paginar(rows, { ...input, camposBusca: ['razao_social', 'nome_fantasia', 'cnpj', 'email'] });
    },
  },

  /** Empresas atendidas pelo Acorly (gestor/operações): só nome e contrato, sem dados de devedores. */
  listarEmpresasAtendidas: {
    perm: 'caso.ler_todos_hs',
    async run(ctx) {
      const contratos = await find(ctx, 'ContratoServico', { status: 'ATIVO' });
      const ids = [...new Set(contratos.map((c) => c.empresa_id))];
      const out = [];
      for (const id of ids) {
        const e = await getById(ctx, 'Empresa', id);
        if (e) out.push({ id: e.id, razao_social: e.razao_social, nome_fantasia: e.nome_fantasia, status: e.status, contratos: contratos.filter((c) => c.empresa_id === id).length });
      }
      return out;
    },
  },

  /** Cria/convida usuário. Admin de empresa só cria perfis da própria empresa. */
  convidarUsuario: {
    perm: null,
    async run(ctx, input) {
      const { nome, email, perfil } = input;
      exigir(PERFIS.includes(perfil), 'Perfil inválido');
      exigir(emailValido(email), 'E-mail inválido');
      let empresa_id = null;
      if (PERFIS_HS.includes(perfil)) {
        requirePerm(ctx.user, 'usuario.gerenciar_interno');
      } else {
        requirePerm(ctx.user, 'usuario.gerenciar_empresa');
        empresa_id = isHS(ctx.user) ? await empresaAlvo(ctx, input) : ctx.user.empresa_id;
        const emp = await getById(ctx, 'Empresa', empresa_id);
        exigir(emp, 'Empresa não encontrada');
        await verificarLimiteUsuarios(ctx, empresa_id);
      }
      const em = email.trim().toLowerCase();
      const existe = await find(ctx, 'UsuarioPlataforma', { email: em });
      if (existe.length) throw new ValidationError('E-mail já vinculado a um usuário da plataforma');
      const u = await criar(ctx, 'UsuarioPlataforma', {
        nome: nome || em, email: em, perfil, empresa_id, status: 'ATIVO', data_criacao: ctx.now().toISOString(),
        capacidade_casos: perfil === 'OPERADOR_HS' ? Number(input.capacidade_casos) || 50 : null,
        alcada_desconto_bps: perfil === 'OPERADOR_HS' ? Number(input.alcada_desconto_bps) || 0 : null,
      });
      const convite = ctx.invite ? await ctx.invite(em) : null;
      return { ...u, convite_link: convite?.link || null, convite_expira_em: convite?.expira_em || null, convite_enviado_por_email: !!convite?.enviado_por_email };
    },
  },

  /** Gera novo link de acesso (primeiro acesso ou redefinição de senha) para um usuário do seu escopo. */
  gerarLinkAcesso: {
    perm: null,
    async run(ctx, { usuario_id }) {
      const alvo = await getById(ctx, 'UsuarioPlataforma', usuario_id);
      if (!alvo) throw new AccessError('Usuário não encontrado', 404);
      if (PERFIS_HS.includes(alvo.perfil)) requirePerm(ctx.user, 'usuario.gerenciar_interno');
      else {
        requirePerm(ctx.user, 'usuario.gerenciar_empresa');
        if (!isHS(ctx.user) && alvo.empresa_id !== ctx.user.empresa_id) throw new AccessError('Usuário não encontrado', 404);
      }
      exigir(alvo.status === 'ATIVO', 'Ative o usuário antes de gerar o link');
      exigir(ctx.invite, 'Convites indisponíveis');
      const convite = await ctx.invite(alvo.email);
      await auditar(ctx, { acao: 'GERAR_LINK_ACESSO', entidade: 'UsuarioPlataforma', registro_id: alvo.id, empresa_id: alvo.empresa_id });
      return { link: convite.link, expira_em: convite.expira_em, email: alvo.email, enviado_por_email: !!convite.enviado_por_email };
    },
  },

  alterarUsuario: {
    perm: null,
    async run(ctx, input) {
      const alvo = await getById(ctx, 'UsuarioPlataforma', input.usuario_id);
      if (!alvo) throw new AccessError('Usuário não encontrado', 404);
      if (alvo.id === ctx.user.id && (input.perfil || input.status)) throw new ValidationError('Não é permitido alterar o próprio perfil ou status');
      if (PERFIS_HS.includes(alvo.perfil)) requirePerm(ctx.user, 'usuario.gerenciar_interno');
      else {
        requirePerm(ctx.user, 'usuario.gerenciar_empresa');
        if (!isHS(ctx.user) && alvo.empresa_id !== ctx.user.empresa_id) throw new AccessError('Usuário não encontrado', 404);
      }
      const patch = {};
      if (input.nome) patch.nome = input.nome;
      if (input.status) { exigir(['ATIVO', 'BLOQUEADO', 'INATIVO'].includes(input.status), 'Status inválido'); patch.status = input.status; }
      if (input.perfil) {
        const mesmaFamilia = PERFIS_HS.includes(alvo.perfil) === PERFIS_HS.includes(input.perfil);
        exigir(PERFIS.includes(input.perfil) && mesmaFamilia, 'Mudança de perfil inválida');
        patch.perfil = input.perfil;
      }
      if (input.capacidade_casos !== undefined && alvo.perfil === 'OPERADOR_HS') { requirePerm(ctx.user, 'operador.gerenciar'); patch.capacidade_casos = Number(input.capacidade_casos); }
      if (input.alcada_desconto_bps !== undefined && alvo.perfil === 'OPERADOR_HS') { requirePerm(ctx.user, 'operador.gerenciar'); patch.alcada_desconto_bps = Number(input.alcada_desconto_bps); }
      return alterar(ctx, 'UsuarioPlataforma', alvo, patch, 'ALTERAR_USUARIO');
    },
  },

  listarUsuarios: {
    perm: null,
    async run(ctx, input = {}) {
      let rows;
      if (input.internos) {
        requirePerm(ctx.user, 'usuario.gerenciar_interno');
        rows = (await find(ctx, 'UsuarioPlataforma')).filter((u) => PERFIS_HS.includes(u.perfil));
      } else {
        requirePerm(ctx.user, 'usuario.gerenciar_empresa');
        const empresa_id = isHS(ctx.user) ? await empresaAlvo(ctx, input) : ctx.user.empresa_id;
        rows = await find(ctx, 'UsuarioPlataforma', { empresa_id });
      }
      return paginar(rows, { ...input, camposBusca: ['nome', 'email', 'perfil'] });
    },
  },

  listarNotificacoes: {
    perm: null,
    async run(ctx, input = {}) {
      const rows = await find(ctx, 'Notificacao', { usuario_id: ctx.user.id });
      return paginar(input.naoLidas ? rows.filter((n) => !n.lida) : rows, { ...input, ordenarPor: 'data_criacao' });
    },
  },

  marcarNotificacaoLida: {
    perm: null,
    async run(ctx, { notificacao_id }) {
      const n = await getById(ctx, 'Notificacao', notificacao_id);
      if (!n || n.usuario_id !== ctx.user.id) throw new AccessError('Notificação não encontrada', 404);
      await ctx.db.Notificacao.update(n.id, { lida: true });
      return { ok: true };
    },
  },

  listarAuditoria: {
    perm: 'auditoria.ler',
    async run(ctx, input = {}) {
      const rows = await find(ctx, 'HistoricoAuditoria', filtrosPermitidos(input.filtros, ['empresa_id', 'usuario_id', 'entidade', 'acao', 'registro_id']));
      return paginar(rows, { ...input, ordenarPor: 'data_hora' });
    },
  },
};

const nomeDoLimite = (s) => (s.modo === 'TESTE' ? 'do teste grátis' : s.plano ? `do plano ${s.plano.nome}` : 'do seu acesso');

async function verificarLimiteUsuarios(ctx, empresa_id) {
  const s = await situacaoAcesso(ctx, empresa_id);
  const limite = s.limites.usuarios;
  if (!limite) return;
  const usuarios = (await find(ctx, 'UsuarioPlataforma', { empresa_id })).filter((u) => u.status === 'ATIVO');
  if (usuarios.length >= limite) throw new ValidationError(`Limite de ${limite} usuários ${nomeDoLimite(s)} atingido. Mude de plano em Assinatura para incluir mais pessoas.`);
}

export async function verificarLimiteDevedores(ctx, empresa_id, novos = 1) {
  const s = await situacaoAcesso(ctx, empresa_id);
  const limite = s.limites.devedores;
  if (!limite) return;
  const atuais = (await find(ctx, 'Devedor', { empresa_id })).filter((d) => d.status !== 'ANONIMIZADO').length;
  if (atuais + novos > limite) throw new ValidationError(`Limite de ${limite} devedores ${nomeDoLimite(s)} atingido. Mude de plano em Assinatura para cadastrar mais.`);
}

export { PERFIS_EMPRESA };
