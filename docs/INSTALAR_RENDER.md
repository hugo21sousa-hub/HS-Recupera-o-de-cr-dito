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
   - **URL:** `https://hs-recuperacao.onrender.com/api/saude` (com o seu endereço)
   - **Execução:** a cada **10 minutos**
3. Salve.

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
2. Cadastre o remetente: menu **Senders, Domains & Dedicated IPs › Senders › Add a sender**, com nome `HS Recuperação de Crédito` e o e-mail da HS (ex.: `hsrecupera@gmail.com`). Confirme pelo e-mail que o Brevo enviar.
3. Gere a chave: menu **SMTP & API › API Keys › Generate a new API key** (nome `render`). Copie a chave, que começa com `xkeysib-`.
4. No Render, em **hs-recuperacao › Environment**, adicione:

| Variável | Valor |
|---|---|
| `BREVO_API_KEY` | a chave `xkeysib-…` |
| `EMAIL_REMETENTE` | `HS Recuperação de Crédito <hsrecupera@gmail.com>` (o mesmo e-mail confirmado no passo 2) |

5. Salve (**Save, rebuild, and deploy**).

Para voltar a usar o aplicativo autenticador, defina `VERIFICACAO_LOGIN=app`. Com remetente `@gmail.com`, alguns e-mails podem cair no spam; com um domínio próprio verificado no Brevo, a entrega melhora.

## Receber as assinaturas (Asaas: Pix, boleto e cartão)

As empresas clientes contratam ou trocam de plano no próprio sistema (**Assinatura › Assinar**). O sistema cria a cobrança mensal no Asaas, e a empresa paga por **Pix, boleto ou cartão de crédito** na fatura do Asaas. Quando o pagamento é confirmado, o plano é ativado sozinho. Se uma mensalidade atrasar, a assinatura fica como inadimplente.

Planos padrão:

| Plano | Mensalidade | Devedores | Usuários |
|---|---|---|---|
| HS Essencial | R$ 49,90 | até 100 | 2 |
| HS Profissional | R$ 89,90 | até 500 | 5 |
| HS Empresarial | R$ 159,90 | até 1.000 | 15 |

Os valores podem ser ajustados a qualquer momento em **Superadmin › Planos e assinaturas**.

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

## Contato no site

O endereço principal mostra o site de apresentação da HS, com os planos atualizados automaticamente. Para exibir o seu e-mail e WhatsApp no rodapé, adicione no Render (**Environment**) as variáveis `CONTATO_EMAIL` e `CONTATO_WHATSAPP` (ex.: `5511999999999`).

## Limites do plano grátis

| Serviço | Limite | Para 10 clientes |
|---|---|---|
| Supabase | 500 MB de banco e 1 GB de arquivos | Sobra por bastante tempo |
| Render | 512 MB de memória e horas mensais limitadas | Suficiente com um único serviço |

Quando o negócio crescer, basta trocar para um plano pago do Render ou do Supabase. Não precisa mudar nada no sistema.

## Novo link de acesso para o superadmin

Se perder o link antes de criar a senha, reinicie o serviço no Render (**Manual Deploy › Restart service**): um novo link aparece nos logs. Para outras pessoas, use **Usuários › Link de acesso** dentro do próprio sistema.
