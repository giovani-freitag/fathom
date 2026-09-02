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
SELECT instrument_symbol, count(*), min(started_at), max(ended_at)
FROM whole_book.liquidity_block WHERE detail_level = 0 GROUP BY 1;
SELECT instrument_symbol, gap_reason, count(*),
       sum(gap_ended_at - gap_started_at) AS lost
FROM recording_gap GROUP BY 1, 2 ORDER BY 4 DESC;"
```

The gap ledger is the answer to "is anything missing". It accounts for every
second the recording does not hold, with the reason it was lost. A contract whose
frame count is short and whose gap ledger does not explain the shortfall is a
bug worth reporting; one whose ledger does explain it was simply down.

Two of the reasons explain nothing on purpose, because the recorder can only
report what it sees. `waiting for the first order book` is a run opening with the
mirror still being built — a start, not a fault, and not worth counting as one.
`order book unavailable` is the book gone mid-run with nothing having said why.
Every other reason names something that happened, and one of those replaces
either of these the moment it arrives. A ledger dominated by `order book
unavailable` is a ledger that is not explaining itself, not a diagnosis.

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

The gateway asks nobody who they are. Anything that can reach the port gets the
whole recording and the controls that write to it, so what decides who sees it
is what sits in front of it — a reverse proxy that authenticates, a VPN, an SSH
tunnel to one person. There is nothing to configure here because there is
nothing here to configure.

By default both ports are published on the loopback and nothing outside the
machine can reach either.

### The request ceiling

Each client gets a fixed budget of requests a minute. The risk is not privacy —
the venue's book is public — it is contention: a tab in a loop competing with the
collector for the same database delays writing, and delayed writing becomes a
permanent hole. Past the ceiling the gateway answers 429 and the collector keeps
writing.

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
