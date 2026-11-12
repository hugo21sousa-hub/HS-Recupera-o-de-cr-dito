# HS Recuperação de Crédito

Plataforma SaaS multiempresa para recuperação de crédito, com dois serviços integrados:

- **HS Plataforma**: a empresa cadastra devedores e dívidas, cobra por conta própria, negocia e confirma pagamentos. Paga só a assinatura, sem comissão.
- **HS Cobrança Gerenciada**: a empresa encaminha dívidas autorizadas, e a equipe HS valida, distribui, contata e negocia. A empresa acompanha tudo pelo próprio painel. **O devedor paga direto ao credor**, e só o credor confirma o recebimento.

Sistema completo e independente: servidor Node.js, banco SQLite, frontend React e login próprio. Não depende de Base44 nem de nenhum outro serviço.

## Colocar no ar (servidor)

Um único comando instala tudo: HTTPS, serviço, firewall, backup diário e o primeiro superadmin.

- **Grátis:** Oracle Cloud "Always Free" + endereço DuckDNS. Siga **[docs/INSTALAR_ORACLE.md](docs/INSTALAR_ORACLE.md)**.
- **Grátis (alternativa):** Google Cloud e2-micro + DuckDNS. Siga **[docs/INSTALAR_GOOGLE.md](docs/INSTALAR_GOOGLE.md)**.
- **VPS paga** (Hostinger, AWS Lightsail, Vultr…): siga **[docs/INSTALAR_VPS.md](docs/INSTALAR_VPS.md)**.

## Rodar no seu computador

Requisito: **Node.js 22.13 ou superior** ([nodejs.org](https://nodejs.org)).

1. Instale as dependências e compile as telas (só na primeira vez):

```bash
npm run setup
```

2. Crie o primeiro superadministrador da HS. O comando imprime um link para definir a senha:

```bash
npm run criar-superadmin -- seu-email@empresa.com.br "Seu Nome"
```

3. Inicie o sistema:

```bash
npm start
```

4. Abra o link impresso no passo 2 (algo como `http://localhost:3000/convite/...`), defina a senha e entre.

Empresas clientes se cadastram sozinhas em `http://localhost:3000/cadastro`. Os dados ficam na pasta `data/`: banco `hs.sqlite` e arquivos anexados.

## Demonstração com dados de exemplo

Para conhecer o sistema já preenchido (empresa, devedores, dívidas, casos em vários estágios, acordo, pagamentos):

```bash
DATA_DIR=./data-demo npm run demo
```

```bash
DATA_DIR=./data-demo EXIGIR_2FA_HS=false npm start
```

Entre em `http://localhost:3000` com a senha `Demo2026hs` e um destes usuários: `empresa@demo.hs` (administrador da empresa), `financeiro@demo.hs`, `admin@demo.hs` (superadmin HS), `gestor@demo.hs` ou `operador@demo.hs`. Na demonstração, o 2FA da equipe HS fica desligado (`EXIGIR_2FA_HS=false`). Nunca use isso em produção.

## Primeiros passos dentro do sistema

1. **Superadmin** › Equipe interna: convide gestores e operadores. O sistema gera um link de acesso para você enviar a cada pessoa.
2. **Superadmin** › Planos e assinaturas: os 3 planos (Essencial R$ 49,90, Profissional R$ 79,90, Empresarial R$ 129,90) já vêm criados; ajuste limites e recursos.
3. **Empresa** cadastra-se e escolhe o serviço.
4. **Superadmin** › Empresas: valida e ativa a empresa.
5. Se a empresa pediu cobrança gerenciada, **Superadmin** › Contratos de cobrança: elabora a proposta. A empresa aceita em Contratos.
6. **Empresa**: cadastra ou importa devedores e dívidas, anexa documentos e usa *Encaminhar à HS* (seleção › conferência › limites › autorização expressa).
7. **Gestor HS**: valida os casos e distribui (manual ou automático por capacidade).
8. **Operador**: trabalha a fila, registra contatos (WhatsApp em modo manual), negocia no simulador, formaliza acordos e informa pagamentos.
9. **Empresa**: aprova propostas fora da alçada e confirma ou rejeita os pagamentos informados. O saldo só cai na confirmação.

## Estrutura

| Caminho | Conteúdo |
|---|---|
| `src/core/` | Regras de negócio puras: dinheiro em centavos, CPF/CNPJ, permissões, status dos casos, negociação, pagamentos, validação de carteira, relatórios, salvaguardas de cobrança. |
| `src/app/` | As 97 ações do backend (autorização, gravação e auditoria). Referência em `docs/API.md`. |
| `src/server/` | Servidor HTTP, banco SQLite com transações, contas e sessões, convites e arquivos privados. |
| `src/schema/entities.mjs` | Definição das 31 entidades de negócio. |
| `web/` | Frontend React: painéis da empresa e da Central de Operações HS. |
| `test/` | 41 testes automatizados (segurança, operação, financeiro, relatórios, servidor, 2FA, e-mail, WhatsApp, Asaas e retenção). |
| `docs/` | `IMPLANTACAO.md` (colocar no ar), `SEGURANCA_LGPD.md` e `API.md`. |

## Comandos

| Comando | Para quê |
|---|---|
| `npm run setup` | Instala tudo e compila o frontend |
| `npm start` | Inicia o sistema (porta 3000) |
| `npm test` | Roda os testes automatizados |
| `npm run build` | Recompila o frontend depois de alterar `web/` |
| `npm run dev` + `npm run dev:web` | Modo desenvolvimento (servidor na 3000, telas com recarga automática na 5173) |
| `npm run criar-superadmin -- email "Nome"` | Cria superadmin ou gera novo link de acesso para ele |
| `npm run demo` | Cria uma base de demonstração (use outra `DATA_DIR`) |
| `npm run retencao` | Executa a rotina de retenção LGPD manualmente |
| `npm run docs` | Regenera `docs/API.md` |

## Princípios do sistema

- Toda operação passa pelo backend, que valida perfil, empresa e escopo. Esconder botões não é o mecanismo de segurança.
- Dinheiro em centavos inteiros; percentuais em pontos-base. Cada requisição roda numa transação: ou grava tudo, ou nada.
- "Recuperado" conta só pagamentos confirmados pelo credor. Propostas, acordos e pagamentos informados aparecem separados.
- Verificação em duas etapas (aplicativo autenticador) obrigatória para a equipe HS.
- Integrações reais que ligam por configuração: **e-mail SMTP**, **WhatsApp Business (API oficial da Meta)** e **Asaas** (pagamento da assinatura). Sem configuração, o sistema funciona em modo manual e mostra cada recurso como "indisponível". Veja `docs/IMPLANTACAO.md`.
- Retenção LGPD automática (diária), com prazo configurável por empresa.
