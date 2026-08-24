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
WorkingDirectory=%h/Projects/Temp/Fathom/fathom
ExecStart=/usr/bin/env node --env-file=%h/Projects/Temp/Fathom/fathom/.env %h/Projects/Temp/Fathom/fathom/apps/collector/dist/main.js
Restart=always
RestartSec=5
StandardOutput=append:%h/Projects/Temp/Fathom/fathom/collector.log
StandardError=append:%h/Projects/Temp/Fathom/fathom/collector.log
KillSignal=SIGTERM
TimeoutStopSec=20

[Install]
WantedBy=default.target
```

O gateway tem uma unidade equivalente, com `WorkingDirectory` em `apps/gateway`
para que o caminho relativo do build do viewer resolva.

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

A compressão só age em chunks com mais de dois dias. Antes disso a estimativa é
~150 MB/dia; depois, mais de uma ordem de grandeza menos.

## Trocar de contrato

Mude `INSTRUMENT_SYMBOL` e reinicie o coletor. Os dois contratos convivem na mesma
base e a interface mostra os dois no seletor — mas um coletor grava um contrato de
cada vez. Para gravar vários em paralelo, rode uma unidade por símbolo, cada uma
com seu `INSTRUMENT_SYMBOL`.

## Porta do banco

O compose publica em `${POSTGRES_PORT:-5433}`, não em 5432, para não colidir com
um PostgreSQL já instalado na máquina. Se mudar, ajuste também o `DATABASE_URL`.
