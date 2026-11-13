import { documentoValido, somenteDigitos, emailValido } from '../../core/documento.js';
import { assertCentavos, soma } from '../../core/money.js';
import { parseDataISO, diasAtraso } from '../../core/dates.js';
import { parseCSV, normalizarLinhasImportacao } from '../../core/csvImport.js';
import { casoAtivo } from '../../core/caseStatus.js';
import { podeAcessarCasoHS } from '../../core/permissions.js';
import {
  AccessError, ValidationError, requirePerm, getById, find, criar, alterar, auditar,
  empresaAlvo, exigirEmpresaOperante, carregarDaEmpresa, paginar, filtrosPermitidos, exigir, comNomes,
} from '../context.js';
import { verificarLimiteDevedores } from './empresa.js';

const CAMPOS_DEVEDOR = ['nome', 'tipo_pessoa', 'cpf_cnpj', 'telefone', 'whatsapp', 'email', 'endereco', 'observacoes', 'canal_preferido', 'base_legal'];

function validarDevedor(d) {
  exigir(d.nome?.trim(), 'Nome obrigatório');
  exigir(['PF', 'PJ'].includes(d.tipo_pessoa), 'Tipo de pessoa deve ser PF ou PJ');
  exigir(documentoValido(d.cpf_cnpj, d.tipo_pessoa), d.tipo_pessoa === 'PF' ? 'CPF inválido' : 'CNPJ inválido');
  if (d.email) exigir(emailValido(d.email), 'E-mail inválido');
}

function validarDivida(d) {
  assertCentavos(d.valor_original_centavos, 'valor_original');
  assertCentavos(d.encargos_centavos ?? 0, 'encargos', { allowZero: true });
  parseDataISO(d.data_vencimento, 'data_vencimento');
}

export async function criarDevedorInterno(ctx, empresa_id, dados) {
  const d = { ...dados, cpf_cnpj: somenteDigitos(dados.cpf_cnpj) };
  validarDevedor(d);
  const dup = await find(ctx, 'Devedor', { empresa_id, cpf_cnpj: d.cpf_cnpj });
  if (dup.length) return { devedor: dup[0], existente: true };
  await verificarLimiteDevedores(ctx, empresa_id);
  const rec = await criar(ctx, 'Devedor', {
    ...Object.fromEntries(CAMPOS_DEVEDOR.map((k) => [k, d[k] ?? ''])), base_legal: d.base_legal || 'EXERCICIO_REGULAR_DIREITO_CREDITO',
    empresa_id, status: 'ATIVO', nao_contatar: false,
  });
  return { devedor: rec, existente: false };
}

export async function criarDividaInterna(ctx, empresa_id, devedor_id, d) {
  validarDivida(d);
  const saldo = d.valor_original_centavos + (d.encargos_centavos || 0);
  const rec = await criar(ctx, 'Divida', {
    empresa_id, devedor_id, origem: d.origem || '', descricao: d.descricao || '', documento_referencia: d.documento_referencia || '',
    valor_original_centavos: d.valor_original_centavos, encargos_centavos: d.encargos_centavos || 0, saldo_atual_centavos: saldo,
    data_vencimento: d.data_vencimento, modalidade_cobranca: 'AUTOCONTRATADA', status_financeiro: 'EM_ABERTO',
    status_validacao: 'NAO_VALIDADA', data_cadastro: ctx.now().toISOString(),
  });
  await ctx.db.LancamentoFinanceiro.create({
    empresa_id, divida_id: rec.id, tipo: 'SALDO_INICIAL', valor_centavos: saldo, saldo_anterior_centavos: 0,
    saldo_posterior_centavos: saldo, usuario_id: ctx.user.id, data_hora: ctx.now().toISOString(), referencia_id: null,
  });
  return rec;
}

export const actions = {
  salvarDevedor: {
    perm: 'devedor.editar',
    async run(ctx, input) {
      const empresa_id = await empresaAlvo(ctx, input);
      await exigirEmpresaOperante(ctx, empresa_id);
      if (!input.id) {
        const r = await criarDevedorInterno(ctx, empresa_id, input);
        if (r.existente) throw new ValidationError('Já existe devedor com este CPF/CNPJ nesta empresa');
        return r.devedor;
      }
      const dev = await carregarDaEmpresa(ctx, 'Devedor', input.id, input);
      exigir(dev.status !== 'ANONIMIZADO', 'Devedor anonimizado não pode ser editado');
      const patch = Object.fromEntries(CAMPOS_DEVEDOR.filter((k) => input[k] !== undefined).map((k) => [k, input[k]]));
      if (patch.cpf_cnpj) patch.cpf_cnpj = somenteDigitos(patch.cpf_cnpj);
      validarDevedor({ ...dev, ...patch });
      return alterar(ctx, 'Devedor', dev, patch);
    },
  },

  listarDevedores: {
    perm: 'devedor.ler',
    async run(ctx, input = {}) {
      const empresa_id = await empresaAlvo(ctx, input);
      const rows = await find(ctx, 'Devedor', { empresa_id, ...filtrosPermitidos(input.filtros, ['status', 'tipo_pessoa']) });
      return paginar(rows, { ...input, camposBusca: ['nome', 'cpf_cnpj', 'email', 'telefone'] });
    },
  },

  detalheDevedor: {
    perm: 'devedor.ler',
    async run(ctx, input) {
      const devedor = await carregarDaEmpresa(ctx, 'Devedor', input.devedor_id, input);
      const dividas = await find(ctx, 'Divida', { empresa_id: devedor.empresa_id, devedor_id: devedor.id });
      const casos = (await find(ctx, 'CasoCobranca', { empresa_id: devedor.empresa_id })).filter((c) => dividas.some((d) => d.id === c.divida_id));
      return {
        devedor,
        dividas: dividas.map((d) => ({ ...d, dias_atraso: diasAtraso(d.data_vencimento, ctx.now().toISOString().slice(0, 10)) })),
        casos,
        totais: { saldo_centavos: soma(dividas.map((d) => d.saldo_atual_centavos)), original_centavos: soma(dividas.map((d) => d.valor_original_centavos)) },
      };
    },
  },

  /** Pedido de interrupção de contato (direito do titular / boa prática de cobrança). */
  registrarNaoContatar: {
    perm: 'devedor.editar',
    async run(ctx, input) {
      const dev = await carregarDaEmpresa(ctx, 'Devedor', input.devedor_id, input);
      exigir(input.motivo, 'Motivo obrigatório');
      return alterar(ctx, 'Devedor', dev, { nao_contatar: input.nao_contatar !== false, motivo_nao_contatar: input.motivo }, 'PREFERENCIA_CONTATO');
    },
  },

  salvarDivida: {
    perm: 'divida.editar',
    async run(ctx, input) {
      const empresa_id = await empresaAlvo(ctx, input);
      await exigirEmpresaOperante(ctx, empresa_id);
      if (!input.id) {
        const dev = await carregarDaEmpresa(ctx, 'Devedor', input.devedor_id, input);
        return criarDividaInterna(ctx, empresa_id, dev.id, input);
      }
      const div = await carregarDaEmpresa(ctx, 'Divida', input.id, input);
      const patch = {};
      for (const k of ['origem', 'descricao', 'documento_referencia']) if (input[k] !== undefined) patch[k] = input[k];
      if (input.data_vencimento !== undefined) patch.data_vencimento = parseDataISO(input.data_vencimento, 'data_vencimento');
      if (input.valor_original_centavos !== undefined && input.valor_original_centavos !== div.valor_original_centavos) {
        // Correção do valor original: somente admin da empresa, sem pagamentos e fora da cobrança Acorly
        requirePerm(ctx.user, 'divida.editar');
        exigir(input.motivo_correcao, 'Informe o motivo da correção do valor original');
        const pags = await find(ctx, 'Pagamento', { divida_id: div.id });
        exigir(pags.every((p) => p.status_confirmacao === 'REJEITADO'), 'Valor original não pode ser alterado após pagamentos');
        exigir(div.modalidade_cobranca !== 'HS_GERENCIADA', 'Retire a dívida da cobrança Acorly antes de corrigir o valor');
        assertCentavos(input.valor_original_centavos, 'valor_original');
        patch.valor_original_centavos = input.valor_original_centavos;
        patch.saldo_atual_centavos = input.valor_original_centavos + (div.encargos_centavos || 0);
        await ctx.db.LancamentoFinanceiro.create({
          empresa_id, divida_id: div.id, tipo: 'CORRECAO_VALOR_ORIGINAL', valor_centavos: patch.saldo_atual_centavos - div.saldo_atual_centavos,
          saldo_anterior_centavos: div.saldo_atual_centavos, saldo_posterior_centavos: patch.saldo_atual_centavos,
          usuario_id: ctx.user.id, data_hora: ctx.now().toISOString(), observacao: input.motivo_correcao,
        });
      }
      return alterar(ctx, 'Divida', div, patch);
    },
  },

  cancelarDivida: {
    perm: 'divida.editar',
    async run(ctx, input) {
      const div = await carregarDaEmpresa(ctx, 'Divida', input.divida_id, input);
      exigir(input.motivo, 'Motivo obrigatório');
      const casos = await find(ctx, 'CasoCobranca', { divida_id: div.id });
      exigir(!casos.some(casoAtivo), 'Encerre ou suspenda o caso de cobrança antes de cancelar a dívida');
      return alterar(ctx, 'Divida', div, { status_financeiro: 'CANCELADA', motivo_cancelamento: input.motivo }, 'CANCELAR_DIVIDA');
    },
  },

  listarDividas: {
    perm: 'divida.ler',
    async run(ctx, input = {}) {
      const empresa_id = await empresaAlvo(ctx, input);
      let rows = await find(ctx, 'Divida', { empresa_id, ...filtrosPermitidos(input.filtros, ['status_financeiro', 'modalidade_cobranca', 'devedor_id', 'status_validacao']) });
      const f = input.filtros || {};
      if (f.vencimento_de) rows = rows.filter((d) => d.data_vencimento >= f.vencimento_de);
      if (f.vencimento_ate) rows = rows.filter((d) => d.data_vencimento <= f.vencimento_ate);
      const devs = new Map((await find(ctx, 'Devedor', { empresa_id })).map((d) => [d.id, d]));
      const hoje = ctx.now().toISOString().slice(0, 10);
      rows = rows.map((d) => ({ ...d, devedor_nome: devs.get(d.devedor_id)?.nome, devedor_documento: devs.get(d.devedor_id)?.cpf_cnpj, dias_atraso: diasAtraso(d.data_vencimento, hoje) }));
      return paginar(rows, { ...input, camposBusca: ['devedor_nome', 'devedor_documento', 'documento_referencia', 'descricao'] });
    },
  },

  detalheDivida: {
    perm: 'divida.ler',
    async run(ctx, input) {
      const divida = await carregarDaEmpresa(ctx, 'Divida', input.divida_id, input);
      const q = { empresa_id: divida.empresa_id, divida_id: divida.id };
      const [devedor, parcelas, documentos, pagamentos, lancamentos, casos] = await Promise.all([
        getById(ctx, 'Devedor', divida.devedor_id), find(ctx, 'Parcela', q), find(ctx, 'DocumentoDivida', q),
        find(ctx, 'Pagamento', q), find(ctx, 'LancamentoFinanceiro', q), find(ctx, 'CasoCobranca', q),
      ]);
      return { divida, devedor, parcelas, documentos: documentos.map(({ arquivo, ...m }) => m), pagamentos, lancamentos, casos };
    },
  },

  /** Define as parcelas originais da dívida (soma deve fechar com valor original + encargos). */
  salvarParcelas: {
    perm: 'divida.editar',
    async run(ctx, input) {
      const div = await carregarDaEmpresa(ctx, 'Divida', input.divida_id, input);
      const lista = input.parcelas || [];
      exigir(lista.length > 0 && lista.length <= 360, 'Informe de 1 a 360 parcelas');
      lista.forEach((p) => { assertCentavos(p.valor_centavos, 'valor da parcela'); parseDataISO(p.vencimento, 'vencimento da parcela'); });
      exigir(soma(lista.map((p) => p.valor_centavos)) === div.valor_original_centavos + (div.encargos_centavos || 0), 'Soma das parcelas deve ser igual ao valor original + encargos');
      const existentes = (await find(ctx, 'Parcela', { divida_id: div.id })).filter((p) => !p.acordo_id);
      exigir(existentes.every((p) => p.saldo_centavos === p.valor_original_centavos), 'Já há parcelas com pagamento; não é possível redefinir');
      const pagsAtivos = (await find(ctx, 'Pagamento', { divida_id: div.id })).filter((p) => p.status_confirmacao !== 'REJEITADO');
      exigir(pagsAtivos.length === 0, 'Já há pagamentos registrados; não é possível redefinir');
      for (const p of existentes) await ctx.db.Parcela.update(p.id, { status: 'SUBSTITUIDA' });
      const criadas = [];
      for (const [i, p] of lista.entries()) {
        criadas.push(await ctx.db.Parcela.create({
          empresa_id: div.empresa_id, divida_id: div.id, acordo_id: null, numero: i + 1, valor_original_centavos: p.valor_centavos,
          vencimento: p.vencimento, saldo_centavos: p.valor_centavos, status: 'EM_ABERTO',
        }));
      }
      await auditar(ctx, { acao: 'DEFINIR_PARCELAS', entidade: 'Divida', registro_id: div.id, empresa_id: div.empresa_id, depois: { parcelas: lista } });
      return criadas;
    },
  },

  listarParcelas: {
    perm: 'divida.ler',
    async run(ctx, input = {}) {
      const empresa_id = await empresaAlvo(ctx, input);
      const rows = (await find(ctx, 'Parcela', { empresa_id, ...filtrosPermitidos(input.filtros, ['divida_id', 'acordo_id', 'status']) })).filter((p) => p.status !== 'SUBSTITUIDA');
      return comNomes(ctx, paginar(rows, { ...input, ordenarPor: 'vencimento', ordem: 'asc' }));
    },
  },

  /** Importação CSV. dryRun=true apenas valida e mostra prévia. */
  importarPlanilha: {
    perm: 'divida.editar',
    async run(ctx, input) {
      const empresa_id = await empresaAlvo(ctx, input);
      await exigirEmpresaOperante(ctx, empresa_id);
      exigir(typeof input.csv === 'string' && input.csv.length < 5_000_000, 'Arquivo CSV ausente ou maior que 5 MB');
      const linhas = normalizarLinhasImportacao(parseCSV(input.csv));
      const validas = linhas.filter((l) => l.erros.length === 0);
      const previa = { total: linhas.length, validas: validas.length, com_erro: linhas.length - validas.length, erros: linhas.filter((l) => l.erros.length).map((l) => ({ linha: l.linha, erros: l.erros })) };
      if (input.dryRun !== false) return { ...previa, importado: false };
      let devedoresNovos = 0, dividasCriadas = 0, duplicadas = 0;
      const existentes = await find(ctx, 'Divida', { empresa_id });
      for (const l of validas) {
        const { devedor, existente } = await criarDevedorInterno(ctx, empresa_id, l.devedor);
        if (!existente) devedoresNovos++;
        const dup = existentes.find((d) => d.devedor_id === devedor.id && d.documento_referencia === l.divida.documento_referencia && d.valor_original_centavos === l.divida.valor_original_centavos && d.data_vencimento === l.divida.data_vencimento);
        if (dup) { duplicadas++; continue; }
        const nova = await criarDividaInterna(ctx, empresa_id, devedor.id, l.divida);
        existentes.push(nova);
        dividasCriadas++;
      }
      await auditar(ctx, { acao: 'IMPORTAR_PLANILHA', entidade: 'Divida', empresa_id, depois: { ...previa, devedoresNovos, dividasCriadas, duplicadas } });
      return { ...previa, importado: true, devedores_novos: devedoresNovos, dividas_criadas: dividasCriadas, duplicadas_ignoradas: duplicadas };
    },
  },

  /** Anexa documento já enviado como arquivo PRIVADO (UploadPrivateFile) — guarda só o file_uri. */
  anexarDocumento: {
    perm: 'documento.enviar',
    async run(ctx, input) {
      const div = await carregarDaEmpresa(ctx, 'Divida', input.divida_id, input);
      exigir(typeof input.file_uri === 'string' && input.file_uri.length > 5, 'Arquivo inválido');
      exigir(!/^https?:\/\//i.test(input.file_uri), 'Use upload privado (file_uri), não URL pública');
      if (ctx.files?.reivindicar) exigir(await ctx.files.reivindicar(input.file_uri, ctx.authEmail), 'Arquivo inválido ou já utilizado');
      return criar(ctx, 'DocumentoDivida', {
        empresa_id: div.empresa_id, divida_id: div.id, nome_arquivo: String(input.nome_arquivo || 'documento').slice(0, 200),
        tipo_documento: input.tipo_documento || 'OUTRO', arquivo: input.file_uri, data_upload: ctx.now().toISOString(), usuario_upload: ctx.user.id,
      }, 'ANEXAR_DOCUMENTO');
    },
  },

  /** Gera URL temporária SOMENTE após validar acesso (empresa dona ou Acorly com caso autorizado). */
  urlDocumento: {
    perm: 'documento.ler',
    async run(ctx, input) {
      const doc = await getById(ctx, 'DocumentoDivida', input.documento_id);
      if (!doc) throw new AccessError('Documento não encontrado', 404);
      if (ctx.user.empresa_id) {
        if (doc.empresa_id !== ctx.user.empresa_id) throw new AccessError('Documento não encontrado', 404);
      } else {
        const casos = await find(ctx, 'CasoCobranca', { divida_id: doc.divida_id });
        if (!casos.some((c) => podeAcessarCasoHS(ctx.user, c))) throw new AccessError('Documento não encontrado', 404);
      }
      await auditar(ctx, { acao: 'ACESSO_DOCUMENTO', entidade: 'DocumentoDivida', registro_id: doc.id, empresa_id: doc.empresa_id });
      if (!ctx.files?.signedUrl) throw new ValidationError('Armazenamento de arquivos não configurado');
      return { url: await ctx.files.signedUrl(doc.arquivo, 300), expira_em_segundos: 300 };
    },
  },
};
