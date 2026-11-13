# Colocar o sistema no ar

O sistema é um único processo Node.js que guarda tudo numa pasta de dados (`DATA_DIR`): o banco SQLite e os arquivos anexados. Para comercializar, ele precisa rodar num servidor com **HTTPS** e **disco persistente**.

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta HTTP |
| `DATA_DIR` | `./data` | Pasta do banco e dos arquivos. **Precisa ser persistente e ter backup.** |
| `URL_BASE` | `http://localhost:PORT` | Endereço público, usado nos links de convite (ex.: `https://app.hsrecupera.com.br`) |
| `NODE_ENV` | — | Use `production` em produção: ativa cookie `Secure` e HSTS |
| `SEGREDO` | gerado em `DATA_DIR/segredo` | Chave que assina os links de arquivos e cifra os segredos do 2FA. Se definir, use 64 caracteres aleatórios e **nunca a troque** depois (os 2FA ativos deixariam de funcionar). |
| `DATABASE_URL` | — | Se definido, usa PostgreSQL (ex.: Supabase) em vez de SQLite |
| `DATABASE_SCHEMA` | `hs` no Supabase | Esquema das tabelas. No Supabase, **nunca** use `public`, porque ele é exposto pela API do projeto |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | — | Anexos e backups diários no Supabase Storage (bucket privado `hs-arquivos`) |
| `SUPERADMIN_EMAIL` / `SUPERADMIN_NOME` | — | Cria o primeiro superadmin ao iniciar e mostra o link de primeiro acesso nos logs |
| `CONTATO_EMAIL` / `CONTATO_WHATSAPP` | — | Contato exibido no rodapé do site de apresentação (ex.: `contato@seudominio.com.br`, `5511999999999`) |
| `BREVO_API_KEY` / `EMAIL_REMETENTE` | — | Envio de e-mail pela API do Brevo (funciona onde SMTP é bloqueado, como no Render grátis) |
| `VERIFICACAO_LOGIN` | `email` se houver envio de e-mail; senão `app` | `email`: código de 6 dígitos por e-mail a cada login, para todos os usuários. `app`: aplicativo autenticador (obrigatório para a equipe HS) |
| `EXIGIR_2FA_HS` | `true` | Verificação em duas etapas obrigatória para superadmin, gestores e operadores |

### Integrações (opcionais: cada uma só liga quando suas variáveis existem)

**E-mail (SMTP)**: convites, "esqueci minha senha" e notificações por e-mail. Serve qualquer provedor SMTP (Amazon SES, Brevo, SendGrid, Zoho, Google Workspace…).

| Variável | Exemplo |
|---|---|
| `SMTP_HOST` | `smtp-relay.brevo.com` |
| `SMTP_PORT` | `587` (ou `465` com SSL) |
| `SMTP_USER` / `SMTP_PASS` | credenciais do provedor |
| `SMTP_FROM` | `Acorly <nao-responda@seudominio.com.br>` |

**WhatsApp Business Platform (Cloud API da Meta)**: envio pela API oficial e recebimento automático das respostas nos casos HS.

| Variável | Onde obter |
|---|---|
| `WHATSAPP_TOKEN` | Token permanente de usuário do sistema (Meta Business › Usuários do sistema) |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp › Configuração da API › ID do número de telefone |
| `WHATSAPP_APP_SECRET` | App › Configurações › Básico › Chave secreta do app (valida a assinatura do webhook) |
| `WHATSAPP_VERIFY_TOKEN` | Texto que você inventa e repete no cadastro do webhook |

No painel da Meta, cadastre o webhook `https://SEU_DOMINIO/webhooks/whatsapp` com o mesmo `WHATSAPP_VERIFY_TOKEN` e assine o campo **messages**. Em seguida, cadastre e aprove os modelos de mensagem na Meta e registre cada um em *Modelos de mensagem*, informando o "nome do modelo aprovado na Meta". As variáveis `{{nome}} {{credor}} {{valor}} {{vencimento}}` viram os parâmetros `{{1}}, {{2}}…`, na ordem em que aparecem no texto.

Regras do WhatsApp que o sistema aplica: fora da janela de 24 h desde a última resposta do devedor, só é possível enviar modelos aprovados. Respostas "PARAR"/"SAIR" bloqueiam novos contatos, e mensagens de números não identificados vão para *WhatsApp sem caso*.

**Pagamento da assinatura (Asaas)**: Pix, boleto ou cartão, com ativação automática do plano.

| Variável | Valor |
|---|---|
| `ASAAS_API_KEY` | Chave de API (Integrações › Chave de API) |
| `ASAAS_AMBIENTE` | `sandbox` para testes ou `producao` |
| `ASAAS_WEBHOOK_TOKEN` | Token que você define no cadastro do webhook |

No Asaas, cadastre o webhook de cobranças apontando para `https://SEU_DOMINIO/webhooks/asaas`, com o mesmo token de autenticação. O Asaas só cobra a **assinatura da plataforma**; os devedores continuam pagando direto às empresas credoras.

> **Instalação automática:** em uma VPS Ubuntu, use `deploy/instalar.sh` seguindo o [passo a passo](INSTALAR_VPS.md). As seções abaixo descrevem a instalação manual.

## Opção 1: VPS (recomendado para começar)

Qualquer servidor Linux com 1 GB de RAM (DigitalOcean, Hostinger, Contabo, AWS Lightsail…).

1. Instale o Node.js 22 e o git, depois copie o projeto para `/opt/hs`.
2. Instale e compile:

```bash
cd /opt/hs && npm run setup
```

3. Crie o superadmin:

```bash
DATA_DIR=/var/lib/hs URL_BASE=https://app.seudominio.com.br npm run criar-superadmin -- voce@seudominio.com.br "Seu Nome"
```

4. Rode como serviço (systemd), com `NODE_ENV=production`, `DATA_DIR=/var/lib/hs` e `URL_BASE` definidos.
5. Coloque um proxy reverso com HTTPS na frente (Caddy é o mais simples: `app.seudominio.com.br { reverse_proxy localhost:3000 }`).

## Opção 2: Docker

O `Dockerfile` está pronto (não foi testado neste ambiente, que não tem Docker). Monte um volume em `/data`:

```bash
docker build -t hs-recuperacao .
```

```bash
docker run -d --name hs -p 3000:3000 -v hs-dados:/data -e URL_BASE=https://app.seudominio.com.br hs-recuperacao
```

```bash
docker exec -it hs node --disable-warning=ExperimentalWarning scripts/criar-superadmin.mjs voce@seudominio.com.br "Seu Nome"
```

Serve em plataformas com volume persistente (Railway, Render com disco, Fly.io com volume). **Não use plataformas sem disco persistente**, porque os dados se perderiam a cada reinício.

## Rotina de retenção (LGPD)

O servidor executa a retenção ao iniciar e depois a cada 24 h. A rotina anonimiza titulares cujas dívidas estão todas quitadas ou canceladas há mais tempo que o prazo da empresa (padrão de 60 meses), apaga os anexos dessas dívidas e limpa sessões e convites expirados. Para rodar manualmente:

```bash
DATA_DIR=/var/lib/hs npm run retencao
```

## Backup

O banco é um arquivo único. Faça cópia diária de `DATA_DIR` inteiro (banco + `arquivos/` + `segredo`). Para copiar o banco com o sistema rodando, use o modo seguro do SQLite:

```bash
sqlite3 /var/lib/hs/hs.sqlite ".backup '/backup/hs-$(date +%F).sqlite'"
```

## Antes de vender

- Revisar com o jurídico os Termos de Uso, a Política de Privacidade (telas `/termos` e `/privacidade`), os contratos e a lista de termos proibidos em `src/core/compliance.js`.
- Configurar as integrações acima: SMTP, WhatsApp Business e Asaas. Comece pelo ambiente de testes (sandbox) de cada provedor.
- Configurar o monitoramento (`/api/saude`) e os backups automáticos.
- Escala: um servidor atende confortavelmente dezenas de empresas e dezenas de milhares de dívidas. Para volumes muito maiores, migrar o armazenamento para PostgreSQL (a camada `src/server/db.js` isola o banco).
