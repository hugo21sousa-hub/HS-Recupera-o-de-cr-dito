# Segurança, multiempresa e LGPD

## Camadas de proteção

| Camada | Como funciona |
|---|---|
| Senhas | Hash **scrypt** com sal individual. Mínimo de 8 caracteres, com letras e números. 5 erros seguidos bloqueiam a conta por 15 minutos, e há limite de tentativas por IP. |
| Verificação em duas etapas | TOTP (RFC 6238), compatível com Google Authenticator, Microsoft Authenticator e Authy. **Obrigatória para a equipe HS**, que fica sem acesso a dados até ativar; opcional para empresas. Segredo cifrado em repouso (AES-256-GCM), proteção contra reuso de código e 8 códigos de recuperação de uso único. Um novo link de acesso gerado pelo administrador redefine a senha e o 2FA. |
| Sessão | Token aleatório em cookie `HttpOnly`, `SameSite=Strict` (e `Secure` em produção), com validade de 12 horas. No banco fica só o hash do token. Trocar a senha encerra as outras sessões. |
| CSRF | Além do `SameSite=Strict`, toda requisição de escrita exige o cabeçalho `X-HS: 1`. |
| Convites | Link de uso único, válido por 7 dias, guardado em hash. Um e-mail convidado não pode ser "tomado" por cadastro público. O mesmo mecanismo serve para redefinir senha. |
| Autorização | `UsuarioPlataforma` (perfil, empresa, status) é lido pelo servidor a partir da sessão. O navegador nunca informa perfil nem empresa. |
| Isolamento multiempresa | Para usuário de empresa, a empresa vem sempre do perfil. Pedir registro de outra empresa (por id na URL ou `empresa_id` no pedido) devolve **404**, sem revelar se o registro existe. |
| Equipe HS | Acessa dados de empresas **somente pelo caso**: só casos `HS_GERENCIADA`. O operador vê apenas os casos atribuídos a ele e em andamento, e perde o acesso se o caso for suspenso ou encerrado. Nenhum perfil HS lista devedores ou dívidas da empresa. |
| Superadmin | Leitura global, mas **cada acesso a dados de empresa gera `ACESSO_ADMINISTRATIVO`** na auditoria. Não confirma pagamentos nem aprova negociações no lugar do credor. |
| Arquivos | Ficam em disco com nome aleatório e fora da pasta pública. Aceitos: PDF/PNG/JPG/WEBP/CSV/TXT, até 10 MB, com o conteúdo conferido pelo tipo real. Só quem enviou o arquivo pode vinculá-lo, uma vez. O download usa link assinado (HMAC) de 5 minutos, gerado depois da checagem de acesso, com `sandbox` e `nosniff`. |
| Transações | Cada requisição roda isolada numa transação SQLite. Se a ação falha, nada do que ela gravou permanece. Isso também impede confirmação dupla simultânea de pagamento. |
| Auditoria | `HistoricoAuditoria` registra toda criação ou alteração (com dados antes e depois), além de exportações, acessos a documentos e acessos administrativos. |
| E-mails | Só são enviados depois que a operação é gravada com sucesso. "Esqueci minha senha" responde igual exista ou não a conta, sem revelar e-mails cadastrados. |
| Cabeçalhos | CSP restritiva (`script-src 'self'`), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, e HSTS em produção. |
| Exportações | O CSV respeita o escopo de quem exporta, é auditado e neutraliza fórmulas (`=`, `+`, `-`, `@`). |

## Cobrança não abusiva (CDC arts. 42 e 71)

- Mensagens com ameaça, constrangimento ou exposição são **bloqueadas** (`src/core/compliance.js`). É uma barreira mínima; a lista deve ser revisada pelo jurídico.
- No máximo **3 tentativas de contato por dia** por caso.
- Contato só pelos **canais autorizados** pelo credor e dentro da **janela de horário** (padrão: 08h às 20h, segunda a sábado).
- Quando o devedor pede para não ser contatado, ele recebe a marca `nao_contatar`, os contatos ficam bloqueados e o credor é avisado.
- Contestação leva o caso para `CONTESTACAO` e avisa o credor.
- Não existe disparo em massa: cada mensagem é preparada e enviada individualmente.

## Papéis LGPD (a validar com o jurídico)

- **Empresa credora = controladora** dos dados dos devedores. A base legal sugerida é o exercício regular de direitos e a proteção do crédito (art. 7º, VI e X).
- **HS = operadora** quando executa a cobrança gerenciada, dentro da autorização registrada. A HS é controladora dos dados de empresas e usuários da plataforma.
- Direitos do titular:
  - registro das solicitações, com prazo de 15 dias;
  - exportação dos dados do titular (acesso e portabilidade);
  - correção cadastral;
  - anonimização, bloqueada enquanto houver dívida em aberto ou cobrança ativa.
- Retenção configurável por empresa (padrão de 60 meses após a quitação). Uma rotina diária anonimiza os titulares vencidos e apaga os anexos, preservando o histórico financeiro sem identificação.
- Minimização: o operador HS só vê o necessário para o caso atribuído.

## Limitações conhecidas

1. **Integrações:** e-mail (SMTP), WhatsApp Business e Asaas estão implementados e testados contra servidores simulados que reproduzem as APIs. Ainda não foram exercitados contra as contas reais, então faça a primeira validação no ambiente de testes (sandbox) de cada provedor.
2. **Verificação de e-mail no cadastro público:** não existe. A mitigação é que toda empresa nova passa pela validação da HS antes de usar a cobrança gerenciada.
3. **Webhooks:** o WhatsApp é validado pela assinatura HMAC (App Secret) e o Asaas por um token compartilhado. Use HTTPS sempre.
4. **SQLite** (`node:sqlite`, embutido no Node 22) atende bem um único servidor. Para alta disponibilidade, migrar para PostgreSQL.
