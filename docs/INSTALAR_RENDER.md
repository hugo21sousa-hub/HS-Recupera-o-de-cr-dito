# Colocar no ar de graça: Render + Supabase

Custo: **R$ 0**, em geral sem precisar de cartão. Tudo fica na nuvem:

- **Supabase:** guarda o banco de dados (PostgreSQL, em São Paulo), os anexos e o backup diário.
- **Render:** roda o sistema e dá o endereço `https://….onrender.com`, com HTTPS.

Para uma operação inicial (cerca de 10 clientes) sobra capacidade. Tempo estimado: 30 minutos.

---

## 1. Criar o banco no Supabase

1. Acesse **supabase.com**, clique em **Start your project** e entre com sua conta do **GitHub**.
2. Clique em **New project** e preencha:
   - **Name:** `hs-recuperacao`
   - **Database Password:** clique em **Generate a password** e **guarde essa senha**
   - **Region:** **South America (São Paulo)**
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

## Limites do plano grátis

| Serviço | Limite | Para 10 clientes |
|---|---|---|
| Supabase | 500 MB de banco e 1 GB de arquivos | Sobra por bastante tempo |
| Render | 512 MB de memória e horas mensais limitadas | Suficiente com um único serviço |

Quando o negócio crescer, basta trocar para um plano pago do Render ou do Supabase. Não precisa mudar nada no sistema.

## Novo link de acesso para o superadmin

Se perder o link antes de criar a senha, reinicie o serviço no Render (**Manual Deploy › Restart service**): um novo link aparece nos logs. Para outras pessoas, use **Usuários › Link de acesso** dentro do próprio sistema.
