# Operação

## Deixar o coletor rodando

Cada hora desligada é um buraco permanente. Rode como serviço de usuário do
systemd, não num terminal.

`~/.config/systemd/user/fathom-collector.service`:

```ini
[Unit]
Description=Fathom order book collector
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/fathom
ExecStart=/usr/bin/env node --env-file=%h/fathom/.env %h/fathom/dist/workers/collector.js
Restart=always
RestartSec=5
StandardOutput=append:%h/fathom/collector.log
StandardError=append:%h/fathom/collector.log
KillSignal=SIGTERM
TimeoutStopSec=20

[Install]
WantedBy=default.target
```

O gateway tem uma unidade idêntica apontando para `dist/server/main.js`. As duas
usam a raiz do projeto como `WorkingDirectory`, que é de onde o gateway resolve
`dist/app`.

```bash
systemctl --user daemon-reload
systemctl --user enable --now fathom-collector fathom-gateway
loginctl enable-linger "$USER"     # sobrevive a logout e reboot
```

Sem o `enable-linger` os serviços param quando você desloga. É o passo que mais
custa esquecer.

## Verificar

```bash
systemctl --user status fathom-collector
tail -f collector.log

docker compose exec -T timescaledb psql -U fathom -d fathom -c "
SELECT count(*) AS frames, min(captured_at), max(captured_at) FROM liquidity_frame;
SELECT gap_reason, count(*) FROM recording_gap GROUP BY 1;"
```

Um coletor saudável registra, a cada reconexão:

```
INFO  Market data stream connected
INFO  Order book synchronized with 2018 resting levels
```

Cerca de 2000 níveis é o esperado: o snapshot REST devolve 1000 por lado.

## Mostrar para outra pessoa

O gráfico nasce aberto na LAN. Para mandar o link para alguém de fora, duas
peças precisam estar no lugar: um token e um túnel.

### O token

Sem `FATHOM_ACCESS_TOKEN` no `.env`, toda rota fica aberta. Com ele, o gateway
responde 401 a qualquer requisição que não traga o segredo — inclusive ao
upgrade do WebSocket, que é por onde o tempo real passa.

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

O link compartilhado carrega o token uma vez:

```
https://SEU-SUBDOMINIO.trycloudflare.com/?token=SEU_TOKEN
```

Na primeira visita o gateway troca o token por um cookie de 30 dias, redireciona
para `/` e o segredo some da barra de endereço. Quem receber o link não precisa
copiar nada; quem chegar sem ele vê uma página pedindo o link completo.

O cookie existe por um motivo específico: o navegador não deixa mandar cabeçalho
no handshake de WebSocket. Um `Authorization` protegeria o HTTP e deixaria o
stream ao vento.

Só `/api/health` fica fora da proteção, para dar como sondar o túnel sem gastar
o link.

### O túnel

O `serveo`, que é a opção sem instalar nada, **não serve para este gráfico**.
Medido: sobre HTTP/2 ele corta uma resposta de 2,6 MB em 344 kB, e não faz a
ponte do WebSocket, então o mapa carrega vazio e o tempo real nunca conecta. O
navegador negocia HTTP/2 sozinho, então não há como pedir para ele evitar isso.

Use `cloudflared`, que fala HTTP/1.1 com o gateway e trata WebSocket:

```bash
mkdir -p ~/.local/bin
curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
  -o ~/.local/bin/cloudflared && chmod +x ~/.local/bin/cloudflared

cloudflared tunnel --url http://localhost:8787
```

Ele imprime uma URL `*.trycloudflare.com`, sem conta e sem página de aviso. O
endereço é sorteado e vive enquanto o processo viver, o que basta para mostrar
o gráfico a alguém.

Para deixar de pé, uma unidade de usuário:

```ini
[Unit]
Description=Fathom public tunnel
After=network-online.target fathom-gateway.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=%h/.local/bin/cloudflared tunnel --url http://localhost:8787
Restart=always
RestartSec=10
StandardOutput=append:%h/fathom/tunnel.log
StandardError=append:%h/fathom/tunnel.log

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now fathom-tunnel
grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' tunnel.log | head -1
```

Ao subir o túnel, marque `FATHOM_TUNNELLED=true` e reinicie o gateway: o cookie
passa a sair como `Secure`, e aí ele não vaza numa conexão em texto puro.

### O teto de requisições

Cada cliente vale 240 requisições por minuto. O risco aqui não é privacidade —
o livro do Binance é público — e sim contenção: uma aba em loop competindo com
o coletor pela mesma base atrasa a gravação, e atraso de gravação vira buraco
permanente. Passou do teto, o gateway responde 429 e o coletor segue escrevendo.

### Fechar

```bash
systemctl --user disable --now fathom-tunnel
```

Trocar o `FATHOM_ACCESS_TOKEN` e reiniciar o gateway invalida todos os cookies
já entregues de uma vez.

## Depois de reconstruir

O gateway serve os assets do viewer por caminho curinga, então um rebuild da
interface é visto sem reiniciar. Já um rebuild do gateway ou do coletor exige
`systemctl --user restart`.

## Espaço em disco

```bash
docker compose exec -T timescaledb psql -U fathom -d fathom -c "
SELECT hypertable_name,
       pg_size_pretty(before_compression_total_bytes) AS antes,
       pg_size_pretty(after_compression_total_bytes)  AS depois
FROM hypertable_compression_stats('liquidity_frame');"
```

A compressão só age em chunks com mais de dois dias. Antes disso são ~141 MB/dia
medidos; depois, 4,0x menos — um chunk de 16 MB fecha em 3,96 MB. Com os padrões
isso dá ~35 MB/dia em regime, ou ~12,5 GB/ano.

## Trocar de contrato

Mude `INSTRUMENT_SYMBOL` e reinicie o coletor. Os dois contratos convivem na mesma
base e a interface mostra os dois no seletor — mas um coletor grava um contrato de
cada vez. Para gravar vários em paralelo, rode uma unidade por símbolo, cada uma
com seu `INSTRUMENT_SYMBOL`.

## Porta do banco

O compose publica em `${POSTGRES_PORT:-5433}`, não em 5432, para não colidir com
um PostgreSQL já instalado na máquina. Se mudar, ajuste também o `DATABASE_URL`.
