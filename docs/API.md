# Referência da API `hsApi`

Gerado por `node scripts/gen-api-doc.mjs`. Chamada: `hs(acao, payload)` (ver `base44/frontend/hsApi.js`).

Perfis: SUPERADMIN, GESTOR_OPERACOES, OPERADOR (HS) · ADMIN_EMP, FINANCEIRO_EMP, VISUALIZADOR_EMP.
"verificação interna" = a ação decide a permissão conforme o caso (ex.: perfil HS × empresa).

| Ação | Permissão | Perfis |
|---|---|---|
| `abrirCobrancaPropria` | `interacao.registrar` | SUPERADMIN, GESTOR_OPERACOES, OPERADOR, ADMIN_EMP |
| `aceitarContrato` | `contrato.contratar` | ADMIN_EMP |
| `adicionarDividasCarteira` | `carteira.editar` | ADMIN_EMP |
| `alterarModalidade` | `carteira.encaminhar_hs` | ADMIN_EMP |
| `alterarStatusCaso` | verificação interna | — |
| `alterarStatusEmpresa` | `empresa.gerenciar_todas` | SUPERADMIN |
| `alterarUsuario` | verificação interna | — |
| `anexarDocumento` | `documento.enviar` | ADMIN_EMP |
| `anonimizarDevedor` | `lgpd.atender` | ADMIN_EMP |
| `atribuirCaso` | `caso.distribuir` | SUPERADMIN, GESTOR_OPERACOES |
| `atualizarEmpresa` | verificação interna | — |
| `cancelarDivida` | `divida.editar` | ADMIN_EMP |
| `cancelarNegociacao` | `negociacao.propor` | SUPERADMIN, GESTOR_OPERACOES, OPERADOR, ADMIN_EMP |
| `concluirTarefa` | `tarefa.gerenciar` | SUPERADMIN, GESTOR_OPERACOES, OPERADOR, ADMIN_EMP |
| `confirmarPagamento` | `pagamento.confirmar` | ADMIN_EMP, FINANCEIRO_EMP |
| `convidarUsuario` | verificação interna | — |
| `dashboardEmpresa` | `relatorio.empresa` | SUPERADMIN, ADMIN_EMP, FINANCEIRO_EMP, VISUALIZADOR_EMP |
| `dashboardHS` | `relatorio.hs` | SUPERADMIN, GESTOR_OPERACOES |
| `decidirNegociacao` | `negociacao.aprovar_empresa` | ADMIN_EMP, FINANCEIRO_EMP |
| `detalheCarteira` | `carteira.ler` | SUPERADMIN, ADMIN_EMP, FINANCEIRO_EMP, VISUALIZADOR_EMP |
| `detalheCaso` | verificação interna | — |
| `detalheDevedor` | `devedor.ler` | SUPERADMIN, ADMIN_EMP, FINANCEIRO_EMP, VISUALIZADOR_EMP |
| `detalheDivida` | `divida.ler` | SUPERADMIN, ADMIN_EMP, FINANCEIRO_EMP, VISUALIZADOR_EMP |
| `distribuirAutomatico` | `caso.distribuir` | SUPERADMIN, GESTOR_OPERACOES |
| `encaminharParaHS` | `carteira.encaminhar_hs` | ADMIN_EMP |
| `encerrarAcordo` | verificação interna | — |
| `encerrarContrato` | verificação interna | — |
| `escolherServico` | `empresa.editar` | ADMIN_EMP |
| `exportarCSV` | `relatorio.exportar` | ADMIN_EMP, FINANCEIRO_EMP |
| `exportarDadosTitular` | `lgpd.atender` | ADMIN_EMP |
| `formalizarAcordo` | `negociacao.propor` | SUPERADMIN, GESTOR_OPERACOES, OPERADOR, ADMIN_EMP |
| `gerarLinkAcesso` | verificação interna | — |
| `gerarPrestacaoContas` | verificação interna | — |
| `historicoFinanceiro` | `divida.ler` | SUPERADMIN, ADMIN_EMP, FINANCEIRO_EMP, VISUALIZADOR_EMP |
| `importarPlanilha` | `divida.editar` | ADMIN_EMP |
| `informarPagamento` | `pagamento.informar` | SUPERADMIN, GESTOR_OPERACOES, OPERADOR, ADMIN_EMP, FINANCEIRO_EMP |
| `iniciarConferencia` | `pagamento.confirmar` | ADMIN_EMP, FINANCEIRO_EMP |
| `listarAcordos` | verificação interna | — |
| `listarAprovacoesPendentes` | `negociacao.aprovar_empresa` | ADMIN_EMP, FINANCEIRO_EMP |
| `listarAuditoria` | `auditoria.ler` | SUPERADMIN |
| `listarAutorizacoes` | `carteira.ler` | SUPERADMIN, ADMIN_EMP, FINANCEIRO_EMP, VISUALIZADOR_EMP |
| `listarCarteiras` | `carteira.ler` | SUPERADMIN, ADMIN_EMP, FINANCEIRO_EMP, VISUALIZADOR_EMP |
| `listarCarteirasRecebidas` | `caso.ler_todos_hs` | SUPERADMIN, GESTOR_OPERACOES |
| `listarCasos` | verificação interna | — |
| `listarContratos` | verificação interna | — |
| `listarDevedores` | `devedor.ler` | SUPERADMIN, ADMIN_EMP, FINANCEIRO_EMP, VISUALIZADOR_EMP |
| `listarDividas` | `divida.ler` | SUPERADMIN, ADMIN_EMP, FINANCEIRO_EMP, VISUALIZADOR_EMP |
| `listarEmpresas` | `empresa.gerenciar_todas` | SUPERADMIN |
| `listarEmpresasAtendidas` | `caso.ler_todos_hs` | SUPERADMIN, GESTOR_OPERACOES |
| `listarInteracoes` | verificação interna | — |
| `listarModelosMensagem` | verificação interna | — |
| `listarNegociacoes` | verificação interna | — |
| `listarNotificacoes` | verificação interna | — |
| `listarOperadores` | `caso.distribuir` | SUPERADMIN, GESTOR_OPERACOES |
| `listarPagamentos` | verificação interna | — |
| `listarParcelas` | `divida.ler` | SUPERADMIN, ADMIN_EMP, FINANCEIRO_EMP, VISUALIZADOR_EMP |
| `listarPlanos` | verificação interna | — |
| `listarPrestacoes` | verificação interna | — |
| `listarSolicitacoesTitular` | `lgpd.atender` | ADMIN_EMP |
| `listarTarefas` | `tarefa.gerenciar` | SUPERADMIN, GESTOR_OPERACOES, OPERADOR, ADMIN_EMP |
| `listarUsuarios` | verificação interna | — |
| `marcarNotificacaoLida` | verificação interna | — |
| `meuPerfil` | autenticado (sem perfil) | todos |
| `minhaAssinatura` | `assinatura.ler` | SUPERADMIN, ADMIN_EMP, FINANCEIRO_EMP, VISUALIZADOR_EMP |
| `obterConfiguracoes` | `empresa.ler` | SUPERADMIN, ADMIN_EMP, FINANCEIRO_EMP, VISUALIZADOR_EMP |
| `prepararWhatsApp` | `interacao.registrar` | SUPERADMIN, GESTOR_OPERACOES, OPERADOR, ADMIN_EMP |
| `previewEncaminhamento` | `carteira.encaminhar_hs` | ADMIN_EMP |
| `proporNegociacao` | `negociacao.propor` | SUPERADMIN, GESTOR_OPERACOES, OPERADOR, ADMIN_EMP |
| `puxarProximoCaso` | `caso.puxar_fila` | OPERADOR |
| `registrarEmpresa` | autenticado (sem perfil) | todos |
| `registrarInteracao` | `interacao.registrar` | SUPERADMIN, GESTOR_OPERACOES, OPERADOR, ADMIN_EMP |
| `registrarNaoContatar` | `devedor.editar` | ADMIN_EMP |
| `registrarSolicitacaoTitular` | `lgpd.atender` | ADMIN_EMP |
| `rejeitarPagamento` | `pagamento.confirmar` | ADMIN_EMP, FINANCEIRO_EMP |
| `removerDividaCarteira` | `carteira.editar` | ADMIN_EMP |
| `responderSolicitacaoTitular` | `lgpd.atender` | ADMIN_EMP |
| `revogarAutorizacao` | `autorizacao.conceder` | ADMIN_EMP |
| `salvarAssinatura` | `assinatura.gerenciar` | SUPERADMIN |
| `salvarCarteira` | `carteira.editar` | ADMIN_EMP |
| `salvarContrato` | `contrato.gerenciar` | SUPERADMIN |
| `salvarDevedor` | `devedor.editar` | ADMIN_EMP |
| `salvarDivida` | `divida.editar` | ADMIN_EMP |
| `salvarModeloMensagem` | verificação interna | — |
| `salvarParcelas` | `divida.editar` | ADMIN_EMP |
| `salvarPlano` | `plano.gerenciar` | SUPERADMIN |
| `salvarPoliticaRetencao` | `empresa.editar` | ADMIN_EMP |
| `salvarTarefa` | `tarefa.gerenciar` | SUPERADMIN, GESTOR_OPERACOES, OPERADOR, ADMIN_EMP |
| `seedPlanos` | `plano.gerenciar` | SUPERADMIN |
| `simularNegociacao` | `negociacao.propor` | SUPERADMIN, GESTOR_OPERACOES, OPERADOR, ADMIN_EMP |
| `statusIntegracoes` | verificação interna | — |
| `urlComprovante` | verificação interna | — |
| `urlDocumento` | `documento.ler` | SUPERADMIN, GESTOR_OPERACOES, OPERADOR, ADMIN_EMP, FINANCEIRO_EMP, VISUALIZADOR_EMP |
| `validarCaso` | `carteira.validar` | SUPERADMIN, GESTOR_OPERACOES |

## Matriz de permissões

| Permissão | SUPERADMIN_HS | GESTOR_OPERACOES_HS | OPERADOR_HS | ADMIN_EMPRESA | FINANCEIRO_EMPRESA | VISUALIZADOR_EMPRESA |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `acordo.ler` |  |  |  | ✔ | ✔ | ✔ |
| `assinatura.gerenciar` | ✔ |  |  |  |  |  |
| `assinatura.gerenciar_propria` |  |  |  | ✔ |  |  |
| `assinatura.ler` | ✔ |  |  | ✔ | ✔ | ✔ |
| `auditoria.ler` | ✔ |  |  |  |  |  |
| `autorizacao.conceder` |  |  |  | ✔ |  |  |
| `carteira.editar` |  |  |  | ✔ |  |  |
| `carteira.encaminhar_hs` |  |  |  | ✔ |  |  |
| `carteira.ler` | ✔ |  |  | ✔ | ✔ | ✔ |
| `carteira.validar` | ✔ | ✔ |  |  |  |  |
| `caso.distribuir` | ✔ | ✔ |  |  |  |  |
| `caso.ler_atribuidos` |  |  | ✔ |  |  |  |
| `caso.ler_empresa` |  |  |  | ✔ | ✔ | ✔ |
| `caso.ler_todos_hs` | ✔ | ✔ |  |  |  |  |
| `caso.puxar_fila` |  |  | ✔ |  |  |  |
| `caso.suspender` | ✔ | ✔ |  |  |  |  |
| `caso.suspender_proprio` |  |  |  | ✔ |  |  |
| `config.sistema` | ✔ |  |  |  |  |  |
| `contrato.contratar` |  |  |  | ✔ |  |  |
| `contrato.gerenciar` | ✔ |  |  |  |  |  |
| `contrato.ler` | ✔ |  |  | ✔ | ✔ | ✔ |
| `devedor.editar` |  |  |  | ✔ |  |  |
| `devedor.ler` | ✔ |  |  | ✔ | ✔ | ✔ |
| `divida.editar` |  |  |  | ✔ |  |  |
| `divida.ler` | ✔ |  |  | ✔ | ✔ | ✔ |
| `documento.enviar` |  |  |  | ✔ |  |  |
| `documento.ler` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `empresa.editar` |  |  |  | ✔ |  |  |
| `empresa.gerenciar_todas` | ✔ |  |  |  |  |  |
| `empresa.ler` | ✔ |  |  | ✔ | ✔ | ✔ |
| `global` | ✔ |  |  |  |  |  |
| `interacao.registrar` | ✔ | ✔ | ✔ | ✔ |  |  |
| `lgpd.atender` |  |  |  | ✔ |  |  |
| `lgpd.gerenciar` | ✔ |  |  |  |  |  |
| `negociacao.aprovar_empresa` |  |  |  | ✔ | ✔ |  |
| `negociacao.ler` |  |  |  | ✔ | ✔ | ✔ |
| `negociacao.propor` | ✔ | ✔ | ✔ | ✔ |  |  |
| `negociacao.revisar` | ✔ | ✔ |  |  |  |  |
| `operador.gerenciar` | ✔ |  |  |  |  |  |
| `operador.ver` |  | ✔ |  |  |  |  |
| `pagamento.confirmar` |  |  |  | ✔ | ✔ |  |
| `pagamento.informar` | ✔ | ✔ | ✔ | ✔ | ✔ |  |
| `pagamento.ler` | ✔ |  |  | ✔ | ✔ | ✔ |
| `plano.gerenciar` | ✔ |  |  |  |  |  |
| `prestacao.gerar` | ✔ | ✔ |  |  |  |  |
| `relatorio.empresa` | ✔ |  |  | ✔ | ✔ | ✔ |
| `relatorio.exportar` |  |  |  | ✔ | ✔ |  |
| `relatorio.hs` | ✔ | ✔ |  |  |  |  |
| `tarefa.gerenciar` | ✔ | ✔ | ✔ | ✔ |  |  |
| `usuario.gerenciar_empresa` | ✔ |  |  | ✔ |  |  |
| `usuario.gerenciar_interno` | ✔ |  |  |  |  |  |
