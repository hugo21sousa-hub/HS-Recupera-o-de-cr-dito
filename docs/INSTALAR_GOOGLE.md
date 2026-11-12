# Colocar no ar de graça: Google Cloud (e2-micro) + DuckDNS

Custo: **R$ 0** dentro do nível gratuito do Google (uma máquina e2-micro nos EUA). O endereço grátis vem do DuckDNS (`hsrecupera.duckdns.org`), com HTTPS automático.

Atende bem uma operação inicial (cerca de 10 empresas clientes). Os pontos fracos são que o servidor fica nos EUA (um pouco mais lento que um servidor em São Paulo) e que ele tem 1 GB de memória (o instalador cria memória extra sozinho).

Você vai precisar de uma conta Google (Gmail) e de um cartão para a verificação de faturamento. Tempo estimado: 30 a 40 minutos.

---

## 1. Criar a conta no Google Cloud

1. Acesse **cloud.google.com/free** e clique em **Comece gratuitamente**.
2. Entre com seu Gmail, aceite os termos e cadastre o cartão. O Google costuma dar créditos de boas-vindas para contas novas, e o nível gratuito continua depois que eles acabam.
3. **Crie um alerta de orçamento** (recomendado): menu **☰ › Faturamento › Orçamentos e alertas › Criar orçamento**, com valor de R$ 5. Se algo começar a ser cobrado, você recebe um e-mail.

## 2. Criar o servidor grátis

1. Menu **☰ › Compute Engine › Instâncias de VM**. Na primeira vez, clique em **Ativar** a API e aguarde.
2. Clique em **Criar instância** e configure:
   - **Nome:** `hs`
   - **Região:** **us-central1 (Iowa)**. Só **us-central1, us-east1 e us-west1** entram no gratuito.
   - **Série:** E2 › **Tipo de máquina: e2-micro**
   - **Disco de inicialização:** clique em **Alterar** e escolha:
     - **Sistema operacional:** Ubuntu
     - **Versão:** Ubuntu 24.04 LTS (x86/64)
     - **Tipo:** **Disco permanente padrão**
     - **Tamanho:** **30 GB**, o máximo do gratuito
   - **Firewall:** marque **Permitir tráfego HTTP** e **Permitir tráfego HTTPS**.
3. Clique em **Criar** e aguarde o círculo verde.
4. Anote o **IP externo** da instância.

> Confira no resumo de preço, à direita da tela, se aparece a indicação de nível gratuito. Se mudar a região ou o tipo, deixa de ser grátis.

## 3. Criar o endereço grátis no DuckDNS

1. Acesse **duckdns.org** e entre com a conta Google.
2. Em **sub domain**, digite o nome desejado (por exemplo, `hsrecupera`) e clique em **add domain**.
3. Em **current ip**, cole o IP externo do Google e clique em **update ip**.

## 4. Instalar o sistema (um comando)

1. Na lista de instâncias de VM, clique no botão **SSH** da linha `hs`. Abre um terminal no navegador.
2. Cole o comando abaixo, trocando o endereço, o e-mail e o nome:

```bash
curl -fsSL https://raw.githubusercontent.com/hugo21sousa-hub/HS-Recupera-o-de-cr-dito/main/deploy/instalar.sh | sudo bash -s -- hsrecupera.duckdns.org voce@email.com "Seu Nome"
```

Na máquina e2-micro a instalação leva de 10 a 20 minutos, porque a compilação das telas é lenta com 1 GB. No final aparece o **link de primeiro acesso**: abra-o, crie sua senha e configure a verificação em duas etapas no celular.

O sistema fica no ar em `https://hsrecupera.duckdns.org`.

---

## Cuidados

- **IP do servidor:** o IP externo comum pode mudar se você **parar** e iniciar a instância (reiniciar não muda). Se mudar, atualize no DuckDNS. Para fixar o IP, é possível reservá-lo em **Rede VPC › Endereços IP**, mas confira antes se há cobrança.
- **Tráfego:** o gratuito inclui pouco tráfego de saída por mês. Com cerca de 10 clientes, o custo extra, se houver, tende a ser de centavos. O alerta de orçamento do passo 1 avisa você.
- **Backups:** o backup diário fica no próprio servidor (`/var/backups/hs`). De vez em quando, baixe uma cópia: no terminal SSH do navegador, use o menu **⚙ › Baixar arquivo**.

## Comandos do dia a dia (no terminal SSH)

| Para quê | Comando |
|---|---|
| Ver se está no ar | `sudo systemctl status hs` |
| Ver os registros | `sudo journalctl -u hs -f` |
| Atualizar para a versão mais nova | `sudo hs-atualizar` |
| Backup agora | `sudo hs-backup` |
| Novo superadmin ou novo link de acesso | `sudo hs-superadmin email@dominio "Nome"` |
