import { garantirModelosPadrao } from '../../../src/app/actions/mensagens.js';
// Dados de demonstração: mesma base do "npm run demo", criada pelas regras reais do sistema.
export const SENHA_DEMO = 'Demo2026hs';
export const USUARIOS_DEMO = [
  ['empresa@demo.hs', 'Empresa: administrador', 'Cadastra dívidas, acompanha cobranças, aprova propostas e confirma pagamentos'],
  ['financeiro@demo.hs', 'Empresa: financeiro', 'Aprova propostas e confere pagamentos'],
  ['admin@demo.hs', 'Acorly: superadmin', 'Empresas, contratos, planos, equipe e auditoria'],
  ['gestor@demo.hs', 'Acorly: gestor de operações', 'Valida carteiras e distribui casos'],
  ['operador@demo.hs', 'Acorly: operadora', 'Fila de casos, contatos, negociação e acordos'],
];

export async function semear(db, como) {
  const agora = new Date();
  const dia = (n) => new Date(agora.getTime() + n * 864e5).toISOString().slice(0, 10);
  await db.UsuarioPlataforma.create({ nome: 'Ana Superadmin', email: 'admin@demo.hs', perfil: 'SUPERADMIN_HS', empresa_id: null, status: 'ATIVO', data_criacao: agora.toISOString() });
  await como('admin@demo.hs', 'seedPlanos');
  await como('admin@demo.hs', 'convidarUsuario', { nome: 'Gustavo Gestor', email: 'gestor@demo.hs', perfil: 'GESTOR_OPERACOES_HS' });
  const op = await como('admin@demo.hs', 'convidarUsuario', { nome: 'Olivia Operadora', email: 'operador@demo.hs', perfil: 'OPERADOR_HS', capacidade_casos: 30, alcada_desconto_bps: 1500 });
  await garantirModelosPadrao(db);

  const { empresa } = await como('empresa@demo.hs', 'registrarEmpresa', {
    razao_social: 'Loja Exemplo Comércio Ltda', nome_fantasia: 'Loja Exemplo', cnpj: '11222333000181', email: 'contato@lojaexemplo.com.br',
    telefone: '1133334444', endereco: 'Rua das Flores, 100 - São Paulo/SP', responsavel_legal: 'Carla Lojista', admin_nome: 'Carla Lojista', aceite_termos: true, aceite_privacidade: true,
  }, 'Carla Lojista');
  await como('empresa@demo.hs', 'escolherServico', { modalidade_servico: 'AMBOS', tipo_carteira: 'CARTEIRA_SELECIONADA' });
  await como('admin@demo.hs', 'alterarStatusEmpresa', { empresa_id: empresa.id, status: 'ATIVA', motivo: 'Documentação conferida (demonstração)' });
  await como('empresa@demo.hs', 'convidarUsuario', { nome: 'Fábio Financeiro', email: 'financeiro@demo.hs', perfil: 'FINANCEIRO_EMPRESA' });
  const planos = await como('admin@demo.hs', 'listarPlanos');
  await como('admin@demo.hs', 'salvarAssinatura', { empresa_id: empresa.id, plano_id: planos[1].id, data_inicio: dia(-30), data_vencimento: dia(30) });
  const contrato = (await como('admin@demo.hs', 'listarContratos', { filtros: { empresa_id: empresa.id } })).itens[0];
  await como('admin@demo.hs', 'salvarContrato', { id: contrato.id, empresa_id: empresa.id, modalidade: 'CARTEIRA_ESPECIFICA', valor_contratado_centavos: 49000, data_inicio: dia(-30), data_fim: dia(335), escopo: 'Cobrança extrajudicial administrativa das carteiras encaminhadas.' });
  await como('empresa@demo.hs', 'aceitarContrato', { contrato_id: contrato.id, aceite: true });

  const pessoas = [
    ['João Pereira', '52998224725', 150000, -95], ['Maria Souza', '39053344705', 89090, -130], ['Pedro Santos', '11144477735', 230000, -60],
    ['Lúcia Almeida', '12345678909', 45000, -40], ['Rafael Costa', '98765432100', 120050, -200], ['Beatriz Lima', '15350946056', 67500, -15],
  ];
  const dividas = [];
  for (const [i, [nome, cpf, valor, venc]] of pessoas.entries()) {
    const d = await como('empresa@demo.hs', 'salvarDevedor', { nome, tipo_pessoa: 'PF', cpf_cnpj: cpf, whatsapp: `119${String(88880000 + i * 1111).padStart(8, '0')}`, email: `${nome.split(' ')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}@exemplo.com` });
    const dv = await como('empresa@demo.hs', 'salvarDivida', { devedor_id: d.id, descricao: 'Compra a prazo', origem: 'Venda', documento_referencia: `NF-${2040 + i}`, valor_original_centavos: valor, data_vencimento: dia(venc) });
    await como('empresa@demo.hs', 'anexarDocumento', { divida_id: dv.id, file_uri: `demo-nf-${i}`, nome_arquivo: `nota-fiscal-${2040 + i}.pdf`, tipo_documento: 'NOTA_FISCAL' });
    dividas.push(dv);
  }

  await como('empresa@demo.hs', 'encaminharParaHS', { tipo_selecao: 'DIVIDAS', divida_ids: dividas.slice(0, 4).map((d) => d.id), contrato_servico_id: contrato.id, autorizacao: { limite_desconto_bps: 2000, limite_parcelamento: 6, entrada_minima_bps: 1000, canais_autorizados: ['WHATSAPP', 'TELEFONE', 'EMAIL'] }, confirmacao: true });
  const val = await como('gestor@demo.hs', 'listarCasos', { escopo: 'validacao' });
  const porNome = Object.fromEntries(val.itens.map((c) => [c.devedor_nome, c]));
  await como('gestor@demo.hs', 'validarCaso', { caso_ids: ['João Pereira', 'Maria Souza', 'Pedro Santos'].map((n) => porNome[n].id), aprovado: true });
  for (const n of ['João Pereira', 'Maria Souza', 'Pedro Santos']) await como('gestor@demo.hs', 'atribuirCaso', { caso_id: porNome[n].id, operador_id: op.id });

  const joao = porNome['João Pereira'].id;
  await como('operador@demo.hs', 'registrarInteracao', { caso_id: joao, canal: 'WHATSAPP', tipo_interacao: 'MENSAGEM_ENVIADA', mensagem: 'Olá, João! Podemos conversar sobre uma condição para regularizar o valor em aberto?', resultado: 'RESPONDEU', resposta: 'Quero pagar com desconto em 3 vezes', fora_horario_justificado: true });
  const neg = await como('operador@demo.hs', 'proporNegociacao', { caso_id: joao, desconto_bps: 1000, entrada_centavos: 15000, quantidade_parcelas: 3, primeira_data_vencimento: dia(30), data_entrada: dia(0) });
  await como('operador@demo.hs', 'formalizarAcordo', { negociacao_id: neg.id, aceite_devedor: true, meio_aceite: 'WHATSAPP' });
  const parcelasJoao = (await como('empresa@demo.hs', 'listarParcelas', { filtros: { divida_id: dividas[0].id } })).itens;
  const entrada = parcelasJoao.find((p) => p.numero === 0);
  const pj = await como('operador@demo.hs', 'informarPagamento', { caso_id: joao, parcela_id: entrada.id, valor_centavos: entrada.valor_original_centavos, data_informada: dia(0), identificador_transacao: 'PIX-DEMO-001' });
  await como('financeiro@demo.hs', 'confirmarPagamento', { pagamento_id: pj.id, evidencia: 'Extrato bancário (demonstração)' });

  const maria = porNome['Maria Souza'].id;
  await como('operador@demo.hs', 'registrarInteracao', { caso_id: maria, canal: 'TELEFONE', tipo_interacao: 'LIGACAO', resultado: 'RESPONDEU', resposta: 'Consigo pagar se tiver um desconto maior', fora_horario_justificado: true });
  await como('operador@demo.hs', 'proporNegociacao', { caso_id: maria, desconto_bps: 2500, entrada_centavos: 10000, quantidade_parcelas: 4, primeira_data_vencimento: dia(30), justificativa: 'Devedora desempregada, pede desconto maior' });
  await como('operador@demo.hs', 'salvarTarefa', { caso_id: maria, descricao: 'Retornar ligação após decisão do credor', data_prazo: dia(0), prioridade: 'ALTA' });

  const proprio = await como('empresa@demo.hs', 'abrirCobrancaPropria', { divida_id: dividas[4].id });
  await como('empresa@demo.hs', 'registrarInteracao', { caso_id: proprio.id, canal: 'EMAIL', tipo_interacao: 'MENSAGEM_ENVIADA', mensagem: 'Lembrete de pagamento em aberto.', fora_horario_justificado: true });
  await como('empresa@demo.hs', 'informarPagamento', { divida_id: dividas[4].id, valor_centavos: 40000, data_informada: dia(-1), forma_pagamento: 'PIX' });
}
