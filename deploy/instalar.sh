#!/usr/bin/env bash
# =============================================================================
# HS Recuperação de Crédito: instalação automática em VPS Ubuntu 22.04 / 24.04
#
# Uso (como root, num servidor novo, com o domínio já apontando para o IP):
#   curl -fsSL https://raw.githubusercontent.com/hugo21sousa-hub/HS-Recupera-o-de-cr-dito/main/deploy/instalar.sh \
#     | sudo bash -s -- app.seudominio.com.br voce@seudominio.com.br "Seu Nome"
#
# O que faz: instala Node.js 22, Caddy (HTTPS automático), cria o serviço
# "hs" (inicia sozinho), firewall, backup diário e o primeiro superadmin.
# Pode ser executado de novo com segurança (não apaga dados).
# =============================================================================
set -euo pipefail

DOMINIO="${1:-${DOMINIO:-}}"
EMAIL_ADMIN="${2:-${EMAIL_ADMIN:-}}"
NOME_ADMIN="${3:-${NOME_ADMIN:-Administrador HS}}"
REPO_URL="${REPO_URL:-https://github.com/hugo21sousa-hub/HS-Recupera-o-de-cr-dito.git}"
RAMO="${RAMO:-main}"

APP_DIR=/opt/hs
DATA_DIR=/var/lib/hs
BACKUP_DIR=/var/backups/hs
ENV_FILE=/etc/hs/hs.env
USUARIO=hs
PORTA=3000

verde() { printf '\033[1;32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[1;33m%s\033[0m\n' "$*"; }
erro() { printf '\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }
passo() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

# ---------- verificações ----------
[ "$(id -u)" -eq 0 ] || erro "Execute como root (use sudo)."
[ -n "$DOMINIO" ] || erro "Informe o domínio. Ex.: sudo bash instalar.sh app.seudominio.com.br voce@email.com \"Seu Nome\""
[ -n "$EMAIL_ADMIN" ] || erro "Informe o e-mail do primeiro superadmin."
[[ "$DOMINIO" =~ ^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]] || erro "Domínio inválido: $DOMINIO"
[[ "$EMAIL_ADMIN" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$ ]] || erro "E-mail inválido: $EMAIL_ADMIN"
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || amarelo "Aviso: testado para Ubuntu 22.04/24.04; detectado ${PRETTY_NAME:-desconhecido}."

IP_PUBLICO="$(curl -fsS4 --max-time 5 https://api.ipify.org 2>/dev/null || true)"
IP_DOMINIO="$(getent ahostsv4 "$DOMINIO" 2>/dev/null | awk 'NR==1{print $1}' || true)"
if [ -n "$IP_PUBLICO" ] && [ "$IP_PUBLICO" != "$IP_DOMINIO" ]; then
  amarelo "Aviso: $DOMINIO aponta para '${IP_DOMINIO:-nada}', mas este servidor é $IP_PUBLICO."
  amarelo "O HTTPS só será emitido depois que o DNS apontar para este servidor (o Caddy tenta de novo sozinho)."
fi

# ---------- pacotes ----------
passo "Atualizando o sistema e instalando dependências"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git sqlite3 ufw debian-keyring debian-archive-keyring apt-transport-https unattended-upgrades >/dev/null
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

passo "Instalando Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq && apt-get install -y -qq nodejs >/dev/null
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22||(a===22&&b<13)) process.exit(1)' || erro "Node.js 22.13+ é necessário (encontrado $(node -v))."
verde "Node.js $(node -v)"

passo "Instalando Caddy (HTTPS automático)"
if ! command -v caddy >/dev/null; then
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi
verde "$(caddy version | cut -d' ' -f1)"

# ---------- usuário e código ----------
passo "Preparando usuário, pastas e código"
id "$USUARIO" >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$USUARIO"
install -d -m 0750 -o "$USUARIO" -g "$USUARIO" "$DATA_DIR"
install -d -m 0700 -o root -g root "$BACKUP_DIR"
install -d -m 0750 -o root -g "$USUARIO" /etc/hs

if [ -d "$APP_DIR/.git" ]; then
  # o código pertence ao usuário do serviço: o git roda como ele (evita "dubious ownership")
  sudo -u "$USUARIO" -H git -C "$APP_DIR" fetch -q origin "$RAMO" || erro "Não foi possível atualizar o código a partir do GitHub."
  sudo -u "$USUARIO" -H git -C "$APP_DIR" reset -q --hard "origin/$RAMO"
else
  git clone -q --depth 1 --branch "$RAMO" "$REPO_URL" "$APP_DIR" || erro "Não foi possível baixar $REPO_URL. Se o repositório for privado, veja docs/IMPLANTACAO.md (instalação com token)."
fi
chown -R "$USUARIO:$USUARIO" "$APP_DIR"

passo "Instalando dependências e compilando as telas (pode levar alguns minutos)"
sudo -u "$USUARIO" -H env npm_config_cache="$APP_DIR/.npm-cache" bash -c "cd '$APP_DIR' && npm ci --omit=dev --no-audit --no-fund --silent && npm --prefix web ci --no-audit --no-fund --silent && npm --prefix web run build --silent" \
  || erro "Falha ao instalar/compilar. Verifique se o servidor tem pelo menos 1 GB de RAM (ou crie swap)."

# ---------- configuração ----------
passo "Gravando configuração em $ENV_FILE"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
# Configuração do HS Recuperação de Crédito. Após editar: sudo systemctl restart hs
NODE_ENV=production
HOST=127.0.0.1
PORT=$PORTA
TRUST_PROXY=true
DATA_DIR=$DATA_DIR
URL_BASE=https://$DOMINIO
EXIGIR_2FA_HS=true

# --- E-mail (SMTP) ---
#SMTP_HOST=
#SMTP_PORT=587
#SMTP_USER=
#SMTP_PASS=
#SMTP_FROM=HS Recuperação <nao-responda@$DOMINIO>

# --- WhatsApp Business (Cloud API da Meta) --- webhook: https://$DOMINIO/webhooks/whatsapp
#WHATSAPP_TOKEN=
#WHATSAPP_PHONE_NUMBER_ID=
#WHATSAPP_APP_SECRET=
#WHATSAPP_VERIFY_TOKEN=

# --- Asaas (pagamento da assinatura) --- webhook: https://$DOMINIO/webhooks/asaas
#ASAAS_API_KEY=
#ASAAS_AMBIENTE=sandbox
#ASAAS_WEBHOOK_TOKEN=
EOF
else
  sed -i "s#^URL_BASE=.*#URL_BASE=https://$DOMINIO#" "$ENV_FILE"
  amarelo "Configuração existente mantida (só URL_BASE foi atualizada)."
fi
chown root:"$USUARIO" "$ENV_FILE"; chmod 0640 "$ENV_FILE"

# ---------- serviço ----------
passo "Criando o serviço (inicia sozinho e reinicia em caso de falha)"
cat > /etc/systemd/system/hs.service <<EOF
[Unit]
Description=HS Recuperação de Crédito
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USUARIO
Group=$USUARIO
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning src/server/index.js
Restart=always
RestartSec=3
# Endurecimento
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q hs
systemctl restart hs

passo "Configurando HTTPS para $DOMINIO"
cat > /etc/caddy/Caddyfile <<EOF
$DOMINIO {
	encode zstd gzip
	request_body {
		max_size 12MB
	}
	reverse_proxy 127.0.0.1:$PORTA
	log {
		output file /var/log/caddy/hs.log {
			roll_size 20MiB
			roll_keep 5
		}
	}
}
EOF
install -d -o caddy -g caddy /var/log/caddy
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || erro "Caddyfile inválido."
systemctl enable -q caddy
systemctl reload caddy 2>/dev/null || systemctl restart caddy

passo "Firewall (SSH, HTTP e HTTPS)"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
verde "$(ufw status | head -1)"

# ---------- backup ----------
passo "Backup diário (03:15) com 14 dias de histórico em $BACKUP_DIR"
cat > /usr/local/bin/hs-backup <<EOF
#!/usr/bin/env bash
# Backup consistente do banco + arquivos anexados + segredo do servidor
set -euo pipefail
DATA=\$(date +%F-%H%M)
DESTINO=$BACKUP_DIR/hs-\$DATA
mkdir -p "\$DESTINO"
sqlite3 $DATA_DIR/hs.sqlite ".backup '\$DESTINO/hs.sqlite'"
tar -C $DATA_DIR -czf "\$DESTINO/arquivos.tar.gz" arquivos segredo 2>/dev/null || tar -C $DATA_DIR -czf "\$DESTINO/arquivos.tar.gz" segredo
cp $ENV_FILE "\$DESTINO/hs.env"
chmod -R go-rwx "\$DESTINO"
find $BACKUP_DIR -maxdepth 1 -name 'hs-*' -type d -mtime +14 -exec rm -rf {} +
echo "Backup em \$DESTINO"
EOF
chmod 0750 /usr/local/bin/hs-backup
echo "15 3 * * * root /usr/local/bin/hs-backup >> /var/log/hs-backup.log 2>&1" > /etc/cron.d/hs-backup

cat > /usr/local/bin/hs-atualizar <<EOF
#!/usr/bin/env bash
# Atualiza para a versão mais recente do GitHub (faz backup antes)
set -euo pipefail
/usr/local/bin/hs-backup
sudo -u $USUARIO -H git -C $APP_DIR fetch -q origin $RAMO
sudo -u $USUARIO -H git -C $APP_DIR reset -q --hard origin/$RAMO
sudo -u $USUARIO -H env npm_config_cache=$APP_DIR/.npm-cache bash -c "cd $APP_DIR && npm ci --omit=dev --no-audit --no-fund --silent && npm --prefix web ci --no-audit --no-fund --silent && npm --prefix web run build --silent"
systemctl restart hs
sleep 2
curl -fsS http://127.0.0.1:$PORTA/api/saude >/dev/null && echo "Atualizado e no ar." || { echo "O sistema não respondeu. Veja: journalctl -u hs -n 50"; exit 1; }
EOF
chmod 0750 /usr/local/bin/hs-atualizar

cat > /usr/local/bin/hs-superadmin <<EOF
#!/usr/bin/env bash
# Cria um superadmin ou gera novo link de acesso. Uso: sudo hs-superadmin email@dominio "Nome"
set -euo pipefail
cd $APP_DIR
sudo -u $USUARIO env DATA_DIR=$DATA_DIR URL_BASE=https://$DOMINIO PORT=$PORTA node --disable-warning=ExperimentalWarning scripts/criar-superadmin.mjs "\$@"
EOF
chmod 0750 /usr/local/bin/hs-superadmin

# ---------- verificação ----------
passo "Verificando"
for i in $(seq 1 20); do curl -fsS "http://127.0.0.1:$PORTA/api/saude" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://127.0.0.1:$PORTA/api/saude" >/dev/null || erro "O sistema não iniciou. Veja: journalctl -u hs -n 50"
verde "Sistema respondendo."

passo "Primeiro superadmin"
/usr/local/bin/hs-superadmin "$EMAIL_ADMIN" "$NOME_ADMIN"
/usr/local/bin/hs-backup >/dev/null && verde "Primeiro backup feito."

cat <<EOF

$(verde "Instalação concluída!")
  Endereço:        https://$DOMINIO
  Primeiro acesso: abra o link acima, defina a senha e configure a verificação em duas etapas.

  Comandos úteis:
    sudo systemctl status hs          situação do sistema
    sudo journalctl -u hs -f          registros em tempo real
    sudo nano $ENV_FILE         integrações (e-mail, WhatsApp, Asaas); depois: sudo systemctl restart hs
    sudo hs-atualizar                 atualizar para a versão mais recente do GitHub
    sudo hs-backup                    backup imediato (automático todo dia às 03:15)
    sudo hs-superadmin email "Nome"   novo superadmin ou novo link de acesso

  Importante: copie os backups de $BACKUP_DIR para fora do servidor regularmente.
EOF
