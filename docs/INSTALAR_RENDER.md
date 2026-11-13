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
2. Cadastre o remetente: menu **Senders, Domains & Dedicated IPs › Senders › Add a sender**, com nome `Acorly` e o e-mail da HS (ex.: `hsrecupera@gmail.com`). Confirme pelo e-mail que o Brevo enviar.
3. Gere a chave: menu **SMTP & API › API Keys › Generate a new API key** (nome `render`). Copie a chave, que começa com `xkeysib-`.
4. No Render, em **hs-recuperacao › Environment**, adicione:

| Variável | Valor |
|---|---|
| `BREVO_API_KEY` | a chave `xkeysib-…` |
| `EMAIL_REMETENTE` | `Acorly <hsrecupera@gmail.com>` (o mesmo e-mail confirmado no passo 2) |

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

## Contato no site

O endereço principal mostra o site de apresentação da HS, com os planos atualizados automaticamente. Para exibir o seu e-mail e WhatsApp no rodapé, adicione no Render (**Environment**) as variáveis `CONTATO_EMAIL` e `CONTATO_WHATSAPP` (ex.: `5511999999999`).

## Domínio próprio (ex.: acorly.com.br)

**1. No Render**
1. Abra **hs-recuperacao › Settings › Custom Domains › Add Custom Domain**.
2. Adicione o domínio principal (`acorly.com.br`) e também o `www.acorly.com.br`.
3. O Render mostra os registros de DNS que você precisa criar. Normalmente são um registro **A** para o domínio principal e um **CNAME** para o `www`.

**2. Onde você comprou o domínio** (Registro.br, Hostinger, GoDaddy...)
1. Abra a zona de DNS (**DNS › Editar zona**) e crie exatamente os registros que o Render mostrou.
2. Aguarde de alguns minutos a algumas horas. O Render confirma o domínio e emite o certificado HTTPS sozinho.

**3. No Render (Environment)**
1. Adicione a variável `URL_BASE` = `https://acorly.com.br`. É ela que monta os links dos e-mails, dos convites e da logo.
2. Clique em **Save, rebuild, and deploy**.

**4. Atualize os endereços nos serviços externos**
- **Asaas:** no webhook, troque a URL para `https://acorly.com.br/webhooks/asaas`.
- **cron-job.org:** troque a URL para `https://acorly.com.br/api/saude`.

**5. E-mails com o domínio (Brevo)**
1. No Brevo, abra **Senders, Domains & Dedicated IPs › Domains › Add a domain** e informe `acorly.com.br`.
2. O Brevo mostra registros de DNS (código Brevo, **DKIM** e **DMARC**). Crie todos na zona de DNS do domínio.
3. Clique em **Verify** (Verificar) no Brevo.
4. Cadastre o remetente `nao-responda@acorly.com.br`.
5. No Render, troque `EMAIL_REMETENTE` para `Acorly <nao-responda@acorly.com.br>`.
6. Cadastre também o remetente `cobranca@acorly.com.br` no Brevo e adicione no Render a variável `EMAIL_COBRANCA_REMETENTE` = `cobranca@acorly.com.br`. Ela libera o **envio de e-mails aos devedores** pela Central de mensagens:
   - o nome que aparece é o do credor, por exemplo "Loja X via Acorly", ou "HS Recuperação de Crédito" na cobrança gerenciada;
   - as respostas do devedor vão para o e-mail de quem enviou;
   - cada e-mail traz um link para o devedor deixar de receber e-mails.

Com o domínio verificado, os e-mails param de cair no spam.

O endereço `hs-recuperacao.onrender.com` continua funcionando.

## Limites do plano grátis

| Serviço | Limite | Para 10 clientes |
|---|---|---|
| Supabase | 500 MB de banco e 1 GB de arquivos | Sobra por bastante tempo |
| Render | 512 MB de memória e horas mensais limitadas | Suficiente com um único serviço |

Quando o negócio crescer, basta trocar para um plano pago do Render ou do Supabase. Não precisa mudar nada no sistema.

## Novo link de acesso para o superadmin

Se perder o link antes de criar a senha, reinicie o serviço no Render (**Manual Deploy › Restart service**): um novo link aparece nos logs. Para outras pessoas, use **Usuários › Link de acesso** dentro do próprio sistema.
