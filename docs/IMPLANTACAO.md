# Colocar o sistema no ar

O sistema é um único processo Node.js que guarda tudo numa pasta de dados (`DATA_DIR`): o banco SQLite e os arquivos anexados. Para comercializar, ele precisa rodar num servidor com **HTTPS** e **disco persistente**.

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta HTTP |
| `DATA_DIR` | `./data` | Pasta do banco e dos arquivos. **Precisa ser persistente e ter backup.** |
| `URL_BASE` | `http://localhost:PORT` | Endereço público, usado nos links de convite (ex.: `https://app.hsrecupera.com.br`) |
| `NODE_ENV` | — | Use `production` em produção: ativa cookie `Secure` e HSTS |
| `SEGREDO` | gerado em `DATA_DIR/segredo` | Chave que assina os links de arquivos. Se definir, use 64 caracteres aleatórios. |

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

## Backup

O banco é um arquivo único. Faça cópia diária de `DATA_DIR` inteiro (banco + `arquivos/` + `segredo`). Para copiar o banco com o sistema rodando, use o modo seguro do SQLite:

```bash
sqlite3 /var/lib/hs/hs.sqlite ".backup '/backup/hs-$(date +%F).sqlite'"
```

## Antes de vender

- Revisar com o jurídico os Termos de Uso, a Política de Privacidade (telas `/termos` e `/privacidade`), os contratos e a lista de termos proibidos em `src/core/compliance.js`.
- Contratar um serviço de e-mail transacional, para que convites e notificações saiam por e-mail em vez de link copiado.
- Configurar o monitoramento (`/api/saude`) e os backups automáticos.
- Escala: um servidor atende confortavelmente dezenas de empresas e dezenas de milhares de dívidas. Para volumes muito maiores, migrar o armazenamento para PostgreSQL (a camada `src/server/db.js` isola o banco).
