// Definição única das entidades. `npm run build` gera base44/entities/*.json.
// Valores monetários: *_centavos (inteiro). Percentuais: *_bps (1% = 100).
const s = (description, extra = {}) => ({ type: 'string', description, ...extra });
const n = (description, extra = {}) => ({ type: 'integer', description, ...extra });
const c = (description) => ({ type: 'integer', minimum: 0, description: `${description} (centavos)` });
const b = (description, def = false) => ({ type: 'boolean', description, default: def });
const e = (values, description, def) => ({ type: 'string', enum: values, description, ...(def ? { default: def } : {}) });
const dt = (description) => ({ type: 'string', format: 'date', description });
const ts = (description) => ({ type: 'string', format: 'date-time', description });
const arr = (description, items = { type: 'string' }) => ({ type: 'array', items, description });
const ref = (ent) => s(`id de ${ent}`);
const EMP = { empresa_id: ref('Empresa (tenant proprietário)') };

const STATUS_CASO = ['AGUARDANDO_VALIDACAO', 'AGUARDANDO_AUTORIZACAO', 'PRONTO_PARA_COBRANCA', 'AGUARDANDO_OPERADOR', 'ATRIBUIDO', 'PRIMEIRO_CONTATO_PENDENTE', 'EM_CONTATO', 'DEVEDOR_RESPONDEU', 'EM_NEGOCIACAO', 'ACORDO_AGUARDANDO_PAGAMENTO', 'PAGAMENTO_INFORMADO', 'PAGAMENTO_EM_CONFIRMACAO', 'PARCIALMENTE_RECUPERADO', 'RECUPERADO_INTEGRALMENTE', 'SEM_SUCESSO', 'SUSPENSO', 'CONTESTACAO'];
const MODALIDADE = ['AUTOCONTRATADA', 'HS_GERENCIADA'];
const PERFIS = ['SUPERADMIN_HS', 'GESTOR_OPERACOES_HS', 'OPERADOR_HS', 'ADMIN_EMPRESA', 'FINANCEIRO_EMPRESA', 'VISUALIZADOR_EMPRESA'];

export const ENTITIES = {
  Empresa: {
    description: 'Empresa cliente (tenant)',
    properties: {
      razao_social: s('Razão social'), nome_fantasia: s('Nome fantasia'), cnpj: s('CNPJ (somente dígitos)'), email: s('E-mail', { format: 'email' }),
      telefone: s('Telefone'), endereco: s('Endereço completo'), responsavel_legal: s('Responsável legal'),
      contato_nome: s('Contato'), contato_telefone: s('Telefone do contato'), contato_email: s('E-mail do contato'),
      status: e(['CADASTRO_INCOMPLETO', 'AGUARDANDO_VALIDACAO', 'ATIVA', 'SUSPENSA', 'CANCELADA'], 'Status', 'CADASTRO_INCOMPLETO'),
      motivo_status: s('Motivo da última mudança de status'), modalidade_servico: e(['PLATAFORMA', 'HS_GERENCIADA', 'AMBOS'], 'Serviço escolhido no onboarding'),
      data_cadastro: ts('Data de cadastro'), aceite_termos_em: ts('Aceite dos termos'), asaas_cliente_id: s('Cliente no gateway de assinatura'), aceite_privacidade_em: ts('Aceite da política de privacidade'), versao_termos: s('Versão aceita'),
    },
    required: ['razao_social', 'cnpj', 'email', 'status'],
  },
  UsuarioPlataforma: {
    description: 'Vínculo usuário ↔ perfil ↔ empresa. Fonte de verdade de autorização (NÃO usar campos do User, que o próprio usuário pode alterar).',
    properties: {
      nome: s('Nome'), email: s('E-mail de login (minúsculo)', { format: 'email' }), perfil: e(PERFIS, 'Perfil de acesso'), empresa_id: s('Empresa (vazio para equipe HS)'),
      status: e(['ATIVO', 'BLOQUEADO', 'INATIVO'], 'Status', 'ATIVO'), data_criacao: ts('Criação'),
      capacidade_casos: n('Capacidade de casos simultâneos (operador)'), alcada_desconto_bps: n('Alçada individual de desconto do operador (bps)'),
    },
    required: ['email', 'perfil', 'status'],
  },
  Plano: {
    description: 'Plano de assinatura da plataforma',
    properties: { nome: s('Nome'), preco_mensal_centavos: c('Preço mensal'), limite_devedores: n('Limite de devedores'), limite_usuarios: n('Limite de usuários'), funcionalidades: arr('Recursos incluídos'), status: e(['ATIVO', 'INATIVO'], 'Status', 'ATIVO'), ordem: n('Ordem de exibição') },
    required: ['nome', 'preco_mensal_centavos'],
  },
  Assinatura: {
    description: 'Assinatura da plataforma (faturamento separado das dívidas)',
    properties: { ...EMP, plano_id: ref('Plano'), data_inicio: dt('Início'), data_vencimento: dt('Vencimento'), status: e(['AGUARDANDO_PAGAMENTO', 'ATIVA', 'INADIMPLENTE', 'CANCELADA', 'SUBSTITUIDA', 'TRIAL'], 'Status', 'ATIVA'), valor_contratado_centavos: c('Valor contratado'), gateway: s('Gateway (ASAAS ou vazio = manual)'), gateway_assinatura_id: s('ID da assinatura no gateway'), fatura_url: s('Link da fatura em aberto'), ultimo_pagamento_em: ts('Último pagamento confirmado pelo gateway') },
    required: ['empresa_id', 'plano_id', 'status'],
  },
  EventoAssinatura: {
    description: 'Eventos de assinatura (manual hoje; webhooks do gateway no futuro)',
    properties: { ...EMP, assinatura_id: ref('Assinatura'), tipo: s('Tipo do evento'), payload: s('JSON do evento'), origem: e(['MANUAL', 'GATEWAY'], 'Origem', 'MANUAL'), data_hora: ts('Data/hora') },
    required: ['empresa_id', 'tipo'],
  },
  ContratoServico: {
    description: 'Contrato de cobrança gerenciada HS',
    properties: {
      ...EMP, modalidade: e(['PACOTE_CASOS', 'CARTEIRA_ESPECIFICA', 'CARTEIRA_COMPLETA', 'PERSONALIZADA'], 'Modalidade'), tipo_carteira: e(['CARTEIRA_SELECIONADA', 'TODOS_ELEGIVEIS'], 'Escopo'),
      quantidade_casos_contratada: n('Limite de casos (pacote)'), valor_contratado_centavos: c('Preço do serviço'), forma_cobranca_servico: s('Periodicidade/forma de cobrança do serviço'),
      data_inicio: dt('Início da vigência'), data_fim: dt('Fim da vigência'), escopo: s('Escopo contratado'), limites: s('Limites'), documento: s('file_uri do contrato (privado)'),
      status: e(['SOLICITADO', 'PROPOSTO', 'ATIVO', 'ENCERRADO', 'CANCELADO'], 'Status', 'SOLICITADO'), aceite: b('Aceito pela empresa'), data_aceite: ts('Data do aceite'),
      responsavel_autorizacao: ref('UsuarioPlataforma que aceitou'), observacoes: s('Observações'), motivo_encerramento: s('Motivo do encerramento'),
    },
    required: ['empresa_id', 'modalidade', 'status'],
  },
  Devedor: {
    description: 'Devedor (titular de dados pessoais — LGPD)',
    properties: {
      ...EMP, nome: s('Nome / razão social'), tipo_pessoa: e(['PF', 'PJ'], 'Tipo de pessoa'), cpf_cnpj: s('CPF/CNPJ (dígitos)'), telefone: s('Telefone'), whatsapp: s('WhatsApp'),
      email: s('E-mail'), endereco: s('Endereço'), observacoes: s('Observações'), canal_preferido: s('Canal preferido'), base_legal: s('Base legal do tratamento', { default: 'EXERCICIO_REGULAR_DIREITO_CREDITO' }),
      nao_contatar: b('Pediu interrupção de contato'), motivo_nao_contatar: s('Motivo/registro do pedido'),
      status: e(['ATIVO', 'INATIVO', 'ANONIMIZADO'], 'Status', 'ATIVO'), data_anonimizacao: ts('Anonimização'),
    },
    required: ['empresa_id', 'nome', 'tipo_pessoa', 'cpf_cnpj'],
  },
  Divida: {
    description: 'Dívida. valor_original é imutável após pagamentos; saldo só muda via LancamentoFinanceiro.',
    properties: {
      ...EMP, devedor_id: ref('Devedor'), origem: s('Origem'), descricao: s('Descrição'), documento_referencia: s('Nº do documento de referência'),
      valor_original_centavos: c('Valor original'), encargos_centavos: c('Encargos contratuais'), saldo_atual_centavos: c('Saldo atual'), data_vencimento: dt('Vencimento'),
      modalidade_cobranca: e(MODALIDADE, 'Modalidade de cobrança', 'AUTOCONTRATADA'),
      status_financeiro: e(['EM_ABERTO', 'EM_ACORDO', 'PARCIALMENTE_PAGA', 'QUITADA', 'CANCELADA', 'CONTESTADA'], 'Status financeiro', 'EM_ABERTO'),
      status_validacao: e(['NAO_VALIDADA', 'EM_VALIDACAO', 'VALIDADA', 'REPROVADA'], 'Validação HS', 'NAO_VALIDADA'), pendencia_validacao: s('Pendência apontada'),
      motivo_cancelamento: s('Motivo do cancelamento'), data_cadastro: ts('Cadastro'),
    },
    required: ['empresa_id', 'devedor_id', 'valor_original_centavos', 'saldo_atual_centavos', 'data_vencimento'],
  },
  Parcela: {
    description: 'Parcela original da dívida ou de acordo (acordo_id preenchido)',
    properties: { ...EMP, divida_id: ref('Divida'), acordo_id: ref('Acordo (opcional)'), numero: n('Número (0 = entrada)'), valor_original_centavos: c('Valor'), vencimento: dt('Vencimento'), saldo_centavos: c('Saldo'), status: e(['EM_ABERTO', 'PARCIALMENTE_PAGA', 'PAGA', 'CANCELADA', 'SUBSTITUIDA'], 'Status', 'EM_ABERTO') },
    required: ['empresa_id', 'divida_id', 'valor_original_centavos', 'vencimento'],
  },
  DocumentoDivida: {
    description: 'Anexo da dívida. `arquivo` guarda file_uri PRIVADO; acesso só via hsApi.urlDocumento',
    properties: { ...EMP, divida_id: ref('Divida'), nome_arquivo: s('Nome'), tipo_documento: e(['CONTRATO', 'NOTA_FISCAL', 'BOLETO', 'CONFISSAO_DIVIDA', 'COMPROVANTE_ENTREGA', 'OUTRO'], 'Tipo', 'OUTRO'), arquivo: s('file_uri privado'), data_upload: ts('Upload'), usuario_upload: ref('UsuarioPlataforma') },
    required: ['empresa_id', 'divida_id', 'arquivo'],
  },
  LancamentoFinanceiro: {
    description: 'Razão financeiro por dívida (histórico rastreável de saldo)',
    properties: { ...EMP, divida_id: ref('Divida'), tipo: e(['SALDO_INICIAL', 'PAGAMENTO_CONFIRMADO', 'DESCONTO_ACORDO', 'CORRECAO_VALOR_ORIGINAL', 'ESTORNO'], 'Tipo'), valor_centavos: n('Valor com sinal (centavos)'), saldo_anterior_centavos: c('Saldo anterior'), saldo_posterior_centavos: c('Saldo posterior'), referencia_id: s('Pagamento/Acordo de origem'), usuario_id: ref('UsuarioPlataforma'), data_hora: ts('Data/hora'), observacao: s('Observação') },
    required: ['empresa_id', 'divida_id', 'tipo', 'valor_centavos'],
  },
  Carteira: {
    description: 'Agrupamento de dívidas',
    properties: { ...EMP, nome: s('Nome'), descricao: s('Descrição'), modalidade: e(MODALIDADE, 'Modalidade', 'AUTOCONTRATADA'), quantidade_dividas: n('Qtd. dívidas'), valor_total_centavos: c('Valor total'), status: e(['RASCUNHO', 'ENCAMINHADA', 'EM_OPERACAO', 'ENCERRADA'], 'Status', 'RASCUNHO'), data_criacao: ts('Criação') },
    required: ['empresa_id', 'nome'],
  },
  CarteiraDevedor: {
    description: 'Item da carteira (dívida selecionada)',
    properties: { ...EMP, carteira_id: ref('Carteira'), divida_id: ref('Divida'), devedor_id: ref('Devedor'), modalidade_cobranca: e(MODALIDADE, 'Modalidade'), autorizacao_id: ref('AutorizacaoCobranca'), status: e(['SELECIONADO', 'ENCAMINHADO', 'REMOVIDO'], 'Status', 'SELECIONADO') },
    required: ['empresa_id', 'carteira_id', 'divida_id'],
  },
  AutorizacaoCobranca: {
    description: 'Autorização expressa (versionada) do credor para a HS cobrar',
    properties: {
      ...EMP, contrato_servico_id: ref('ContratoServico'), divida_id: ref('Divida (opcional)'), carteira_id: ref('Carteira (opcional)'),
      tipo_autorizacao: e(['CARTEIRA', 'DIVIDAS', 'TODOS_ELEGIVEIS'], 'Tipo'), escopo_autorizado: s('JSON com ids das dívidas autorizadas'), condicoes: s('Condições'),
      limite_desconto_bps: n('Desconto máximo (bps)'), limite_parcelamento: n('Máximo de parcelas'), entrada_minima_bps: n('Entrada mínima (bps)'), exige_aprovacao_sempre: b('Toda proposta exige aprovação do credor'),
      canais_autorizados: arr('Canais autorizados'), horario_contato: s('Janela de contato HH:MM-HH:MM'), data_autorizacao: ts('Data'), responsavel: ref('UsuarioPlataforma que autorizou'),
      responsavel_nome: s('Nome do responsável'), documento: s('file_uri do termo'), versao: n('Versão'), texto_aceite: s('Texto aceito'), status: e(['ATIVA', 'REVOGADA', 'EXPIRADA'], 'Status', 'ATIVA'), motivo_revogacao: s('Motivo da revogação'),
    },
    required: ['empresa_id', 'tipo_autorizacao', 'limite_desconto_bps', 'limite_parcelamento', 'status'],
  },
  CasoCobranca: {
    description: 'Caso de cobrança (status operacional, separado do status financeiro da dívida)',
    properties: {
      ...EMP, divida_id: ref('Divida'), devedor_id: ref('Devedor'), carteira_id: ref('Carteira'), contrato_servico_id: ref('ContratoServico'), autorizacao_id: ref('AutorizacaoCobranca'),
      modalidade_cobranca: e(MODALIDADE, 'Modalidade'), operador_id: ref('UsuarioPlataforma (operador HS)'), responsavel_empresa_id: ref('UsuarioPlataforma (cobrança própria)'), gestor_id: ref('UsuarioPlataforma (gestor)'),
      status_operacional: e(STATUS_CASO, 'Status operacional', 'AGUARDANDO_VALIDACAO'), status_anterior: s('Status antes da suspensão'), motivo_status: s('Motivo da última transição'),
      prioridade: e(['URGENTE', 'ALTA', 'NORMAL', 'BAIXA'], 'Prioridade', 'NORMAL'), data_recebimento: ts('Recebimento'), data_inicio: ts('Início do trabalho'),
      data_validacao: ts('Validação'), validado_por: ref('UsuarioPlataforma'), ultima_interacao: ts('Última interação'), proxima_atividade: s('Próxima atividade (data)'),
      data_encerramento: ts('Encerramento'), encerrado_por_retirada: b('Encerrado porque o credor retirou da HS'),
    },
    required: ['empresa_id', 'divida_id', 'modalidade_cobranca', 'status_operacional'],
  },
  Atribuicao: {
    description: 'Histórico de atribuições de casos',
    properties: { ...EMP, caso_id: ref('CasoCobranca'), operador_id: ref('Operador'), operador_anterior_id: ref('Operador anterior'), atribuido_por: ref('Quem atribuiu'), data_atribuicao: ts('Data'), data_encerramento: ts('Fim'), status: e(['ATIVA', 'ENCERRADA'], 'Status', 'ATIVA') },
    required: ['empresa_id', 'caso_id', 'operador_id'],
  },
  Interacao: {
    description: 'Registro de contato/resposta (nunca indica envio automático sem integração)',
    properties: {
      ...EMP, caso_id: ref('CasoCobranca'), operador_id: ref('Autor'), canal: e(['WHATSAPP', 'TELEFONE', 'EMAIL', 'SMS', 'CARTA', 'PRESENCIAL', 'INTERNO'], 'Canal'), data_hora: ts('Data/hora'),
      tipo_interacao: e(['TENTATIVA_CONTATO', 'MENSAGEM_ENVIADA', 'LIGACAO', 'RESPOSTA_DEVEDOR', 'SEM_RESPOSTA', 'RETORNO_AGENDADO', 'NOTA_INTERNA'], 'Tipo'),
      mensagem: s('Mensagem'), resposta: s('Resposta do devedor'), resultado: e(['SEM_RESPOSTA', 'RESPONDEU', 'NUMERO_INVALIDO', 'PROMESSA_PAGAMENTO', 'RECUSA', 'CONTESTOU', 'SOLICITOU_INTERRUPCAO', 'OUTRO'], 'Resultado'),
      proxima_acao: s('Próxima ação'), observacoes: s('Observações'), envio_automatico: b('Enviado por integração oficial'),
      mensagem_externa_id: s('ID da mensagem no WhatsApp'), telefone_destino: s('Telefone de destino (envio pela API)'), status_entrega: s('sent/delivered/read/failed'), recebida_por_integracao: b('Recebida pelo webhook'),
    },
    required: ['empresa_id', 'caso_id', 'canal', 'tipo_interacao', 'data_hora'],
  },
  Tarefa: {
    description: 'Tarefa de acompanhamento',
    properties: { ...EMP, caso_id: ref('CasoCobranca'), responsavel_id: ref('UsuarioPlataforma'), tipo: s('Tipo'), descricao: s('Descrição'), data_prazo: s('Prazo (data ou data-hora)'), prioridade: e(['URGENTE', 'ALTA', 'NORMAL', 'BAIXA'], 'Prioridade', 'NORMAL'), status: e(['PENDENTE', 'CONCLUIDA', 'CANCELADA'], 'Status', 'PENDENTE'), data_conclusao: ts('Conclusão'), observacao_conclusao: s('Observação') },
    required: ['empresa_id', 'caso_id', 'descricao', 'status'],
  },
  Negociacao: {
    description: 'Proposta de negociação',
    properties: {
      ...EMP, caso_id: ref('CasoCobranca'), divida_id: ref('Divida'), valor_original_centavos: c('Valor original'), saldo_base_centavos: c('Saldo na data da proposta'),
      valor_proposto_centavos: c('Valor proposto'), desconto_bps: n('Desconto (bps)'), desconto_centavos: c('Desconto'), entrada_centavos: c('Entrada'), quantidade_parcelas: n('Parcelas'),
      valor_parcela_centavos: c('Valor da parcela'), primeira_data_vencimento: dt('1º vencimento'), data_entrada: dt('Vencimento da entrada'), plano_parcelas: s('JSON das parcelas'),
      condicoes: s('Condições'), violacoes_alcada: arr('Motivos fora da alçada'),
      status: e(['RASCUNHO', 'APROVADA_ALCADA', 'AGUARDANDO_APROVACAO_CREDOR', 'APROVADA_CREDOR', 'REJEITADA', 'CANCELADA', 'CONVERTIDA_EM_ACORDO'], 'Status'),
      criado_por: ref('Autor'), aprovado_por: ref('Aprovador'), data_proposta: ts('Data'), data_decisao: ts('Decisão'), motivo_cancelamento: s('Motivo'),
    },
    required: ['empresa_id', 'caso_id', 'valor_proposto_centavos', 'status'],
  },
  Acordo: {
    description: 'Acordo formalizado (não é dinheiro recuperado)',
    properties: {
      ...EMP, caso_id: ref('CasoCobranca'), divida_id: ref('Divida'), negociacao_id: ref('Negociacao'), valor_acordado_centavos: c('Valor acordado'), desconto_centavos: c('Desconto'),
      entrada_centavos: c('Entrada'), quantidade_parcelas: n('Parcelas'), status: e(['ATIVO', 'CUMPRIDO', 'ROMPIDO', 'CANCELADO'], 'Status', 'ATIVO'), data_aceite: dt('Aceite do devedor'),
      meio_aceite: s('Meio do aceite'), documento: s('file_uri do termo'), responsavel_aprovacao: ref('Aprovador'), formalizado_por: ref('Quem formalizou'), data_cumprimento: ts('Cumprimento'), motivo_encerramento: s('Motivo'),
    },
    required: ['empresa_id', 'caso_id', 'negociacao_id', 'valor_acordado_centavos', 'status'],
  },
  Aprovacao: {
    description: 'Solicitação/decisão de aprovação do credor',
    properties: { ...EMP, negociacao_id: ref('Negociacao'), solicitante_id: ref('Solicitante'), aprovador_id: ref('Aprovador'), tipo_aprovacao: e(['FORA_ALCADA', 'POLITICA_CREDOR'], 'Tipo'), decisao: e(['PENDENTE', 'APROVADA', 'REJEITADA'], 'Decisão', 'PENDENTE'), justificativa: s('Justificativa'), data_decisao: ts('Data da decisão') },
    required: ['empresa_id', 'negociacao_id', 'decisao'],
  },
  Pagamento: {
    description: 'Pagamento feito DIRETAMENTE ao credor. Só entra em "recuperado" quando CONFIRMADO.',
    properties: {
      ...EMP, divida_id: ref('Divida'), caso_id: ref('CasoCobranca'), parcela_id: ref('Parcela'), acordo_id: ref('Acordo'), valor_centavos: c('Valor informado'),
      data_informada: dt('Data do pagamento informada'), forma_pagamento: e(['PIX', 'BOLETO', 'TRANSFERENCIA', 'CARTAO', 'DINHEIRO', 'OUTRO'], 'Forma', 'PIX'),
      identificador_transacao: s('ID da transação (evita duplicidade)'), comprovante: s('file_uri do comprovante (não é prova definitiva)'),
      status_confirmacao: e(['INFORMADO', 'EM_CONFIRMACAO', 'CONFIRMADO', 'REJEITADO'], 'Status', 'INFORMADO'), informado_por: ref('Quem informou'), informado_por_perfil: s('Perfil de quem informou'),
      valor_confirmado_centavos: c('Valor confirmado'), data_confirmacao: ts('Data da confirmação/rejeição'), confirmado_por: ref('Usuário do credor'), motivo_rejeicao: s('Motivo da rejeição'),
    },
    required: ['empresa_id', 'divida_id', 'valor_centavos', 'data_informada', 'status_confirmacao'],
  },
  ConfirmacaoPagamento: {
    description: 'Evidência da confirmação pelo credor (também usada como trava contra confirmação dupla)',
    properties: { ...EMP, pagamento_id: ref('Pagamento'), confirmado_por: ref('Usuário'), data_confirmacao: ts('Data'), evidencia: s('Evidência (extrato, file_uri)'), observacao: s('Observação'), valor_confirmado_centavos: c('Valor'), status: e(['VALIDA', 'DESCARTADA_DUPLICIDADE', 'DESCARTADA_CONCORRENCIA'], 'Status', 'VALIDA') },
    required: ['empresa_id', 'pagamento_id', 'confirmado_por'],
  },
  PrestacaoContas: {
    description: 'Relatório de prestação de contas por contrato/período',
    properties: { ...EMP, contrato_servico_id: ref('ContratoServico'), periodo_inicio: dt('Início'), periodo_fim: dt('Fim'), quantidade_casos: n('Casos'), valor_cobrado_centavos: c('Valor do serviço'), valor_negociado_centavos: c('Valor negociado'), valor_confirmado_centavos: c('Valor recuperado confirmado'), relatorio: s('JSON do relatório'), data_geracao: ts('Geração') },
    required: ['empresa_id', 'contrato_servico_id', 'periodo_inicio', 'periodo_fim'],
  },
  HistoricoAuditoria: {
    description: 'Trilha de auditoria (somente inserção)',
    properties: { empresa_id: s('Empresa afetada'), usuario_id: ref('UsuarioPlataforma'), usuario_email: s('E-mail'), perfil: s('Perfil'), acao: s('Ação'), entidade: s('Entidade'), registro_id: s('Registro'), dados_anteriores: s('JSON antes'), dados_novos: s('JSON depois'), data_hora: ts('Data/hora') },
    required: ['acao', 'data_hora'],
  },
  Notificacao: {
    description: 'Notificação interna',
    properties: { empresa_id: s('Empresa (vazio p/ HS)'), usuario_id: ref('Destinatário'), tipo: s('Tipo'), titulo: s('Título'), mensagem: s('Mensagem'), link: s('Rota interna'), lida: b('Lida'), data_criacao: ts('Criação') },
    required: ['usuario_id', 'titulo'],
  },
  ModeloMensagem: {
    description: 'Modelos de mensagem (globais HS ou da empresa). aprovado_meta indica template aprovado na WhatsApp Business Platform (futuro).',
    properties: { empresa_id: s('Empresa (vazio = global)'), nome: s('Nome'), canal: e(['WHATSAPP', 'EMAIL', 'SMS'], 'Canal', 'WHATSAPP'), conteudo: s('Texto com {{nome}}, {{credor}}, {{valor}}, {{vencimento}}'), status: e(['ATIVO', 'INATIVO'], 'Status', 'ATIVO'), aprovado_meta: b('Aprovado na Meta'), nome_template_meta: s('Nome do modelo aprovado na Meta'), idioma_template: s('Idioma do modelo (ex.: pt_BR)') },
    required: ['nome', 'conteudo'],
  },
  ConfiguracaoComunicacao: {
    description: 'Status das integrações (tudo INDISPONIVEL até configuração real)',
    properties: { whatsapp_api_status: e(['INDISPONIVEL', 'CONFIGURANDO', 'ATIVA'], 'WhatsApp Business Platform', 'INDISPONIVEL'), email_status: e(['INDISPONIVEL', 'ATIVA'], 'E-mail', 'INDISPONIVEL'), ia_status: e(['INDISPONIVEL', 'ATIVA'], 'Assistente IA', 'INDISPONIVEL'), observacoes: s('Observações') },
    required: [],
  },
  ConfiguracaoEmpresa: {
    description: 'Configurações da empresa (retenção, DPO, regras)',
    properties: { ...EMP, retencao_meses_apos_quitacao: n('Retenção após quitação (meses)'), exigir_documento_hs: b('Exigir documento para encaminhar à HS', true), encarregado_dpo_nome: s('Encarregado (DPO)'), encarregado_dpo_email: s('E-mail do DPO') },
    required: ['empresa_id'],
  },
  LogIntegracao: {
    description: 'Logs de integrações externas (futuro)',
    properties: { empresa_id: s('Empresa'), integracao: s('Integração'), direcao: e(['ENTRADA', 'SAIDA'], 'Direção'), status: s('Status (TRIAGEM, VINCULADA, DESCARTADA...)'), payload_resumo: s('Resumo da mensagem (acesso restrito à gestão HS)'), caso_id: s('Caso vinculado'), data_hora: ts('Data/hora') },
    required: ['integracao'],
  },
  EventoWebhook: {
    description: 'Eventos recebidos de provedores externos (idempotência)',
    properties: { origem: e(['WHATSAPP', 'ASAAS'], 'Origem'), externo_id: s('ID do evento no provedor'), recebido_em: ts('Recebido em') },
    required: ['origem', 'externo_id'],
  },
  SolicitacaoTitular: {
    description: 'Solicitações de titulares (LGPD art. 18)',
    properties: { ...EMP, devedor_id: ref('Devedor'), tipo: e(['ACESSO', 'CORRECAO', 'ELIMINACAO', 'PORTABILIDADE', 'INFORMACAO_COMPARTILHAMENTO', 'OPOSICAO', 'REVOGACAO_CONSENTIMENTO'], 'Tipo'), descricao: s('Descrição'), canal_recebimento: s('Canal'), status: e(['ABERTA', 'EM_ANALISE', 'CONCLUIDA', 'NEGADA_FUNDAMENTADA'], 'Status', 'ABERTA'), prazo_resposta: dt('Prazo'), resposta: s('Resposta'), data_abertura: ts('Abertura'), data_resposta: ts('Resposta'), respondido_por: ref('Usuário') },
    required: ['empresa_id', 'devedor_id', 'tipo'],
  },
};

// Bloqueio total de acesso direto pelo frontend: tudo passa pela função hsApi (service role).
// Apenas o administrador do app Base44 (dono) acessa diretamente, para suporte.
export const RLS_BLOQUEADO = {
  create: { user_condition: { role: 'admin' } },
  read: { user_condition: { role: 'admin' } },
  update: { user_condition: { role: 'admin' } },
  delete: { user_condition: { role: 'admin' } },
};
