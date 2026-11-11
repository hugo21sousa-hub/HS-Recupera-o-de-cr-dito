import { transicao, casoAtivo, TERMINAIS } from '../../core/caseStatus.js';
import { podeAcessarCasoHS, filtrarDevedorParaHS, isHS, can } from '../../core/permissions.js';
import { verificarMensagem, LIMITE_CONTATOS_DIA, dentroDoHorario, preencherModelo } from '../../core/compliance.js';
import { telefoneBR } from '../../core/documento.js';
import { diasAtraso } from '../../core/dates.js';
import { formatBRL } from '../../core/money.js';
import { validarCarteira } from '../../core/portfolio.js';
import {
  AccessError, ValidationError, requirePerm, getById, find, criar, alterar, auditar, carregarCaso, empresaAlvo,
  paginar, filtrosPermitidos, exigir, notificar, comNomes,
} from '../context.js';

const STATUS_MANUAIS = new Set(['PRIMEIRO_CONTATO_PENDENTE', 'EM_CONTATO', 'DEVEDOR_RESPONDEU', 'EM_NEGOCIACAO', 'SEM_SUCESSO', 'CONTESTACAO', 'SUSPENSO', 'REATIVAR']);
const TIPOS_INTERACAO = ['TENTATIVA_CONTATO', 'MENSAGEM_ENVIADA', 'LIGACAO', 'RESPOSTA_DEVEDOR', 'SEM_RESPOSTA', 'RETORNO_AGENDADO', 'NOTA_INTERNA'];
const SAIDA = new Set(['TENTATIVA_CONTATO', 'MENSAGEM_ENVIADA', 'LIGACAO']);
const RESULTADOS = ['SEM_RESPOSTA', 'RESPONDEU', 'NUMERO_INVALIDO', 'PROMESSA_PAGAMENTO', 'RECUSA', 'CONTESTOU', 'SOLICITOU_INTERRUPCAO', 'OUTRO'];
const CANAIS = ['WHATSAPP', 'TELEFONE', 'EMAIL', 'SMS', 'CARTA', 'PRESENCIAL', 'INTERNO'];
const PRIORIDADE = { URGENTE: 0, ALTA: 1, NORMAL: 2, BAIXA: 3 };

async function cargaOperador(ctx, operador_id) {
  return (await find(ctx, 'CasoCobranca', { operador_id })).filter((c) => casoAtivo(c) && c.status_operacional !== 'SUSPENSO').length;
}

async function operadorValido(ctx, operador_id) {
  const op = await getById(ctx, 'UsuarioPlataforma', operador_id);
  if (!op || op.perfil !== 'OPERADOR_HS' || op.status !== 'ATIVO') throw new ValidationError('Operador inválido ou inativo');
  return op;
}

async function atribuir(ctx, caso, op, { forcar = false } = {}) {
  exigir(caso.modalidade_cobranca === 'HS_GERENCIADA', 'Somente casos HS podem ser atribuídos a operadores');
  exigir(casoAtivo(caso) && !['AGUARDANDO_VALIDACAO', 'AGUARDANDO_AUTORIZACAO', 'SUSPENSO'].includes(caso.status_operacional), 'Caso não está liberado para distribuição');
  const carga = await cargaOperador(ctx, op.id);
  if (!forcar && carga >= (op.capacidade_casos || 50)) throw new ValidationError(`Operador ${op.nome} atingiu a capacidade (${op.capacidade_casos})`);
  const anteriores = (await find(ctx, 'Atribuicao', { caso_id: caso.id })).filter((a) => a.status === 'ATIVA');
  for (const a of anteriores) await ctx.db.Atribuicao.update(a.id, { status: 'ENCERRADA', data_encerramento: ctx.now().toISOString() });
  await ctx.db.Atribuicao.create({
    empresa_id: caso.empresa_id, caso_id: caso.id, operador_id: op.id, operador_anterior_id: caso.operador_id || null,
    atribuido_por: ctx.user.id, data_atribuicao: ctx.now().toISOString(), status: 'ATIVA',
  });
  const patch = { operador_id: op.id, gestor_id: ctx.user.perfil === 'OPERADOR_HS' ? caso.gestor_id : ctx.user.id };
  if (['PRONTO_PARA_COBRANCA', 'AGUARDANDO_OPERADOR'].includes(caso.status_operacional)) patch.status_operacional = 'ATRIBUIDO';
  const r = await alterar(ctx, 'CasoCobranca', caso, patch, 'ATRIBUIR_CASO');
  await ctx.db.Notificacao.create({ empresa_id: null, usuario_id: op.id, tipo: 'CASO_ATRIBUIDO', titulo: 'Novo caso atribuído', mensagem: `Caso ${caso.id}`, lida: false, data_criacao: ctx.now().toISOString(), link: `/casos/${caso.id}` });
  return r;
}

async function enriquecer(ctx, casos) {
  const cache = new Map();
  const get = async (ent, id) => {
    if (!id) return null;
    const k = ent + id;
    if (!cache.has(k)) cache.set(k, await getById(ctx, ent, id));
    return cache.get(k);
  };
  const hoje = ctx.now().toISOString().slice(0, 10);
  const out = [];
  for (const c of casos) {
    const [div, dev, emp, op] = await Promise.all([get('Divida', c.divida_id), get('Devedor', c.devedor_id), get('Empresa', c.empresa_id), get('UsuarioPlataforma', c.operador_id)]);
    const tarefas = (await find(ctx, 'Tarefa', { caso_id: c.id })).filter((t) => t.status === 'PENDENTE').sort((a, b) => (a.data_prazo > b.data_prazo ? 1 : -1));
    out.push({
      ...c, credor: emp?.nome_fantasia || emp?.razao_social, devedor_nome: dev?.nome,
      valor_original_centavos: div?.valor_original_centavos, saldo_atual_centavos: div?.saldo_atual_centavos,
      dias_atraso: div ? diasAtraso(div.data_vencimento, hoje) : null, operador_nome: op?.nome || null,
      proxima_tarefa: tarefas[0] ? { id: tarefas[0].id, descricao: tarefas[0].descricao, data_prazo: tarefas[0].data_prazo } : null,
    });
  }
  return out;
}

export const actions = {
  listarCasos: {
    perm: null,
    async run(ctx, input = {}) {
      const u = ctx.user;
      const escopo = input.escopo || 'todos';
      let rows;
      if (!isHS(u)) {
        requirePerm(u, 'caso.ler_empresa');
        rows = await find(ctx, 'CasoCobranca', { empresa_id: u.empresa_id });
      } else if (u.perfil === 'OPERADOR_HS') {
        requirePerm(u, 'caso.ler_atribuidos');
        rows = (await find(ctx, 'CasoCobranca', { operador_id: u.id })).filter((c) => podeAcessarCasoHS(u, c));
      } else {
        requirePerm(u, 'caso.ler_todos_hs');
        rows = await find(ctx, 'CasoCobranca', { modalidade_cobranca: 'HS_GERENCIADA' });
      }
      if (escopo === 'meus') rows = rows.filter((c) => c.operador_id === u.id || c.responsavel_empresa_id === u.id);
      if (escopo === 'validacao') rows = rows.filter((c) => c.status_operacional === 'AGUARDANDO_VALIDACAO');
      if (escopo === 'fila') rows = rows.filter((c) => ['PRONTO_PARA_COBRANCA', 'AGUARDANDO_OPERADOR'].includes(c.status_operacional));
      if (escopo === 'pagamentos') rows = rows.filter((c) => ['PAGAMENTO_INFORMADO', 'PAGAMENTO_EM_CONFIRMACAO'].includes(c.status_operacional));
      const q = filtrosPermitidos(input.filtros, ['status_operacional', 'modalidade_cobranca', 'operador_id', 'gestor_id', 'empresa_id', 'carteira_id', 'prioridade']);
      rows = rows.filter((c) => Object.entries(q).every(([k, v]) => c[k] === v));
      const f = input.filtros || {};
      if (f.de) rows = rows.filter((c) => (c.data_recebimento || '') >= f.de);
      if (f.ate) rows = rows.filter((c) => (c.data_recebimento || '').slice(0, 10) <= f.ate);
      const pag = paginar(rows, { ...input, ordenarPor: input.ordenarPor || 'data_recebimento' });
      pag.itens = await enriquecer(ctx, pag.itens);
      return pag;
    },
  },

  detalheCaso: {
    perm: null,
    async run(ctx, { caso_id }) {
      const caso = await carregarCaso(ctx, caso_id);
      const q = { caso_id: caso.id };
      const [divida, devedorBruto, empresa, autorizacao, interacoes, tarefas, negociacoes, acordos, atribuicoes] = await Promise.all([
        getById(ctx, 'Divida', caso.divida_id), getById(ctx, 'Devedor', caso.devedor_id), getById(ctx, 'Empresa', caso.empresa_id),
        getById(ctx, 'AutorizacaoCobranca', caso.autorizacao_id), find(ctx, 'Interacao', q), find(ctx, 'Tarefa', q),
        find(ctx, 'Negociacao', q), find(ctx, 'Acordo', q), find(ctx, 'Atribuicao', q),
      ]);
      const [documentos, pagamentos, parcelas] = await Promise.all([
        find(ctx, 'DocumentoDivida', { divida_id: caso.divida_id }), find(ctx, 'Pagamento', { divida_id: caso.divida_id }),
        find(ctx, 'Parcela', { divida_id: caso.divida_id }),
      ]);
      const operador = caso.operador_id ? await getById(ctx, 'UsuarioPlataforma', caso.operador_id) : null;
      const devedor = isHS(ctx.user) ? filtrarDevedorParaHS(devedorBruto) : devedorBruto;
      return {
        caso, credor: { id: empresa.id, nome: empresa.nome_fantasia || empresa.razao_social },
        divida: { ...divida, dias_atraso: diasAtraso(divida.data_vencimento, ctx.now().toISOString().slice(0, 10)) },
        devedor, autorizacao, operador: operador ? { id: operador.id, nome: operador.nome } : null,
        documentos: documentos.map(({ arquivo, ...m }) => m),
        interacoes: interacoes.sort((a, b) => (a.data_hora < b.data_hora ? 1 : -1)), tarefas, negociacoes, acordos, pagamentos,
        parcelas: parcelas.filter((p) => p.status !== 'SUBSTITUIDA'),
        atribuicoes: await Promise.all(atribuicoes.map(async (a) => ({ ...a, operador_nome: (await getById(ctx, 'UsuarioPlataforma', a.operador_id))?.nome, atribuido_por_nome: (await getById(ctx, 'UsuarioPlataforma', a.atribuido_por))?.nome }))),
        integracao_whatsapp: ctx.whatsapp?.disponivel && caso.modalidade_cobranca === 'HS_GERENCIADA' && isHS(ctx.user) ? 'API' : 'MANUAL',
      };
    },
  },

  validarCaso: {
    perm: 'carteira.validar',
    async run(ctx, input) {
      const ids = input.caso_ids || [input.caso_id];
      const out = { aprovados: 0, reprovados: 0, erros: [] };
      for (const id of ids) {
        const caso = await carregarCaso(ctx, id);
        try {
          exigir(caso.status_operacional === 'AGUARDANDO_VALIDACAO', 'Caso não está aguardando validação');
          const div = await getById(ctx, 'Divida', caso.divida_id);
          if (input.aprovado) {
            const aut = await getById(ctx, 'AutorizacaoCobranca', caso.autorizacao_id);
            exigir(aut?.status === 'ATIVA', 'Autorização ausente ou revogada');
            const v = validarCarteira([{ divida: div, devedor: await getById(ctx, 'Devedor', caso.devedor_id), documentos: await find(ctx, 'DocumentoDivida', { divida_id: div.id }), casoAtivo: false }], { hoje: ctx.now().toISOString().slice(0, 10) });
            exigir(v.itens[0].elegivel, `Registro inválido: ${[...v.itens[0].problemas, ...v.itens[0].pendencias].join('; ')}`);
            await alterar(ctx, 'CasoCobranca', caso, { status_operacional: 'AGUARDANDO_OPERADOR', validado_por: ctx.user.id, data_validacao: ctx.now().toISOString(), gestor_id: ctx.user.id }, 'VALIDAR_CASO');
            await alterar(ctx, 'Divida', div, { status_validacao: 'VALIDADA' }, 'VALIDAR_DIVIDA');
            out.aprovados++;
          } else {
            exigir(input.motivo, 'Motivo obrigatório para reprovação');
            await alterar(ctx, 'CasoCobranca', caso, { ...transicao(caso, 'SUSPENSO', { motivo: `Devolvido na validação: ${input.motivo}` }), validado_por: ctx.user.id }, 'REPROVAR_CASO');
            await alterar(ctx, 'Divida', div, { status_validacao: 'REPROVADA', pendencia_validacao: input.motivo }, 'REPROVAR_DIVIDA');
            await notificar(ctx, caso.empresa_id, { perfis: ['ADMIN_EMPRESA'], tipo: 'VALIDACAO_REPROVADA', titulo: 'Dívida devolvida para correção', mensagem: input.motivo, link: `/dividas/${div.id}` });
            out.reprovados++;
          }
        } catch (e) {
          if (ids.length === 1) throw e;
          out.erros.push({ caso_id: id, erro: e.message });
        }
      }
      return out;
    },
  },

  atribuirCaso: {
    perm: 'caso.distribuir',
    async run(ctx, input) {
      const caso = await carregarCaso(ctx, input.caso_id);
      const op = await operadorValido(ctx, input.operador_id);
      return atribuir(ctx, caso, op, { forcar: input.forcar === true });
    },
  },

  /** Distribuição por capacidade: menor carga relativa primeiro; fila por prioridade e antiguidade. */
  distribuirAutomatico: {
    perm: 'caso.distribuir',
    async run(ctx, input = {}) {
      const fila = (await find(ctx, 'CasoCobranca', { modalidade_cobranca: 'HS_GERENCIADA' }))
        .filter((c) => ['PRONTO_PARA_COBRANCA', 'AGUARDANDO_OPERADOR'].includes(c.status_operacional))
        .filter((c) => !input.empresa_id || c.empresa_id === input.empresa_id)
        .sort((a, b) => (PRIORIDADE[a.prioridade] ?? 2) - (PRIORIDADE[b.prioridade] ?? 2) || (a.data_recebimento > b.data_recebimento ? 1 : -1));
      const ops = (await find(ctx, 'UsuarioPlataforma', { perfil: 'OPERADOR_HS', status: 'ATIVO' }));
      const carga = new Map();
      for (const o of ops) carga.set(o.id, await cargaOperador(ctx, o.id));
      let atribuidos = 0;
      const limite = Math.min(Number(input.limite) || fila.length, fila.length);
      for (const caso of fila.slice(0, limite)) {
        const livres = ops.filter((o) => carga.get(o.id) < (o.capacidade_casos || 50))
          .sort((a, b) => carga.get(a.id) / (a.capacidade_casos || 50) - carga.get(b.id) / (b.capacidade_casos || 50));
        if (!livres.length) break;
        await atribuir(ctx, caso, livres[0]);
        carga.set(livres[0].id, carga.get(livres[0].id) + 1);
        atribuidos++;
      }
      return { atribuidos, restantes_na_fila: fila.length - atribuidos };
    },
  },

  /** Operador puxa o próximo caso da fila (respeita a própria capacidade). */
  puxarProximoCaso: {
    perm: 'caso.puxar_fila',
    async run(ctx) {
      const fila = (await find(ctx, 'CasoCobranca', { modalidade_cobranca: 'HS_GERENCIADA', status_operacional: 'AGUARDANDO_OPERADOR' }))
        .sort((a, b) => (PRIORIDADE[a.prioridade] ?? 2) - (PRIORIDADE[b.prioridade] ?? 2) || (a.data_recebimento > b.data_recebimento ? 1 : -1));
      if (!fila.length) return { caso: null, mensagem: 'Fila vazia' };
      const op = await operadorValido(ctx, ctx.user.id);
      return { caso: await atribuir(ctx, fila[0], op) };
    },
  },

  alterarStatusCaso: {
    perm: null,
    async run(ctx, { caso_id, status, motivo }) {
      const caso = await carregarCaso(ctx, caso_id);
      exigir(STATUS_MANUAIS.has(status), 'Este status é definido automaticamente pelo fluxo (atribuição, acordo ou pagamento)');
      const u = ctx.user;
      if (status === 'SUSPENSO' || status === 'REATIVAR') {
        if (isHS(u)) requirePerm(u, 'caso.suspender');
        else requirePerm(u, 'caso.suspender_proprio');
        if (status === 'REATIVAR' && caso.modalidade_cobranca === 'HS_GERENCIADA') {
          const aut = await getById(ctx, 'AutorizacaoCobranca', caso.autorizacao_id);
          exigir(aut?.status === 'ATIVA', 'Autorização revogada: o credor precisa emitir nova autorização');
          const div = await getById(ctx, 'Divida', caso.divida_id);
          exigir(div.status_validacao !== 'REPROVADA' || !isHS(u) || can(u, 'carteira.validar'), 'Dívida reprovada na validação');
          if (div.status_validacao === 'REPROVADA') {
            await alterar(ctx, 'Divida', div, { status_validacao: 'EM_VALIDACAO' }, 'REENVIAR_VALIDACAO');
            return alterar(ctx, 'CasoCobranca', caso, { status_operacional: 'AGUARDANDO_VALIDACAO', status_anterior: null, motivo_status: motivo }, 'REATIVAR_CASO');
          }
        }
      } else if (isHS(u)) {
        requirePerm(u, 'interacao.registrar');
      } else {
        requirePerm(u, 'interacao.registrar');
        exigir(caso.modalidade_cobranca === 'AUTOCONTRATADA', 'Casos HS são conduzidos pela equipe HS');
      }
      const patch = transicao(caso, status, { motivo, agora: ctx.now().toISOString() });
      const r = await alterar(ctx, 'CasoCobranca', caso, patch, status === 'REATIVAR' ? 'REATIVAR_CASO' : 'ALTERAR_STATUS_CASO');
      if (caso.modalidade_cobranca === 'HS_GERENCIADA' && ['SUSPENSO', 'SEM_SUCESSO', 'CONTESTACAO'].includes(status) && isHS(u)) {
        await notificar(ctx, caso.empresa_id, { perfis: ['ADMIN_EMPRESA', 'FINANCEIRO_EMPRESA'], tipo: 'CASO_' + status, titulo: `Caso ${status.toLowerCase().replace('_', ' ')}`, mensagem: motivo, link: `/casos/${caso.id}` });
      }
      return r;
    },
  },

  registrarInteracao: {
    perm: 'interacao.registrar',
    async run(ctx, input) {
      const caso = await carregarCaso(ctx, input.caso_id);
      exigir(casoAtivo(caso) && caso.status_operacional !== 'SUSPENSO', 'Caso encerrado ou suspenso');
      if (!isHS(ctx.user)) exigir(caso.modalidade_cobranca === 'AUTOCONTRATADA', 'Casos HS são conduzidos pela equipe HS');
      exigir(TIPOS_INTERACAO.includes(input.tipo_interacao), 'Tipo de interação inválido');
      exigir(CANAIS.includes(input.canal), 'Canal inválido');
      if (input.resultado) exigir(RESULTADOS.includes(input.resultado), 'Resultado inválido');
      const devedor = await getById(ctx, 'Devedor', caso.devedor_id);
      const saida = SAIDA.has(input.tipo_interacao);
      if (saida) {
        exigir(!devedor.nao_contatar, 'Devedor solicitou interrupção de contato. Contato bloqueado.');
        if (caso.modalidade_cobranca === 'HS_GERENCIADA') {
          const aut = await getById(ctx, 'AutorizacaoCobranca', caso.autorizacao_id);
          exigir(aut?.status === 'ATIVA', 'Autorização inativa');
          exigir((aut.canais_autorizados || []).includes(input.canal), `Canal ${input.canal} não autorizado pelo credor`);
          exigir(input.fora_horario_justificado === true || dentroDoHorario(aut.horario_contato, ctx.now()), 'Fora do horário de contato autorizado');
        }
        const hoje = ctx.now().toISOString().slice(0, 10);
        const doDia = (await find(ctx, 'Interacao', { caso_id: caso.id })).filter((i) => SAIDA.has(i.tipo_interacao) && i.data_hora.slice(0, 10) === hoje);
        exigir(doDia.length < LIMITE_CONTATOS_DIA, `Limite de ${LIMITE_CONTATOS_DIA} tentativas de contato por dia atingido`);
        if (input.mensagem) verificarMensagem(input.mensagem);
      }
      const agora = ctx.now().toISOString();
      const inter = await criar(ctx, 'Interacao', {
        empresa_id: caso.empresa_id, caso_id: caso.id, operador_id: ctx.user.id, canal: input.canal, data_hora: input.data_hora || agora,
        tipo_interacao: input.tipo_interacao, mensagem: input.mensagem || '', resposta: input.resposta || '', resultado: input.resultado || null,
        proxima_acao: input.proxima_acao || '', observacoes: input.observacoes || '', envio_automatico: false,
      });
      // efeitos no caso
      const patch = { ultima_interacao: agora };
      if (!caso.data_inicio) patch.data_inicio = agora;
      const st = caso.status_operacional;
      let novo = null;
      if (input.resultado === 'CONTESTOU') novo = 'CONTESTACAO';
      else if ((input.resultado === 'RESPONDEU' || input.tipo_interacao === 'RESPOSTA_DEVEDOR' || input.resultado === 'PROMESSA_PAGAMENTO') && ['ATRIBUIDO', 'PRIMEIRO_CONTATO_PENDENTE', 'EM_CONTATO'].includes(st)) novo = 'DEVEDOR_RESPONDEU';
      else if (saida && ['ATRIBUIDO', 'PRIMEIRO_CONTATO_PENDENTE'].includes(st)) novo = 'EM_CONTATO';
      if (novo) Object.assign(patch, transicao(caso, novo, { motivo: input.resultado === 'CONTESTOU' ? input.resposta || 'Devedor contestou a dívida' : null }));
      if (input.proxima_acao_data) {
        patch.proxima_atividade = input.proxima_acao_data;
        await ctx.db.Tarefa.create({ empresa_id: caso.empresa_id, caso_id: caso.id, responsavel_id: ctx.user.id, tipo: 'RETORNO', descricao: input.proxima_acao || 'Retorno agendado', data_prazo: input.proxima_acao_data, prioridade: 'NORMAL', status: 'PENDENTE' });
      }
      await alterar(ctx, 'CasoCobranca', caso, patch, 'ATUALIZAR_CASO_INTERACAO');
      if (input.resultado === 'SOLICITOU_INTERRUPCAO') {
        await alterar(ctx, 'Devedor', devedor, { nao_contatar: true, motivo_nao_contatar: 'Solicitado pelo devedor em ' + agora.slice(0, 10) }, 'PREFERENCIA_CONTATO');
        await notificar(ctx, caso.empresa_id, { perfis: ['ADMIN_EMPRESA'], tipo: 'INTERRUPCAO_CONTATO', titulo: 'Devedor pediu interrupção de contato', mensagem: devedor.nome, link: `/casos/${caso.id}` });
      }
      if (input.resultado === 'CONTESTOU') {
        await notificar(ctx, caso.empresa_id, { perfis: ['ADMIN_EMPRESA', 'FINANCEIRO_EMPRESA'], tipo: 'CONTESTACAO', titulo: 'Dívida contestada pelo devedor', mensagem: input.resposta || '', link: `/casos/${caso.id}` });
      }
      return inter;
    },
  },

  /** Prepara link wa.me (envio MANUAL pelo operador). Não registra envio: o operador confirma depois. */
  prepararWhatsApp: {
    perm: 'interacao.registrar',
    async run(ctx, input) {
      const caso = await carregarCaso(ctx, input.caso_id);
      exigir(casoAtivo(caso) && caso.status_operacional !== 'SUSPENSO', 'Caso encerrado ou suspenso');
      const devedor = await getById(ctx, 'Devedor', caso.devedor_id);
      exigir(!devedor.nao_contatar, 'Devedor solicitou interrupção de contato');
      if (caso.modalidade_cobranca === 'HS_GERENCIADA') {
        const aut = await getById(ctx, 'AutorizacaoCobranca', caso.autorizacao_id);
        exigir((aut?.canais_autorizados || []).includes('WHATSAPP'), 'WhatsApp não autorizado pelo credor');
      }
      const fone = telefoneBR(devedor.whatsapp) || telefoneBR(devedor.telefone);
      exigir(fone, 'Devedor sem WhatsApp/telefone válido');
      let texto = input.mensagem || '';
      if (input.modelo_id) {
        const modelo = await getById(ctx, 'ModeloMensagem', input.modelo_id);
        exigir(modelo && modelo.status === 'ATIVO' && (!modelo.empresa_id || modelo.empresa_id === caso.empresa_id), 'Modelo indisponível');
        const div = await getById(ctx, 'Divida', caso.divida_id);
        const emp = await getById(ctx, 'Empresa', caso.empresa_id);
        texto = preencherModelo(modelo.conteudo, { nome: devedor.nome.split(' ')[0], credor: emp.nome_fantasia || emp.razao_social, valor: formatBRL(div.saldo_atual_centavos), vencimento: div.data_vencimento.split('-').reverse().join('/') });
      }
      exigir(texto.trim(), 'Mensagem vazia');
      verificarMensagem(texto);
      return { modo: 'MANUAL', link: `https://wa.me/${fone}?text=${encodeURIComponent(texto)}`, mensagem: texto, aviso: 'O envio é feito por você no WhatsApp. Depois, registre a tentativa no histórico.' };
    },
  },

  listarInteracoes: {
    perm: null,
    async run(ctx, input = {}) {
      if (input.caso_id) {
        const caso = await carregarCaso(ctx, input.caso_id);
        return paginar(await find(ctx, 'Interacao', { caso_id: caso.id }), { ...input, ordenarPor: 'data_hora' });
      }
      const casos = await actions.listarCasos.run(ctx, { pageSize: 200, filtros: input.filtros });
      const ids = new Set(casos.itens.map((c) => c.id));
      let rows = isHS(ctx.user) ? (ctx.user.perfil === 'OPERADOR_HS' ? await find(ctx, 'Interacao', { operador_id: ctx.user.id }) : await find(ctx, 'Interacao')) : await find(ctx, 'Interacao', { empresa_id: ctx.user.empresa_id });
      if (ctx.user.perfil === 'OPERADOR_HS') rows = rows.filter((i) => ids.has(i.caso_id));
      if (isHS(ctx.user) && ctx.user.perfil !== 'OPERADOR_HS') {
        const hsCasos = new Set((await find(ctx, 'CasoCobranca', { modalidade_cobranca: 'HS_GERENCIADA' })).map((c) => c.id));
        rows = rows.filter((i) => hsCasos.has(i.caso_id));
      }
      return comNomes(ctx, paginar(rows, { ...input, ordenarPor: 'data_hora' }));
    },
  },

  salvarTarefa: {
    perm: 'tarefa.gerenciar',
    async run(ctx, input) {
      const caso = await carregarCaso(ctx, input.caso_id);
      exigir(input.descricao?.trim(), 'Descrição obrigatória');
      exigir(/^\d{4}-\d{2}-\d{2}/.test(input.data_prazo || ''), 'Prazo inválido');
      let responsavel_id = ctx.user.id;
      if (input.responsavel_id && input.responsavel_id !== ctx.user.id) {
        const r = await getById(ctx, 'UsuarioPlataforma', input.responsavel_id);
        exigir(r && r.status === 'ATIVO', 'Responsável inválido');
        const ok = isHS(ctx.user) ? (r.perfil === 'OPERADOR_HS' || r.perfil === 'GESTOR_OPERACOES_HS') && can(ctx.user, 'caso.distribuir') : r.empresa_id === caso.empresa_id;
        exigir(ok, 'Responsável fora do seu escopo');
        responsavel_id = r.id;
      }
      if (input.id) {
        const t = await getById(ctx, 'Tarefa', input.id);
        if (!t || t.caso_id !== caso.id) throw new AccessError('Tarefa não encontrada', 404);
        return alterar(ctx, 'Tarefa', t, { descricao: input.descricao, data_prazo: input.data_prazo, prioridade: input.prioridade || t.prioridade, responsavel_id });
      }
      const t = await criar(ctx, 'Tarefa', { empresa_id: caso.empresa_id, caso_id: caso.id, responsavel_id, tipo: input.tipo || 'ACOMPANHAMENTO', descricao: input.descricao, data_prazo: input.data_prazo, prioridade: input.prioridade || 'NORMAL', status: 'PENDENTE' });
      await ctx.db.CasoCobranca.update(caso.id, { proxima_atividade: input.data_prazo });
      return t;
    },
  },

  concluirTarefa: {
    perm: 'tarefa.gerenciar',
    async run(ctx, { tarefa_id, status = 'CONCLUIDA', observacao }) {
      const t = await getById(ctx, 'Tarefa', tarefa_id);
      if (!t) throw new AccessError('Tarefa não encontrada', 404);
      await carregarCaso(ctx, t.caso_id);
      exigir(['CONCLUIDA', 'CANCELADA'].includes(status), 'Status inválido');
      return alterar(ctx, 'Tarefa', t, { status, observacao_conclusao: observacao || '', data_conclusao: ctx.now().toISOString() });
    },
  },

  listarTarefas: {
    perm: 'tarefa.gerenciar',
    async run(ctx, input = {}) {
      let rows;
      if (input.caso_id) rows = await find(ctx, 'Tarefa', { caso_id: (await carregarCaso(ctx, input.caso_id)).id });
      else if (!isHS(ctx.user)) rows = await find(ctx, 'Tarefa', { empresa_id: ctx.user.empresa_id });
      else if (ctx.user.perfil === 'OPERADOR_HS') rows = await find(ctx, 'Tarefa', { responsavel_id: ctx.user.id });
      else rows = (await find(ctx, 'Tarefa')).filter((t) => t.responsavel_id === ctx.user.id || input.todas);
      if (isHS(ctx.user) && !input.caso_id) {
        const ok = [];
        for (const t of rows) { const c = await getById(ctx, 'CasoCobranca', t.caso_id); if (podeAcessarCasoHS(ctx.user, c)) ok.push(t); }
        rows = ok;
      }
      if (input.status) rows = rows.filter((t) => t.status === input.status);
      return comNomes(ctx, paginar(rows, { ...input, ordenarPor: 'data_prazo', ordem: 'asc' }));
    },
  },

  listarOperadores: {
    perm: 'caso.distribuir',
    async run(ctx) {
      const ops = await find(ctx, 'UsuarioPlataforma', { perfil: 'OPERADOR_HS' });
      const out = [];
      const mes = ctx.now().toISOString().slice(0, 7);
      for (const o of ops) {
        const ints = (await find(ctx, 'Interacao', { operador_id: o.id })).filter((i) => i.data_hora.startsWith(mes));
        out.push({ id: o.id, nome: o.nome, email: o.email, status: o.status, capacidade_casos: o.capacidade_casos, carga_atual: await cargaOperador(ctx, o.id), interacoes_mes: ints.length });
      }
      return out;
    },
  },
};

export { TERMINAIS };
