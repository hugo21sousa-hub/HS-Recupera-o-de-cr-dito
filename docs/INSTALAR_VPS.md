# Colocar no ar numa VPS: passo a passo

Tempo estimado: cerca de 30 minutos, a maior parte esperando o DNS propagar.

## 1. Contratar a VPS

Em qualquer provedor (Hostinger VPS, AWS Lightsail, Vultr, Magalu Cloud…), escolha:

- **Sistema:** Ubuntu 24.04 (ou 22.04)
- **Local:** São Paulo
- **Tamanho:** 2 GB de RAM (1 GB funciona, mas a compilação das telas fica mais lenta)
- **Acesso:** anote o **IP** e a **senha de root** (ou cadastre sua chave SSH)

## 2. Apontar o domínio

No painel do seu domínio (Registro.br, por exemplo), crie um registro:

| Tipo | Nome | Valor |
|---|---|---|
| A | `app` | IP da VPS |

Assim `app.seudominio.com.br` passa a apontar para o servidor. A propagação leva de minutos a algumas horas. Para conferir, rode o comando abaixo no seu computador e veja se aparece o IP da VPS:

```bash
nslookup app.seudominio.com.br
```

## 3. Entrar no servidor

No Windows, use o PowerShell; no Mac ou Linux, o Terminal:

```bash
ssh root@IP_DA_VPS
```

Muitos provedores também oferecem um "terminal no navegador" no painel.

## 4. Instalar (um comando)

Troque o domínio, o e-mail e o nome:

```bash
curl -fsSL https://raw.githubusercontent.com/hugo21sousa-hub/HS-Recupera-o-de-cr-dito/main/deploy/instalar.sh | sudo bash -s -- app.seudominio.com.br voce@seudominio.com.br "Seu Nome"
```

O instalador faz tudo sozinho:

- instala o Node.js 22 e o Caddy, que emite e renova o certificado HTTPS gratuito;
- baixa o sistema do GitHub e compila as telas;
- cria o serviço `hs`, que inicia junto com o servidor e reinicia se cair;
- ativa o firewall, deixando abertas só as portas de SSH, HTTP e HTTPS;
- agenda o backup diário às 03:15, guardando 14 dias de histórico;
- ativa as atualizações automáticas de segurança do Ubuntu;
- cria o primeiro superadmin e mostra o **link de primeiro acesso**.

Ao final, abra o link exibido, defina a senha e configure a verificação em duas etapas no celular.

> Se o domínio ainda não estiver apontando para o servidor, o sistema instala normalmente e o HTTPS é emitido sozinho assim que o DNS propagar.

## 5. Ligar as integrações (quando tiver as contas)

```bash
sudo nano /etc/hs/hs.env
```

Tire o `#` das linhas de e-mail, WhatsApp ou Asaas e preencha os valores (explicação de cada um em `docs/IMPLANTACAO.md`). Salve com Ctrl+O, Enter e Ctrl+X, e reinicie:

```bash
sudo systemctl restart hs
```

## Comandos do dia a dia

| Para quê | Comando |
|---|---|
| Ver se está no ar | `sudo systemctl status hs` |
| Ver os registros | `sudo journalctl -u hs -f` |
| Atualizar para a versão mais nova do GitHub | `sudo hs-atualizar` |
| Fazer backup agora | `sudo hs-backup` |
| Novo superadmin ou novo link de acesso | `sudo hs-superadmin email@dominio "Nome"` |

## Backups fora do servidor

Os backups ficam em `/var/backups/hs` **no próprio servidor**. Se o servidor for perdido, eles vão junto. Ative também o backup/snapshot automático do provedor (a maioria oferece) e, de tempos em tempos, baixe uma cópia:

```bash
scp -r root@IP_DA_VPS:/var/backups/hs ./backups-hs
```

## Restaurar um backup

```bash
sudo systemctl stop hs
```

```bash
sudo cp /var/backups/hs/hs-AAAA-MM-DD-HHMM/hs.sqlite /var/lib/hs/hs.sqlite
```

```bash
sudo tar -C /var/lib/hs -xzf /var/backups/hs/hs-AAAA-MM-DD-HHMM/arquivos.tar.gz
```

```bash
sudo rm -f /var/lib/hs/hs.sqlite-wal /var/lib/hs/hs.sqlite-shm && sudo chown -R hs:hs /var/lib/hs && sudo systemctl start hs
```

## Repositório privado

O instalador baixa o código do GitHub público. Se você tornar o repositório privado, crie um token de leitura no GitHub (Settings › Developer settings › Fine-grained tokens, com acesso de leitura ao repositório) e instale assim:

```bash
git clone https://SEU_TOKEN@github.com/hugo21sousa-hub/HS-Recupera-o-de-cr-dito.git /tmp/hs
```

```bash
sudo REPO_URL=https://SEU_TOKEN@github.com/hugo21sousa-hub/HS-Recupera-o-de-cr-dito.git bash /tmp/hs/deploy/instalar.sh app.seudominio.com.br voce@seudominio.com.br "Seu Nome"
```
