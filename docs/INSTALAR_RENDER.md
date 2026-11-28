# Colocar no ar de graça: Render + Supabase

Custo: **R$ 0**, em geral sem precisar de cartão. Tudo fica na nuvem:

- **Supabase:** guarda o banco de dados (PostgreSQL), os anexos e o backup diário.
- **Render:** roda o sistema e dá o endereço `https://….onrender.com`, com HTTPS.

Para uma operação inicial (cerca de 10 clientes) sobra capacidade. Tempo estimado: 30 minutos.

---

## 1. Criar o banco no Supabase

1. Acesse **supabase.com**, clique em **Start your project** e entre com sua conta do **GitHub**.
2. Clique em **New project** e preencha:
   - **Name:** `hs-recuperacao`
   - **Database Password:** clique em **Generate a password** e **guarde essa senha**
   - **Region:** **East US (Ohio)**, a mesma região em que o Render roda (`render.yaml`). Banco e sistema juntos deixam as telas mais rápidas. Se criar o banco em outra região, ajuste `region` no `render.yaml`.
   - **Plano:** Free
3. Clique em **Create new project** e aguarde de 1 a 2 minutos.

### Copiar os 3 dados de conexão

Guarde estes três valores num bloco de notas. Eles vão para o Render no passo 2.

**a) DATABASE_URL**
1. No topo do projeto, clique em **Connect**.
2. Escolha **Connection String › Session pooler**. Use o *Session pooler*: o Render precisa dele.
3. Copie o endereço, que começa com `postgresql://postgres.…@aws-…pooler.supabase.com:5432/postgres`.
4. Troque `[YOUR-PASSWORD]` pela senha do banco que você guardou.

**b) SUPABASE_URL**
Em **Project Settings › Data API**, copie a **Project URL** (`https://xxxx.supabase.co`).

**c) SUPABASE_SERVICE_KEY**
Em **Project Settings › API Keys**, copie a chave **service_role** (aba *Legacy API keys*) ou uma **Secret key** (`sb_secret_…`).

> **Essa chave dá acesso total ao projeto.** Ela só vai no Render; nunca a coloque no código, no GitHub nem mande para ninguém.

O sistema cria sozinho as tabelas (no esquema `hs`, que fica fora da API pública do Supabase) e o bucket privado de arquivos.

## 2. Publicar no Render

1. Acesse **render.com** e crie a conta com o **GitHub**.
2. Autorize o Render a ver o repositório **HS-Recupera-o-de-cr-dito**.
3. Clique em **New › Blueprint** e escolha o repositório. O Render lê o arquivo `render.yaml`, que já tem toda a configuração.
4. Preencha os campos pedidos:

| Campo | Valor |
|---|---|
| `DATABASE_URL` | o endereço do passo 1a, já com a senha |
| `SUPABASE_URL` | a Project URL do passo 1b |
| `SUPABASE_SERVICE_KEY` | a chave do passo 1c |
| `SUPERADMIN_EMAIL` | seu e-mail (você será o superadmin) |
| `SUPERADMIN_NOME` | seu nome |

5. Clique em **Apply** (ou **Deploy Blueprint**). A primeira publicação leva de 5 a 10 minutos.

## 3. Primeiro acesso

1. No Render, abra o serviço **hs-recuperacao › Logs**.
2. Procure a linha **`PRIMEIRO ACESSO`** e abra o link que aparece logo abaixo.
3. Crie sua senha e configure a verificação em duas etapas no celular (Google Authenticator, Microsoft Authenticator ou Authy).

Pronto: o sistema está em **https://hs-recuperacao.onrender.com**. O endereço exato aparece no topo da página do serviço no Render.

### Alternativa sem procurar nos Logs

No Render, em **Environment**, adicione a variável `PRIMEIRO_ACESSO_CODIGO` com um código que só você saiba (de 16 a 100 letras e números, sem espaços). Salve e aguarde o deploy. O seu link de primeiro acesso passa a ser:

`https://hs-recuperacao.onrender.com/convite/SEU_CODIGO`

Depois que você criar a senha, o código deixa de funcionar e pode ser apagado do Render.

## 4. Manter o sistema "acordado" (recomendado)

**A Acorly usa o plano Starter do Render (desde novembro de 2026): o sistema fica sempre ligado, e as rotinas de hora em hora mantêm o Supabase ativo. Este passo só é necessário no plano grátis.**

No plano grátis, o Render desliga o sistema após 15 minutos sem acesso, e o próximo acesso demora cerca de 1 minuto. Já o Supabase pausa projetos parados por 7 dias. Para evitar as duas coisas, de graça:

1. Acesse **cron-job.org** e crie uma conta.
2. Clique em **Create cronjob**:
   - **Title:** `Acorly`
   - **URL:** `https://hs-recuperacao.onrender.com/api/saude` (com o seu endereço)
   - **Execution schedule:** a cada **10 minutos**
   - **Notifications:** marque **execution of the cronjob fails** e **cronjob will be disabled because of too many failures**. Assim você recebe um e-mail se o sistema ou o banco caírem.
3. Salve (**Create**).

Esse endereço também confere o banco de dados. Se ele responder com erro, o cron-job.org avisa você.

Um único serviço ligado o mês inteiro cabe nas horas grátis do Render.

---

## Backups

Todo dia o sistema grava uma cópia completa dos dados no Supabase, em **Storage › hs-arquivos › backups**, e guarda os últimos 14 dias. Baixe uma cópia de vez em quando: no Supabase, abra o arquivo e clique em **Download**.

## Atualizações

Sempre que houver uma alteração no GitHub (branch `main`), o Render publica a nova versão sozinho, em poucos minutos.

## Ligar e-mail, WhatsApp ou Asaas

No Render, abra **hs-recuperacao › Environment**, clique em **Add Environment Variable**, preencha as variáveis descritas em `docs/IMPLANTACAO.md` e salve. O Render reinicia sozinho.

## Código de acesso por e-mail (Brevo, grátis)

Com o envio de e-mail ligado, toda entrada no sistema pede um **código de 6 dígitos enviado ao e-mail** da pessoa, no lugar do aplicativo autenticador. Os convites e o "esqueci minha senha" também passam a chegar por e-mail.

O Render grátis **bloqueia o envio por SMTP**, por isso o sistema usa a API do **Brevo**: são 300 e-mails por dia de graça, sem cartão.

1. Crie a conta em **brevo.com** (plano Free).
2. Cadastre o remetente: menu **Senders, Domains & Dedicated IPs › Senders › Add a sender**, com nome `Acorly` e o e-mail `contato@acorly.com.br`. Confirme pelo e-mail que o Brevo enviar.
3. Gere a chave: menu **SMTP & API › API Keys › Generate a new API key** (nome `render`). Copie a chave, que começa com `xkeysib-`.
4. No Render, em **hs-recuperacao › Environment**, adicione:

| Variável | Valor |
|---|---|
| `BREVO_API_KEY` | a chave `xkeysib-…` |
| `EMAIL_REMETENTE` | `Acorly <contato@acorly.com.br>` (o mesmo e-mail confirmado no passo 2) |

5. Salve (**Save, rebuild, and deploy**).

Para voltar a usar o aplicativo autenticador, defina `VERIFICACAO_LOGIN=app`. Com remetente `@gmail.com`, alguns e-mails podem cair no spam; com um domínio próprio verificado no Brevo, a entrega melhora.

## Receber as assinaturas (Asaas: Pix, boleto e cartão)

As empresas clientes contratam ou trocam de plano no próprio sistema (**Assinatura › Assinar**). O sistema cria a cobrança mensal no Asaas, e a empresa paga por **Pix, boleto ou cartão de crédito** na fatura do Asaas. Quando o pagamento é confirmado, o plano é ativado sozinho. Se uma mensalidade atrasar, a assinatura fica como inadimplente.

Planos padrão:

| Plano | Mensalidade | Devedores | Usuários |
|---|---|---|---|
| Acorly Essencial | R$ 49,90 | até 100 | 2 |
| Acorly Profissional | R$ 89,90 | até 500 | 5 |
| Acorly Empresarial | R$ 159,90 | até 1.000 | 15 |
| Acorly Ilimitado | R$ 259,90 | ilimitados | ilimitados |

Os valores podem ser ajustados a qualquer momento em **Superadmin › Planos e assinaturas**.

**Teste grátis e bloqueio:**

- Toda empresa nova tem **7 dias grátis**, com todos os recursos, até 20 devedores e 3 usuários. Não precisa de cartão.
- Quando o teste termina sem assinatura, o acesso fica **somente para consulta**. A empresa vê e exporta os dados, mas não cadastra nem edita até assinar.
- Com a mensalidade em atraso, a empresa tem **5 dias de tolerância** com acesso normal. Depois disso, o acesso também fica somente para consulta, até o pagamento.
- Cada plano libera os recursos listados nele. Por exemplo, importação de planilhas, carteiras, negociação e relatórios ficam a partir do Profissional, e exportação a partir do Empresarial.
- Empresas com contrato de cobrança gerenciada ativo continuam cadastrando e encaminhando dívidas ao Acorly mesmo sem assinatura.
- Para liberar uma empresa manualmente (parceiro, cortesia), crie a assinatura em **Superadmin › Planos e assinaturas**.

### 1. Testar no ambiente de testes (sandbox), sem dinheiro de verdade

1. Crie uma conta em **sandbox.asaas.com**.
2. Gere a chave: **Integrações › Chaves de API › Gerar chave**. Copie a chave e não a mande para ninguém.
3. Cadastre o webhook em **Integrações › Webhooks › Adicionar**:
   - **URL:** `https://hs-recuperacao.onrender.com/webhooks/asaas`
   - **Token de autenticação:** invente um código longo, só letras e números (ex.: 32 caracteres)
   - **Versão da API:** v3
   - **Eventos:** marque os eventos de **Cobranças** (pagamento criado, confirmado, recebido, vencido, estornado, excluído)
   - **Fila de sincronização:** ativada
4. No Render (**Environment**), adicione:

| Variável | Valor |
|---|---|
| `ASAAS_API_KEY` | a chave do passo 2 |
| `ASAAS_AMBIENTE` | `sandbox` |
| `ASAAS_WEBHOOK_TOKEN` | o mesmo token do passo 3 |

5. Salve (**Save, rebuild, and deploy**). Entre como uma empresa de teste, assine um plano e pague a fatura pelo sandbox (há um botão para simular o pagamento). O plano deve ficar **Ativo**.

### 2. Passar a receber de verdade

1. Crie a conta em **asaas.com** com o CNPJ (ou CPF) da HS e envie os documentos pedidos. A aprovação pode levar alguns dias.
2. Repita os passos 2 e 3 na conta de produção (chave e webhook novos).
3. No Render, troque `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN` pelos de produção e defina `ASAAS_AMBIENTE=producao`.

O Asaas só recebe a **assinatura da plataforma**. Os devedores continuam pagando direto às empresas credoras.

## Avisos automáticos

**Mensalidade (Asaas):** quando uma empresa assina, o sistema configura no Asaas os avisos por **e-mail**:
- fatura criada;
- lembrete antes do vencimento;
- aviso no dia do vencimento;
- aviso de atraso;
- confirmação de pagamento.

SMS, ligação e WhatsApp do Asaas ficam desligados, porque podem ter custo por envio. Se quiser ligar algum, use o painel do Asaas, em **Clientes › Notificações**.

**No próprio Acorly** (aviso dentro do sistema e por e-mail ao administrador da empresa), uma vez cada, das 9h às 18h:
- a mensalidade vence em 3 dias;
- último dia da tolerância de atraso;
- o teste grátis termina em 2 dias e no último dia.

**Parcelas de acordos:** o devedor recebe um e-mail 3 dias antes e no dia do vencimento de cada parcela.
- Só funciona com o envio de cobrança por e-mail ligado (`EMAIL_COBRANCA_REMETENTE`).
- Na cobrança gerenciada, o e-mail precisa estar entre os canais autorizados.
- Respeita o descadastro e o limite de contatos.
- Cada lembrete fica registrado no histórico do caso.
- Os lembretes por WhatsApp aparecem na **Fila do dia** da Central de mensagens.

## Prestação de contas aos clientes

**Automática:** todo dia 1º (das 9h às 18h), o sistema gera a prestação de contas do mês anterior para cada contrato de cobrança gerenciada e avisa o administrador e o financeiro de cada empresa, no sistema e por e-mail. O aviso traz o resumo:
- recuperado no mês e desde o início;
- acordos;
- a receber;
- saldo em cobrança.

A empresa abre o relatório completo e baixa o PDF em **Relatórios**.

**Manual:** em **Relatórios**, você pode:
- gerar a de um período qualquer, marcando "Enviar por e-mail";
- usar **Gerar o mês para todos os clientes**;
- reenviar uma prestação já gerada.

## Encarregado de dados (LGPD)

No Render (**Environment**), adicione `DPO_NOME` com o nome do encarregado pelo tratamento de dados. Ele aparece na **Política de Privacidade** (acorly.com.br/privacidade) junto com o e-mail `contato@acorly.com.br`.

## Conteúdo e redes sociais

Em **Negócio › Conteúdo e redes sociais** (superadmin):
- **Próximos posts:** a cada 2 dias o sistema sugere um post para o LinkedIn e um para o Instagram, com texto, hashtags, roteiro e arte pronta (PNG). **Nada é publicado automaticamente.** Revise, edite se quiser e clique em **Aprovar e enviar ao marketing**.
- **Marketing:** convide a pessoa em **Equipe interna** com o perfil **Marketing**. Ela só vê essa tela, recebe aviso por e-mail a cada post aprovado, baixa a arte e o texto, publica manualmente e clica em **Marcar como publicado**.
- **Redes sociais:** cadastre os links dos perfis (Instagram, LinkedIn, Facebook, YouTube, TikTok). Eles aparecem no rodapé do site.

O banco inicial tem 16 temas (cerca de um mês). Quando estiver acabando, o sistema avisa. Aí é só cadastrar novos posts em **Novo post** ou pedir novos temas.

## Contato no site

O endereço principal mostra o site de apresentação da HS, com os planos atualizados automaticamente. Para exibir o seu e-mail e WhatsApp no rodapé, adicione no Render (**Environment**) as variáveis `CONTATO_EMAIL` e `CONTATO_WHATSAPP` (ex.: `5511999999999`).

## Domínio próprio: acorly.com.br

**1. Render (endereço do sistema)**
1. Abra **hs-recuperacao › Settings › Custom Domains › Add Custom Domain**.
2. Adicione `acorly.com.br`, depois `www.acorly.com.br`.
3. Na zona de DNS do domínio, crie os registros que o Render mostrar (um **A** para `acorly.com.br` e um **CNAME** para `www`). Não apague os registros do e-mail (MX, SPF).
4. Aguarde o Render mostrar **Verified** e o certificado HTTPS emitido.
5. Em **Environment**, adicione `URL_BASE` = `https://acorly.com.br` e clique em **Save, rebuild, and deploy**.

A partir daí, quem abrir `www.acorly.com.br` ou `hs-recuperacao.onrender.com` é levado para `https://acorly.com.br`. A API, os webhooks e o monitoramento continuam funcionando também pelo endereço antigo.

**2. Brevo (e-mails do sistema e de cobrança)**
1. No Brevo, abra **Senders, Domains & Dedicated IPs › Domains › Add a domain** e informe `acorly.com.br`.
2. Crie na zona de DNS os registros que o Brevo mostrar: o código de verificação (TXT `brevo-code`), o **DKIM** e o **DMARC**.
   - Se já existir um registro `_dmarc`, mantenha só um.
   - Se o Brevo pedir SPF e já houver um TXT `v=spf1` do seu e-mail, acrescente `include:spf.brevo.com` nele em vez de criar outro.
3. Clique em **Authenticate this email domain** (Verificar) até tudo aparecer verificado.
4. Em **Senders**, adicione o remetente `contato@acorly.com.br` (nome `Acorly`) e confirme.
5. No Render (**Environment**):

| Variável | Valor |
|---|---|
| `EMAIL_REMETENTE` | `Acorly <contato@acorly.com.br>` |
| `EMAIL_COBRANCA_REMETENTE` | `contato@acorly.com.br` |
| `CONTATO_EMAIL` | `contato@acorly.com.br` |

6. Clique em **Save, rebuild, and deploy**.

`EMAIL_COBRANCA_REMETENTE` libera o envio de e-mails aos devedores e os lembretes de parcela. Nesses e-mails, o nome que aparece é o do credor ("Loja X via Acorly") ou "HS Recuperação de Crédito", e a resposta do devedor vai para quem enviou. Se quiser separar as caixas depois, crie `cobranca@acorly.com.br` e troque só essa variável.

**3. Atualize os endereços nos serviços externos**
- **Asaas:** em **Integrações › Webhooks**, troque a URL para `https://acorly.com.br/webhooks/asaas`.
- **cron-job.org:** pode trocar a URL para `https://acorly.com.br/api/saude`. O endereço antigo também funciona.
- **Google:** opcionalmente, cadastre o site no Google Search Console (`https://acorly.com.br/sitemap.xml` já existe).

## Limites do plano grátis

| Serviço | Limite | Para 10 clientes |
|---|---|---|
| Supabase | 500 MB de banco e 1 GB de arquivos | Sobra por bastante tempo |
| Render | 512 MB de memória e horas mensais limitadas (a Acorly já usa o Starter, sempre ligado) | Suficiente com um único serviço |

Quando o negócio crescer, basta trocar para um plano pago do Render ou do Supabase. Não precisa mudar nada no sistema.

## Novo link de acesso para o superadmin

Se perder o link antes de criar a senha, reinicie o serviço no Render (**Manual Deploy › Restart service**): um novo link aparece nos logs. Para outras pessoas, use **Usuários › Link de acesso** dentro do próprio sistema.

## Lista do dia (prospecção diária)

Todos os dias, uma busca automática encontra empresas com contato público (site, diretórios) e as envia para **Diagnósticos e prospecção → Lista do dia**.

- Contatos não abordados continuam na lista.
- Ao abordar por e-mail (pelo sistema), WhatsApp ou ligação, o contato sai da lista e vira lead em "Pedidos e contatos".
- Abordados e descartados são apagados após 12 meses.

Para ligar a busca automática:

1. No Render, crie a variável `LEADS_API_TOKEN` com um texto aleatório de pelo menos 24 caracteres. Não envie esse valor por chat.
2. A busca envia os contatos para `POST https://acorly.com.br/api/integracao/prospects` com o cabeçalho `Authorization: Bearer <token>` e o corpo `{ "contatos": [ { "empresa", "segmento", "cidade", "bairro", "site", "email", "telefone", "whatsapp", "fonte_url", "observacao" } ] }`.
   - São até 200 contatos por envio.
   - `fonte_url` (https) é obrigatória.
   - Repetidos (mesmo e-mail, telefone ou domínio de lead ou contato já existente) são ignorados.

## Atendimento WhatsApp com IA (comercial)

O número do WhatsApp da Acorly ligado à API oficial da Meta é atendido por uma IA, o **Claude Haiku 5.5**. A conversa aparece em **Atendimento WhatsApp**, no menu da equipe.

- **Quem a IA atende:** só quem **não é devedor**. Mensagens de números de devedores continuam indo para o caso de cobrança ou para "WhatsApp sem caso".
- **O que ela faz:** se apresenta como assistente virtual e qualifica a empresa (nome e cargo, empresa, tipo, cidade, clientes em atraso, valor, tempo de atraso e e-mail). Responde só com os fatos da Acorly e leva ao diagnóstico grátis. Cada conversa vira um contato em Pedidos e contatos, com origem `WHATSAPP_IA`.
- **Quando passa para a equipe:** quando a pessoa pede uma pessoa, quer fechar ou marcar conversa, faz uma pergunta fora da base, se irrita ou parece devedor; ou ao chegar a 15 respostas na conversa.
  - Nesse momento a IA avisa o cliente e **para de responder**. A equipe recebe um aviso (🙋) e responde pela tela.
  - O botão "Devolver para a IA" faz a IA voltar a responder quando o cliente escrever de novo.
- **Janela de 24 h (regra da Meta):** responder dentro de 24 horas depois da última mensagem do cliente é gratuito. Depois disso, a tela bloqueia a resposta, porque só seria possível com mensagem-modelo paga.
- **Proteções:**
  - a IA responde alguns segundos depois da última mensagem, juntando mensagens seguidas;
  - limite de 300 respostas da IA por dia (`IA_LIMITE_DIARIO`);
  - "parar" ou "sair" encerra a conversa;
  - se a IA falhar 3 vezes, a conversa passa para a equipe.

Variáveis no Render:

| Variável | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | chave da API da Anthropic (console.anthropic.com), com crédito pré-pago e limite de gasto definido lá |
| `WHATSAPP_TOKEN` | token permanente (usuário do sistema) do app da Meta |
| `WHATSAPP_PHONE_NUMBER_ID` | ID do número no Gerenciador do WhatsApp |
| `WHATSAPP_VERIFY_TOKEN` | um texto aleatório, que se repete na configuração do webhook na Meta |
| `WHATSAPP_APP_SECRET` | chave secreta do app da Meta (para conferir a assinatura do webhook) |
| `IA_LIMITE_DIARIO` | opcional (padrão 300) |

Na Meta, o webhook do app aponta para `https://acorly.com.br/webhooks/whatsapp`, com o mesmo `WHATSAPP_VERIFY_TOKEN`, assinando o campo **messages**.

## SDR automático (pré-vendedor por e-mail)

Em **Diagnósticos e prospecção → SDR automático**:

- **Envio sozinho:** em dia útil, das 9h às 18h (Brasília), de hora em hora, o sistema envia até 5 e-mails por rodada aos contatos da busca diária que têm e-mail. Usa o e-mail escrito para cada empresa; sem ele, usa o primeiro modelo ativo.
  - **Volume:** 15 por dia na 1ª semana, 25 na 2ª e 40 a partir da 3ª, para aquecer o domínio. Os envios contam no limite geral de 50 e-mails comerciais por dia, e as campanhas por planilha têm prioridade.
  - Não envia para quem pediu para sair, para quem já recebeu e-mail da Acorly nem para e-mail que voltou.
- **Follow-ups:** nos dias 3, 7 e 14, por e-mail, como resposta ("Re:") ao primeiro. Só saem com a caixa de entrada conectada.
- **Caixa de entrada:** cadastre no Render `IMAP_USUARIO` (ex.: contato@acorly.com.br) e `IMAP_SENHA`. Opcionais: `IMAP_HOST` (padrão `imap.hostinger.com`) e `IMAP_PORTA` (padrão 993).
  - O sistema lê a caixa de hora em hora, **só para leitura**: não apaga, não move e não marca como lido.
  - Quando o contato responde, a cadência para e a equipe recebe um aviso.
  - Respostas automáticas (férias, ausência) não param a cadência.
  - E-mail que voltou marca o endereço como inválido.
  - "Não tenho interesse" ou "remova" tira o contato da lista na hora.
- **Classificação:** a busca diária (o robô) lê `GET /api/integracao/respostas` e devolve `POST /api/integracao/respostas` com `{ "respostas": [ { "id", "classificacao", "resumo", "resposta_sugerida" } ] }`. A autenticação é a mesma `LEADS_API_TOKEN`.
  - `classificacao` aceita: INTERESSADO, PERGUNTA, AGORA_NAO, NAO_QUER ou OUTRO.
  - Interessado e pergunta geram aviso. A resposta sugerida aparece na tela para revisar e enviar.
  - Agora não volta para a cadência em 60 dias. Não quer sai da lista.
- **Pausar:** o botão "Pausar" (só o superadmin) para o envio na hora. A leitura da caixa continua.

## Rotina comercial (época, follow-up, roteiro e parceiros)

- **Época do ano:** a Lista do dia mostra o tema do mês (ex.: 13º salário em novembro e dezembro) e põe primeiro os segmentos prioritários. Em novembro e dezembro, o modelo de e-mail "13º salário" é o padrão.
- **Cadência de follow-up:** começa sozinha na primeira abordagem, com retornos nos dias 3, 7 e 14.
  - O sistema avisa todo dia os follow-ups do dia.
  - No contato aparecem a mensagem pronta de WhatsApp, o e-mail de retorno e os botões "Liguei" e "Encerrar".
  - A cadência para quando o contato muda para "Diagnóstico enviado", "Virou cliente" ou "Perdido".
- **Quem decide:** o contato guarda nome, cargo e contato direto de quem decide. O WhatsApp do follow-up vai para esse contato.
- **Roteiro de abordagem:** cada contato tem um roteiro por segmento, com a ligação para a secretaria, a abertura, as perguntas, o fechamento e as respostas às objeções.
- **Parceiros (indicação):** cada parceiro tem um link próprio (`acorly.com.br/diagnostico?ref=codigo`). Quem pede o diagnóstico pelo link fica vinculado ao parceiro. As comissões pagas são registradas em "Indicações". A regra padrão (10% por 12 meses) é só uma sugestão, editável por parceiro.

## Campanhas de e-mail por planilha

Em **Diagnósticos e prospecção → Campanhas por planilha**:

1. Envie uma planilha CSV ou Excel (.xlsx). A coluna `email` é obrigatória; as colunas empresa, nome, segmento e whatsapp são opcionais.
2. Escolha o modelo de e-mail.
3. Confira a prévia. Antes de enviar, o sistema tira da lista:
   - e-mails inválidos;
   - repetidos;
   - quem pediu para não receber;
   - quem recebeu e-mail nos últimos 30 dias;
   - quem já está na fila de outra campanha.

O envio funciona assim:

- Os 10 primeiros e-mails saem na hora. O restante sai de hora em hora, das 9h às 18h.
- O limite é de 50 e-mails comerciais por dia, somando os envios avulsos.
- Cada destinatário vira um contato com cadência de follow-up.
- Uma campanha por vez: as outras ficam "Aguardando a vez", na ordem de criação, e a próxima começa sozinha quando a anterior termina ou é cancelada. Pausar a campanha em andamento segura a fila.
- Uma campanha pode ser pausada, retomada ou cancelada.
- Um envio que falha é tentado de novo até 3 vezes.

## Visitas do site

Em **Negócio → Indicadores do negócio → Visitas do site** aparecem:

- pessoas por dia e páginas vistas;
- a origem de cada visita: Instagram, Google, LinkedIn, direto, ou campanhas marcadas com `utm_source` e `utm_campaign`;
- as conversões: pedido de diagnóstico, conta criada, clique no WhatsApp e demonstração aberta.

Como a contagem funciona:

- É anônima e sem cookies. Cada visitante recebe um código que muda todo dia; o IP não é guardado e robôs são ignorados.
- Os eventos do dia viram um resumo diário na rotina noturna, e os resumos são mantidos por 13 meses.
- Para saber qual post ou campanha trouxe a pessoa, use links com etiqueta, por exemplo: `acorly.com.br/?utm_source=instagram&utm_campaign=bio`.

## Financeiro da empresa e DRE

Em **Negócio → Financeiro da empresa**, só para o superadmin.

**Lançamentos**
- Despesas e receitas da HS, com categoria, fornecedor ou colaborador, valor, vencimento, mês de competência, forma de pagamento e comprovante.
- Categorias de despesa:
  - equipe (salários, pró-labore, comissões de operadores);
  - sistemas;
  - marketing;
  - administrativo;
  - serviços de terceiros;
  - comissões de parceiros;
  - taxas;
  - impostos;
  - despesas financeiras;
  - outras.

**Despesas fixas**
- Ao criar o lançamento, marque "Repete todo mês" (salários, servidor, contador).
- O sistema lança cada mês sozinho.
- Reajustes valem para os meses em aberto.

**Contas a pagar**
- A visão geral mostra as contas vencidas, as de hoje e as dos próximos 7 dias.
- Todo dia sai um aviso no sino das contas vencidas ou que vencem no dia.

**DRE mensal**
- É gerencial e calculado por competência.
- Entram sozinhos:
  - mensalidades do Asaas, já com as taxas do Asaas;
  - comissões da cobrança gerenciada;
  - comissões pagas a parceiros.
- O resto vem dos lançamentos.
- Os impostos são estimados pela alíquota da aba Configurações até o DAS do mês ser lançado.
- Exporta PDF e CSV.
- O botão "Fechar mês" guarda o DRE e trava os lançamentos do mês.
- "Reabrir" exige um motivo, que fica registrado na auditoria.

## Piloto Sem Risco (oferta principal do site)

- **Página inicial:** o destaque agora é o Piloto Sem Risco: 30 dias, até 20 devedores escolhidos pelo cliente, 10% só do que entrar.
- **Nova página pública `/mensagens`:** mostra as mensagens que o devedor recebe, com dados de exemplo. Elas vêm dos modelos globais de mensagem; ao editar os modelos no sistema, a página muda junto.
- **Diagnóstico anônimo:** a planilha (Excel ou CSV) é lida no navegador, e só as colunas de valor e vencimento são enviadas. Nome, CPF e telefone não saem do computador do cliente.
- **Comissão:** a tabela padrão continua por tempo de atraso: 10% até 90 dias, 15% de 91 a 180 dias, 20% de 181 a 365 dias e 25% acima. O Piloto Sem Risco cobra 10% só sobre o que for pago durante os 30 dias do piloto. Depois, os pagamentos dos mesmos casos seguem a tabela padrão. Se a tabela de 2 faixas (10%/15%) ficou salva no sistema, ela volta sozinha para a padrão na inicialização.
- **Novo modelo de e-mail comercial "Piloto Sem Risco":** passa a ser o padrão no primeiro contato.

## Diagnóstico, piloto e resultados

**Enviar diagnóstico**
- Onde: dentro do pedido, em Diagnósticos e prospecção → Pedidos e contatos.
- O que vai no e-mail:
  - os números da planilha anônima, ou o valor informado;
  - a estimativa conservadora, digitada pela equipe e deixando claro que não é garantia;
  - a comissão nesse cenário;
  - o convite para o Piloto Sem Risco, com botão para o WhatsApp.
- Depois do envio, o pedido passa para "Diagnóstico enviado" e o follow-up para.

**Contrato "Piloto Sem Risco"**
- Onde: em Contratos de cobrança → Nova proposta.
- O que é preenchido sozinho: até 20 devedores, 30 dias de vigência, comissão de 10% sobre o que for pago dentro dos 30 dias (depois, tabela padrão) e sem mensalidade.
- Avisos: a empresa e o superadmin recebem um aviso 5 dias antes do fim e outro no encerramento, com o resultado do piloto.
- Depois do fim, o piloto não aceita devedores novos. Os acordos em andamento continuam sendo acompanhados.

**Resultados da cobrança gerenciada**
- Onde: em Indicadores do negócio.
- O que mostra:
  - taxa de recuperação real por faixa de atraso;
  - tempo até o 1º pagamento;
  - reclamações e pedidos de "não contatar";
  - funil diagnóstico → piloto → continuidade;
  - a lista de pilotos.
