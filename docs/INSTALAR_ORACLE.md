# Colocar no ar de graça: Oracle Cloud "Always Free" + DuckDNS

Custo: **R$ 0**. A Oracle oferece servidores grátis **para sempre** (não é período de teste), e o DuckDNS dá um endereço grátis do tipo `hsrecupera.duckdns.org`, com HTTPS emitido automaticamente pelo instalador.

Você vai precisar de:
- um cartão de crédito (ou débito com função crédito), só para a verificação de identidade da Oracle. O plano grátis não gera cobrança;
- cerca de 1 hora.

> Quando tiver clientes e quiser mais tranquilidade (suporte, sem risco de recuperação por inatividade), é possível migrar para uma VPS paga com o mesmo instalador. Veja [INSTALAR_VPS.md](INSTALAR_VPS.md).

---

## 1. Criar a conta na Oracle Cloud

1. Acesse **oracle.com/br/cloud/free** e clique em **Comece gratuitamente** (Start for free).
2. Preencha os dados e confirme o e-mail.
3. **Região inicial (Home Region):** escolha **Brazil East (Sao Paulo)**. **Atenção: não dá para trocar depois.**
4. Informe o cartão para verificação. Pode aparecer uma cobrança temporária de valor simbólico, que é estornada.
5. Aguarde o e-mail de "conta pronta". Pode levar alguns minutos.

## 2. Criar o servidor grátis

No painel da Oracle (console):

1. Abra o menu **☰ › Compute (Computação) › Instances (Instâncias) › Create instance (Criar instância)**.
2. Em **Name**, digite `hs`.
3. Em **Image and shape (Imagem e forma)**:
   - **Image:** clique em *Change image* › **Ubuntu** › **Canonical Ubuntu 24.04**.
   - **Shape:** clique em *Change shape* › **Ampere** › **VM.Standard.A1.Flex**, com **2 OCPUs e 12 GB de memória**. Está dentro do grátis, que vai até 4 OCPUs e 24 GB no total.
   - Se aparecer **"Out of capacity"** (falta de vaga, comum em São Paulo), há duas saídas:
     - tentar de novo mais tarde ou em outro "Availability Domain";
     - escolher **AMD › VM.Standard.E2.1.Micro**, também grátis. Ela tem só 1 GB, mas o instalador cria memória extra (swap) sozinho.
4. Em **Networking (Rede)**, deixe criar uma nova rede (VCN) e mantenha marcado **Assign a public IPv4 address**.
5. Em **Add SSH keys**, escolha **Generate a key pair for me** e clique em **Save private key**. **Guarde esse arquivo (`ssh-key-….key`)**: sem ele você não acessa o servidor.
6. Clique em **Create** e aguarde o status ficar **Running** (verde).
7. Anote o **Public IP address** que aparece na página da instância.

## 3. Liberar as portas 80 e 443 na rede da Oracle

Por padrão, a Oracle só libera o SSH (porta 22).

1. Na página da instância, em **Primary VNIC**, clique no link da **Subnet**.
2. Clique em **Default Security List for…** (em algumas versões do painel, fica na aba **Security**).
3. Clique em **Add Ingress Rules (Adicionar regras de entrada)** e crie duas regras:

| Source CIDR | IP Protocol | Destination Port Range |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

4. Salve.

(O firewall interno do Ubuntu da Oracle é ajustado automaticamente pelo instalador.)

## 4. Criar o endereço grátis no DuckDNS

1. Acesse **duckdns.org** e entre com sua conta Google ou GitHub.
2. Em **sub domain**, digite o nome desejado (por exemplo, `hsrecupera`) e clique em **add domain**.
3. No campo **current ip**, cole o IP público da Oracle e clique em **update ip**.

Seu endereço será `https://hsrecupera.duckdns.org`.

## 5. Entrar no servidor

**Windows (PowerShell)** ou **Mac/Linux (Terminal)**: troque o caminho da chave e o IP.

```bash
ssh -i "C:\Users\SEU_USUARIO\Downloads\ssh-key-2026-11-12.key" ubuntu@IP_DA_ORACLE
```

No Mac ou Linux, se reclamar das permissões da chave, rode antes:

```bash
chmod 600 ~/Downloads/ssh-key-*.key
```

O usuário é sempre **ubuntu**. Na primeira conexão, responda `yes`.

## 6. Instalar o sistema (um comando)

Troque o endereço, o e-mail e o nome:

```bash
curl -fsSL https://raw.githubusercontent.com/hugo21sousa-hub/HS-Recupera-o-de-cr-dito/main/deploy/instalar.sh | sudo bash -s -- hsrecupera.duckdns.org voce@email.com "Seu Nome"
```

Leva entre 5 e 10 minutos. No final aparece o **link de primeiro acesso**: abra-o no navegador, crie sua senha e configure a verificação em duas etapas no celular (Google Authenticator, Microsoft Authenticator ou Authy).

Pronto: o sistema está no ar em `https://hsrecupera.duckdns.org`.

---

## Cuidados com o plano grátis

- **Inatividade:** a Oracle pode recuperar servidores grátis que fiquem praticamente sem uso por vários dias seguidos. Com clientes usando o sistema isso dificilmente acontece. Para eliminar o risco, é possível converter a conta para *Pay As You Go*: os recursos "Always Free" continuam grátis, mas fique atento para não criar recursos pagos.
- **Backups:** o backup diário fica no próprio servidor (`/var/backups/hs`). Baixe uma cópia de vez em quando:

```bash
scp -i "CAMINHO_DA_CHAVE" -r ubuntu@IP_DA_ORACLE:/var/backups/hs ./backups-hs
```

- **IP do servidor:** se você parar e iniciar a instância, o IP pode mudar. Nesse caso, atualize o IP no DuckDNS (passo 4). Reiniciar normalmente não muda o IP.

## Comandos do dia a dia (no servidor)

| Para quê | Comando |
|---|---|
| Ver se está no ar | `sudo systemctl status hs` |
| Ver os registros | `sudo journalctl -u hs -f` |
| Atualizar para a versão mais nova | `sudo hs-atualizar` |
| Backup agora | `sudo hs-backup` |
| Novo superadmin ou novo link de acesso | `sudo hs-superadmin email@dominio "Nome"` |
| Ligar e-mail, WhatsApp ou Asaas | `sudo nano /etc/hs/hs.env` e depois `sudo systemctl restart hs` |
