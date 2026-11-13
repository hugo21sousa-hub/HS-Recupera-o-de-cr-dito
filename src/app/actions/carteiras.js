import { validarCarteira } from '../../core/portfolio.js';
import { soma, assertCentavos } from '../../core/money.js';
import { casoAtivo } from '../../core/caseStatus.js';
import { faixaPara, calcularComissao } from '../../core/comissao.js';
import { diasAtraso } from '../../core/dates.js';
import { tabelaComissao, contratoAtivoDaEmpresa, comRotulos, comissaoDoCaso } from './comercial.js';
import {
  AccessError, ValidationError, getById, find, criar, alterar, auditar, empresaAlvo, exigirEmpresaOperante,
  carregarDaEmpresa, paginar, filtrosPermitidos, exigir, notificar,
} from '../context.js';

const CANAIS = ['WHATSAPP', 'TELEFONE', 'EMAIL', 'SMS', 'CARTA'];

async function recalcularCarteira(ctx, carteira) {
  const itens = (await find(ctx, 'CarteiraDevedor', { carteira_id: carteira.id })).filter((i) => i.status !== 'REMOVIDO');
  const dividas = await Promise.all(itens.map((i) => getById(ctx, 'Divida', i.divida_id)));
  return ctx.db.Carteira.update(carteira.id, { quantidade_dividas: itens.length, valor_total_centavos: soma(dividas.map((d) => d?.saldo_atual_centavos || 0)) });
}

/** Monta a lista de dívidas alvo conforme o tipo de seleção. */
async function resolverSelecao(ctx, empresa_id, input) {
  const tipo = input.tipo_selecao;
  let dividas = [];
  if (tipo === 'TODOS_ELEGIVEIS') {
    dividas = (await find(ctx, 'Divida', { empresa_id })).filter((d) => d.status_financeiro !== 'QUITADA' && d.status_financeiro !== 'CANCELADA');
  } else if (tipo === 'CARTEIRA') {
    exigir(Array.isArray(input.carteira_ids) && input.carteira_ids.length, 'Selecione ao menos uma carteira');
    for (const cid of input.carteira_ids) {
      const c = await carregarDaEmpresa(ctx, 'Carteira', cid, { empresa_id });
      const itens = (await find(ctx, 'CarteiraDevedor', { carteira_id: c.id })).filter((i) => i.status !== 'REMOVIDO');
      for (const i of itens) dividas.push(await getById(ctx, 'Divida', i.divida_id));
    }
  } else if (tipo === 'DIVIDAS') {
    exigir(Array.isArray(input.divida_ids) && input.divida_ids.length, 'Selecione ao menos uma dívida');
    for (const id of input.divida_ids) dividas.push(await carregarDaEmpresa(ctx, 'Divida', id, { empresa_id }));
  } else throw new ValidationError('tipo_selecao deve ser CARTEIRA, DIVIDAS ou TODOS_ELEGIVEIS');
  const unicos = new Map(dividas.filter(Boolean).filter((d) => d.empresa_id === empresa_id).map((d) => [d.id, d]));
  return [...unicos.values()];
}

async function montarValidacao(ctx, empresa_id, dividas, contrato = null) {
  const casos = await find(ctx, 'CasoCobranca', { empresa_id });
  const itens = [];
  for (const d of dividas) {
    itens.push({
      divida: d,
      devedor: await getById(ctx, 'Devedor', d.devedor_id),
      documentos: await find(ctx, 'DocumentoDivida', { divida_id: d.id }),
      casoAtivo: casos.some((c) => c.divida_id === d.id && casoAtivo(c)),
    });
  }
  const cfg = (await find(ctx, 'ConfiguracaoEmpresa', { empresa_id }))[0];
  const hoje = ctx.now().toISOString().slice(0, 10);
  const v = validarCarteira(itens, { exigirDocumento: cfg?.exigir_documento_hs !== false, hoje });
  // Comissão do Acorly por dívida (faixa de atraso de hoje); estimativa sobre o saldo, cobrada só sobre o que for recebido
  const faixas = await tabelaComissao(ctx, contrato);
  const porId = new Map(dividas.map((d) => [d.id, d]));
  for (const it of v.itens) {
    const d = porId.get(it.divida_id);
    const dias = d?.data_vencimento ? diasAtraso(d.data_vencimento, hoje) : 0;
    const f = faixaPara(dias, faixas);
    Object.assign(it, { dias_atraso: dias, comissao_bps: f.bps, comissao_faixa: f.faixa, comissao_estimada_centavos: calcularComissao(it.saldo_centavos, f.bps) });
  }
  v.resumo.comissao_estimada_elegiveis_centavos = v.itens.filter((i) => i.elegivel).reduce((a, i) => a + i.comissao_estimada_centavos, 0);
  v.tabela_comissao = comRotulos(faixas);
  return v;
}

async function contratoAtivo(ctx, empresa_id, contrato_id) {
  const c = await getById(ctx, 'ContratoServico', contrato_id);
  if (!c || c.empresa_id !== empresa_id) throw new AccessError('Contrato não encontrado', 404);
  const hoje = ctx.now().toISOString().slice(0, 10);
  exigir(c.status === 'ATIVO' && c.aceite === true, 'Contrato de cobrança gerenciada não está ativo/aceito');
  exigir(!c.data_fim || c.data_fim >= hoje, 'Contrato fora da vigência');
  return c;
}

export const actions = {
  salvarCarteira: {
    perm: 'carteira.editar',
    async run(ctx, input) {
      const empresa_id = await empresaAlvo(ctx, input);
      exigir(input.nome?.trim(), 'Nome da carteira obrigatório');
      if (input.id) {
        const c = await carregarDaEmpresa(ctx, 'Carteira', input.id, input);
        exigir(c.status === 'RASCUNHO', 'Somente carteiras em rascunho podem ser editadas');
        return alterar(ctx, 'Carteira', c, { nome: input.nome, descricao: input.descricao || '' });
      }
      return criar(ctx, 'Carteira', {
        empresa_id, nome: input.nome, descricao: input.descricao || '', modalidade: input.modalidade === 'HS_GERENCIADA' ? 'HS_GERENCIADA' : 'AUTOCONTRATADA',
        quantidade_dividas: 0, valor_total_centavos: 0, status: 'RASCUNHO', data_criacao: ctx.now().toISOString(),
      });
    },
  },

  adicionarDividasCarteira: {
    perm: 'carteira.editar',
    async run(ctx, input) {
      const c = await carregarDaEmpresa(ctx, 'Carteira', input.carteira_id, input);
      exigir(c.status === 'RASCUNHO', 'Carteira já encaminhada; crie uma nova');
      const atuais = (await find(ctx, 'CarteiraDevedor', { carteira_id: c.id })).filter((i) => i.status !== 'REMOVIDO');
      let adicionadas = 0;
      for (const id of input.divida_ids || []) {
        const d = await carregarDaEmpresa(ctx, 'Divida', id, { empresa_id: c.empresa_id });
        if (atuais.some((i) => i.divida_id === d.id)) continue;
        await ctx.db.CarteiraDevedor.create({ empresa_id: c.empresa_id, carteira_id: c.id, divida_id: d.id, devedor_id: d.devedor_id, modalidade_cobranca: c.modalidade, autorizacao_id: null, status: 'SELECIONADO' });
        adicionadas++;
      }
      await recalcularCarteira(ctx, c);
      await auditar(ctx, { acao: 'ADICIONAR_DIVIDAS_CARTEIRA', entidade: 'Carteira', registro_id: c.id, empresa_id: c.empresa_id, depois: { divida_ids: input.divida_ids } });
      return { adicionadas };
    },
  },

  removerDividaCarteira: {
    perm: 'carteira.editar',
    async run(ctx, input) {
      const c = await carregarDaEmpresa(ctx, 'Carteira', input.carteira_id, input);
      exigir(c.status === 'RASCUNHO', 'Carteira já encaminhada');
      const item = (await find(ctx, 'CarteiraDevedor', { carteira_id: c.id, divida_id: input.divida_id }))[0];
      if (!item) throw new AccessError('Item não encontrado', 404);
      await alterar(ctx, 'CarteiraDevedor', item, { status: 'REMOVIDO' }, 'REMOVER_DIVIDA_CARTEIRA');
      await recalcularCarteira(ctx, c);
      return { ok: true };
    },
  },

  detalheCarteira: {
    perm: 'carteira.ler',
    async run(ctx, input) {
      const carteira = await carregarDaEmpresa(ctx, 'Carteira', input.carteira_id, input);
      const itens = (await find(ctx, 'CarteiraDevedor', { carteira_id: carteira.id })).filter((i) => i.status !== 'REMOVIDO');
      const out = [];
      for (const i of itens) {
        const d = await getById(ctx, 'Divida', i.divida_id);
        const dev = d ? await getById(ctx, 'Devedor', d.devedor_id) : null;
        out.push({ ...i, devedor_nome: dev?.nome, documento_referencia: d?.documento_referencia, saldo_atual_centavos: d?.saldo_atual_centavos, data_vencimento: d?.data_vencimento, status_financeiro: d?.status_financeiro });
      }
      return { carteira, itens: out };
    },
  },

  listarCarteiras: {
    perm: 'carteira.ler',
    async run(ctx, input = {}) {
      const empresa_id = await empresaAlvo(ctx, input);
      const rows = await find(ctx, 'Carteira', { empresa_id, ...filtrosPermitidos(input.filtros, ['status', 'modalidade']) });
      return paginar(rows, { ...input, camposBusca: ['nome', 'descricao'] });
    },
  },

  /** Carteiras recebidas pelo Acorly — apenas metadados, sem dados pessoais. */
  listarCarteirasRecebidas: {
    perm: 'caso.ler_todos_hs',
    async run(ctx, input = {}) {
      const rows = (await find(ctx, 'Carteira', { modalidade: 'HS_GERENCIADA' })).filter((c) => c.status !== 'RASCUNHO');
      const empresas = new Map();
      for (const c of rows) if (!empresas.has(c.empresa_id)) empresas.set(c.empresa_id, (await getById(ctx, 'Empresa', c.empresa_id))?.razao_social);
      return paginar(rows.map((c) => ({ ...c, credor: empresas.get(c.empresa_id) })), { ...input, camposBusca: ['nome', 'credor'] });
    },
  },

  /** Prévia obrigatória antes do encaminhamento ao Acorly. */
  previewEncaminhamento: {
    perm: 'carteira.encaminhar_hs',
    async run(ctx, input) {
      const empresa_id = await empresaAlvo(ctx, input);
      const dividas = await resolverSelecao(ctx, empresa_id, input);
      const contrato = input.contrato_servico_id ? await getById(ctx, 'ContratoServico', input.contrato_servico_id) : await contratoAtivoDaEmpresa(ctx, empresa_id);
      return montarValidacao(ctx, empresa_id, dividas, contrato && contrato.empresa_id === empresa_id ? contrato : null);
    },
  },

  /** Quanto o Acorly cobraria se esta dívida fosse encaminhada hoje. */
  comissaoDivida: {
    perm: 'divida.ler',
    async run(ctx, input) {
      const div = await carregarDaEmpresa(ctx, 'Divida', input.divida_id, input);
      const contrato = await contratoAtivoDaEmpresa(ctx, div.empresa_id);
      const faixas = await tabelaComissao(ctx, contrato);
      const casoHS = (await find(ctx, 'CasoCobranca', { divida_id: div.id })).find((c) => c.modalidade_cobranca === 'HS_GERENCIADA' && casoAtivo(c));
      if (casoHS) {
        const cm = await comissaoDoCaso(ctx, casoHS, div);
        return { ja_encaminhada: true, comissao_bps: cm.bps, comissao_faixa: cm.faixa, dias_atraso: cm.dias, estimativa_centavos: calcularComissao(div.saldo_atual_centavos, cm.bps), tabela: comRotulos(faixas), tem_contrato: !!contrato };
      }
      const dias = diasAtraso(div.data_vencimento, ctx.now().toISOString().slice(0, 10));
      const f = faixaPara(dias, faixas);
      return { ja_encaminhada: false, comissao_bps: f.bps, comissao_faixa: f.faixa, dias_atraso: dias, estimativa_centavos: calcularComissao(div.saldo_atual_centavos, f.bps), tabela: comRotulos(faixas), tem_contrato: !!contrato };
    },
  },

  /**
   * Encaminha à cobrança gerenciada Acorly. Exige: empresa ATIVA, contrato ativo e aceito,
   * autorização expressa (confirmacao=true) com limites; cria versão da autorização e casos AGUARDANDO_VALIDACAO.
   */
  encaminharParaHS: {
    perm: 'carteira.encaminhar_hs',
    async run(ctx, input) {
      const empresa_id = await empresaAlvo(ctx, input);
      const empresa = await exigirEmpresaOperante(ctx, empresa_id, { exigirAtiva: true });
      const contrato = await contratoAtivo(ctx, empresa_id, input.contrato_servico_id);
      if (input.tipo_selecao === 'TODOS_ELEGIVEIS') exigir(contrato.tipo_carteira === 'TODOS_ELEGIVEIS' || contrato.modalidade === 'CARTEIRA_COMPLETA' || contrato.modalidade === 'PERSONALIZADA', 'O contrato não cobre todos os devedores elegíveis');
      exigir(input.confirmacao === true, 'Confirme expressamente a autorização de cobrança');
      const a = input.autorizacao || {};
      exigir(Number.isSafeInteger(a.limite_desconto_bps) && a.limite_desconto_bps >= 0 && a.limite_desconto_bps <= 10000, 'Limite de desconto inválido');
      exigir(Number.isSafeInteger(a.limite_parcelamento) && a.limite_parcelamento >= 1 && a.limite_parcelamento <= 120, 'Limite de parcelamento inválido');
      exigir(Array.isArray(a.canais_autorizados) && a.canais_autorizados.length && a.canais_autorizados.every((c) => CANAIS.includes(c)), 'Informe canais autorizados válidos');
      if (a.entrada_minima_bps !== undefined) assertCentavos(a.entrada_minima_bps, 'entrada mínima', { allowZero: true });

      const dividas = await resolverSelecao(ctx, empresa_id, input);
      const validacao = await montarValidacao(ctx, empresa_id, dividas, contrato);
      const elegiveis = validacao.itens.filter((i) => i.elegivel);
      exigir(elegiveis.length > 0, 'Nenhuma dívida elegível para encaminhamento');
      if (contrato.quantidade_casos_contratada) {
        const usados = (await find(ctx, 'CasoCobranca', { empresa_id, contrato_servico_id: contrato.id })).length;
        exigir(usados + elegiveis.length <= contrato.quantidade_casos_contratada, `Limite do contrato: ${contrato.quantidade_casos_contratada} casos (já utilizados: ${usados})`);
      }
      const versoes = await find(ctx, 'AutorizacaoCobranca', { empresa_id });
      const agora = ctx.now().toISOString();
      const autorizacao = await criar(ctx, 'AutorizacaoCobranca', {
        empresa_id, contrato_servico_id: contrato.id, carteira_id: input.tipo_selecao === 'CARTEIRA' && input.carteira_ids.length === 1 ? input.carteira_ids[0] : null,
        divida_id: null, tipo_autorizacao: input.tipo_selecao, escopo_autorizado: JSON.stringify(elegiveis.map((e) => e.divida_id)),
        condicoes: a.condicoes || '', limite_desconto_bps: a.limite_desconto_bps, limite_parcelamento: a.limite_parcelamento,
        entrada_minima_bps: a.entrada_minima_bps || 0, exige_aprovacao_sempre: a.exige_aprovacao_sempre === true,
        canais_autorizados: a.canais_autorizados, horario_contato: a.horario_contato || '08:00-20:00',
        data_autorizacao: agora, responsavel: ctx.user.id, responsavel_nome: ctx.user.nome, documento: a.documento || null,
        versao: versoes.length + 1, texto_aceite: input.texto_aceite || 'Autorizo a HS Recuperação de Crédito a realizar cobrança extrajudicial administrativa das dívidas listadas, nos limites acima. O pagamento será feito diretamente à empresa credora. A comissão do Acorly, conforme a faixa de atraso de cada dívida, incide somente sobre os valores efetivamente recebidos e confirmados.',
        status: 'ATIVA',
      }, 'CONCEDER_AUTORIZACAO');

      let carteira_id = autorizacao.carteira_id;
      if (!carteira_id) {
        const c = await ctx.db.Carteira.create({ empresa_id, nome: `Encaminhamento Acorly ${agora.slice(0, 10)} (v${autorizacao.versao})`, descricao: input.tipo_selecao, modalidade: 'HS_GERENCIADA', quantidade_dividas: 0, valor_total_centavos: 0, status: 'RASCUNHO', data_criacao: agora });
        carteira_id = c.id;
      }
      const casos = [];
      for (const e of elegiveis) {
        const div = await getById(ctx, 'Divida', e.divida_id);
        await alterar(ctx, 'Divida', div, { modalidade_cobranca: 'HS_GERENCIADA', status_validacao: 'EM_VALIDACAO' }, 'ALTERAR_MODALIDADE');
        const itemValid = validacao.itens.find((x) => x.divida_id === div.id);
        const item = (await find(ctx, 'CarteiraDevedor', { carteira_id, divida_id: div.id }))[0];
        if (item) await ctx.db.CarteiraDevedor.update(item.id, { autorizacao_id: autorizacao.id, modalidade_cobranca: 'HS_GERENCIADA', status: 'ENCAMINHADO' });
        else await ctx.db.CarteiraDevedor.create({ empresa_id, carteira_id, divida_id: div.id, devedor_id: div.devedor_id, modalidade_cobranca: 'HS_GERENCIADA', autorizacao_id: autorizacao.id, status: 'ENCAMINHADO' });
        casos.push(await criar(ctx, 'CasoCobranca', {
          empresa_id, divida_id: div.id, devedor_id: div.devedor_id, carteira_id, contrato_servico_id: contrato.id, autorizacao_id: autorizacao.id,
          modalidade_cobranca: 'HS_GERENCIADA', operador_id: null, gestor_id: null, status_operacional: 'AGUARDANDO_VALIDACAO',
          prioridade: div.saldo_atual_centavos >= 1_000_000 ? 'ALTA' : 'NORMAL', data_recebimento: agora, data_inicio: null,
          ultima_interacao: null, proxima_atividade: null, data_encerramento: null,
          dias_atraso_no_envio: itemValid.dias_atraso, comissao_bps: itemValid.comissao_bps, comissao_faixa: itemValid.comissao_faixa,
        }));
      }
      const cart = await getById(ctx, 'Carteira', carteira_id);
      await ctx.db.Carteira.update(carteira_id, { status: 'ENCAMINHADA', modalidade: 'HS_GERENCIADA' });
      await recalcularCarteira(ctx, cart);
      await notificar(ctx, null, { perfis: ['GESTOR_OPERACOES_HS', 'SUPERADMIN_HS'], tipo: 'CARTEIRA_RECEBIDA', titulo: 'Nova carteira recebida', mensagem: `${empresa.nome_fantasia || empresa.razao_social}: ${casos.length} casos aguardando validação.` });
      return { autorizacao, casos_criados: casos.length, nao_encaminhadas: validacao.itens.filter((i) => !i.elegivel), resumo: validacao.resumo };
    },
  },

  /** Revoga autorização: suspende os casos ainda ativos vinculados a ela. */
  revogarAutorizacao: {
    perm: 'autorizacao.conceder',
    async run(ctx, input) {
      const aut = await carregarDaEmpresa(ctx, 'AutorizacaoCobranca', input.autorizacao_id, input);
      exigir(aut.status === 'ATIVA', 'Autorização não está ativa');
      exigir(input.motivo, 'Motivo obrigatório');
      await alterar(ctx, 'AutorizacaoCobranca', aut, { status: 'REVOGADA', motivo_revogacao: input.motivo }, 'REVOGAR_AUTORIZACAO');
      const casos = (await find(ctx, 'CasoCobranca', { autorizacao_id: aut.id })).filter((c) => casoAtivo(c) && c.status_operacional !== 'SUSPENSO');
      for (const c of casos) await alterar(ctx, 'CasoCobranca', c, { status_operacional: 'SUSPENSO', status_anterior: c.status_operacional, motivo_status: 'Autorização revogada pelo credor' }, 'SUSPENDER_CASO');
      return { casos_suspensos: casos.length };
    },
  },

  listarAutorizacoes: {
    perm: 'carteira.ler',
    async run(ctx, input = {}) {
      const empresa_id = await empresaAlvo(ctx, input);
      return paginar(await find(ctx, 'AutorizacaoCobranca', { empresa_id }), input);
    },
  },

  /** Abre cobrança própria (AUTOCONTRATADA) gerida pela própria empresa. */
  abrirCobrancaPropria: {
    perm: 'interacao.registrar',
    async run(ctx, input) {
      if (ctx.user.perfil !== 'ADMIN_EMPRESA') throw new AccessError('Somente a empresa abre cobrança própria');
      const empresa_id = await empresaAlvo(ctx, input);
      const div = await carregarDaEmpresa(ctx, 'Divida', input.divida_id, { empresa_id });
      exigir(div.modalidade_cobranca === 'AUTOCONTRATADA', 'Dívida está na cobrança Acorly');
      exigir(div.saldo_atual_centavos > 0 && div.status_financeiro !== 'CANCELADA', 'Dívida sem saldo em aberto');
      const ativos = (await find(ctx, 'CasoCobranca', { divida_id: div.id })).filter(casoAtivo);
      exigir(!ativos.length, 'Já existe caso ativo para esta dívida');
      const agora = ctx.now().toISOString();
      return criar(ctx, 'CasoCobranca', {
        empresa_id, divida_id: div.id, devedor_id: div.devedor_id, carteira_id: input.carteira_id || null, contrato_servico_id: null, autorizacao_id: null,
        modalidade_cobranca: 'AUTOCONTRATADA', operador_id: null, responsavel_empresa_id: ctx.user.id, gestor_id: null,
        status_operacional: 'PRIMEIRO_CONTATO_PENDENTE', prioridade: 'NORMAL', data_recebimento: agora, data_inicio: agora,
        ultima_interacao: null, proxima_atividade: null, data_encerramento: null,
      });
    },
  },

  /** Troca de modalidade de uma dívida, respeitando casos em andamento. */
  alterarModalidade: {
    perm: 'carteira.encaminhar_hs',
    async run(ctx, input) {
      const div = await carregarDaEmpresa(ctx, 'Divida', input.divida_id, input);
      exigir(input.motivo, 'Motivo obrigatório');
      exigir(input.para === 'AUTOCONTRATADA', 'Para encaminhar ao Acorly use o fluxo de encaminhamento com autorização');
      exigir(div.modalidade_cobranca === 'HS_GERENCIADA', 'Dívida já é autocontratada');
      const ativos = (await find(ctx, 'CasoCobranca', { divida_id: div.id })).filter(casoAtivo);
      const bloqueante = ativos.find((c) => ['ACORDO_AGUARDANDO_PAGAMENTO', 'PAGAMENTO_INFORMADO', 'PAGAMENTO_EM_CONFIRMACAO'].includes(c.status_operacional));
      exigir(!bloqueante, 'Há acordo ou pagamento em andamento; conclua-o antes de retirar do Acorly');
      for (const c of ativos) {
        await alterar(ctx, 'CasoCobranca', c, { status_operacional: 'SEM_SUCESSO', motivo_status: `Retirado do Acorly pelo credor: ${input.motivo}`, data_encerramento: ctx.now().toISOString(), encerrado_por_retirada: true }, 'ENCERRAR_CASO_RETIRADA');
      }
      return alterar(ctx, 'Divida', div, { modalidade_cobranca: 'AUTOCONTRATADA', status_validacao: 'NAO_VALIDADA' }, 'ALTERAR_MODALIDADE');
    },
  },
};
