# Operations

## Keeping the collector running

Every hour it is down is a permanent hole. Run it as a systemd user service, not
in a terminal.

`~/.config/systemd/user/fathom-collector.service`:

```ini
[Unit]
Description=Fathom order book collector
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/fathom
Environment=COLLECTOR_LOG_PATH=%h/fathom/logs/collector
ExecStart=/usr/bin/env node --env-file=%h/fathom/.env %h/fathom/dist/workers/collector.js
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=20

[Install]
WantedBy=default.target
```

The gateway has an identical unit pointing at `dist/server/main.js`. Both use the
project root as `WorkingDirectory`, which is where the gateway resolves
`dist/app` from.

Note what is absent: no `StandardOutput=append:`. The collector opens its own log
and rotates it, so systemd is left with the process's own lifecycle lines and
nothing competes for the file.

```bash
systemctl --user daemon-reload
systemctl --user enable --now fathom-collector fathom-gateway
loginctl enable-linger "$USER"     # survives logout and reboot
```

Without `enable-linger` the services stop when you log out. It is the step that
costs most to forget.

## Reading the log

One JSON object per line, one file per day, with a fixed number of days kept.
Every line names the contract it is about, which is the only way to read a file
four collectors are writing to at once.

```bash
tail -f logs/collector.*.log | jq -c '{time, level, instrumentSymbol, message}'

# everything one contract said
jq -c 'select(.instrumentSymbol == "BTCUSDT")' logs/collector.*.log

# only what went wrong, by kind
jq -r 'select(.level == "warning") | .message' logs/collector.*.log | sort | uniq -c | sort -rn
```

A healthy collector says, on each reconnection, that the stream connected and
that the book synchronised with a level count. Roughly two thousand levels is
what to expect: a ladder returns a thousand a side.

## Checking what was recorded

```bash
systemctl --user status fathom-collector

docker compose exec -T timescaledb psql -U fathom -d fathom -c "
SELECT instrument_symbol, count(*), min(captured_at), max(captured_at)
FROM liquidity_frame GROUP BY 1;
SELECT instrument_symbol, gap_reason, count(*),
       sum(gap_ended_at - gap_started_at) AS lost
FROM recording_gap GROUP BY 1, 2 ORDER BY 4 DESC;"
```

The gap ledger is the answer to "is anything missing". It accounts for every
second the recording does not hold, with the reason it was lost. A contract whose
frame count is short and whose gap ledger does not explain the shortfall is a
bug worth reporting; one whose ledger does explain it was simply down.

`order book unavailable` means nothing ever said why — the recorder saw the book
was not there and was never told the cause. Every other reason names something
that happened. Read a ledger dominated by that one as a ledger that is not
explaining itself, not as a diagnosis.

## Choosing what to record

Contracts and the disk ceiling are chosen from the chart, in Settings, and stored
in the database. The supervisor re-reads that choice every fifteen seconds and
closes the difference — switching a contract on starts a collector for it within
an interval, without touching the others or restarting anything.

One process holds every contract. There is no unit per symbol and no environment
variable to edit; `INSTRUMENT_SYMBOL` in `.env` is only the seed a fresh database
needs so that a first run records something before anyone opens the chart.

The supervisor also replaces a collector that stopped producing frames. A runtime
that dies is not the same as one that was switched off, and the difference is
only visible by asking when each last recorded.

## Disk

Past the ceiling chosen in Settings, the oldest day is dropped, a whole partition
at a time — deleting single rows from compressed history costs more disk than it
frees. Nothing else is needed to keep the archive inside its budget.

```bash
docker compose exec -T timescaledb psql -U fathom -d fathom -c "
SELECT hypertable_name,
       pg_size_pretty(hypertable_size(format('%I.%I', hypertable_schema, hypertable_name)::regclass))
FROM timescaledb_information.hypertables;"
```

Compression only acts on chunks older than the policy's window, so a freshly
recorded day always looks several times larger than it will settle at. What a day
costs is set by how wide the recorded band is and how many contracts are on, not
by how busy the market was.

## Showing it to someone else

The chart is born open on the LAN. To send the link to someone outside it, two
pieces have to be in place: a token and a tunnel.

### The token

Without `FATHOM_ACCESS_TOKEN` in `.env`, every route is open. With it, the
gateway answers 401 to any request that does not carry the secret — including the
WebSocket upgrade, which is where live data travels.

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

The shared link carries the token once:

```
https://YOUR-SUBDOMAIN.trycloudflare.com/?token=YOUR_TOKEN
```

On the first visit the gateway trades the token for a thirty-day cookie,
redirects to `/`, and the secret leaves the address bar. Whoever receives the
link has nothing to copy; whoever arrives without one sees a page asking for it.

The cookie exists for a specific reason: a browser will not let a page set a
header on a WebSocket handshake. An `Authorization` header would protect the HTTP
and leave the stream open.

Only `/api/health` is outside the protection, so the tunnel can be probed without
spending the link.

### The tunnel

`serveo`, the option that installs nothing, **does not work for this chart**.
Over HTTP/2 it truncates a large response and does not bridge the WebSocket, so
the map loads empty and live data never connects. A browser negotiates HTTP/2 by
itself, so there is no way to ask it not to.

Use `cloudflared`, which speaks HTTP/1.1 to the gateway and handles WebSocket:

```bash
mkdir -p ~/.local/bin
curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
  -o ~/.local/bin/cloudflared && chmod +x ~/.local/bin/cloudflared

cloudflared tunnel --url http://localhost:8787
```

It prints a `*.trycloudflare.com` URL, with no account and no interstitial. The
address is random and lives as long as the process, which is enough to show
someone the chart.

To keep it up, a user unit pointing at that command, with `Restart=always`. When
the tunnel is up, set `FATHOM_TUNNELLED=true` and restart the gateway: the cookie
then goes out as `Secure`, so it cannot leak over a plaintext connection.

The gateway refuses to start with `FATHOM_TUNNELLED=true` and no
`FATHOM_ACCESS_TOKEN`. Tunnelled and unguarded means the whole recorded history,
and the controls that write to it, are one public URL away from anyone who finds
the address.

### The request ceiling

Each client gets a fixed budget of requests a minute. The risk is not privacy —
the venue's book is public — it is contention: a tab in a loop competing with the
collector for the same database delays writing, and delayed writing becomes a
permanent hole. Past the ceiling the gateway answers 429 and the collector keeps
writing.

### Closing it

```bash
systemctl --user disable --now fathom-tunnel
```

Changing `FATHOM_ACCESS_TOKEN` and restarting the gateway invalidates every
cookie already handed out, at once.

## After a rebuild

The gateway serves the viewer's assets by wildcard path, so rebuilding the
interface is visible without restarting it. Rebuilding the gateway or the
collector needs `systemctl --user restart`.

## The browser-only build

`npm run build:demo` produces a bundle with no backend at all: the page registers
the collector as a Web Worker and records into IndexedDB. It is published on
every release, and it is also the fastest way to see whether a change to the
collector or the chart works without touching a database.

## The database port

Compose publishes on `${POSTGRES_PORT:-5433}`, not 5432, so it does not collide
with a PostgreSQL already installed on the machine. If you change it, change
`DATABASE_URL` too.
