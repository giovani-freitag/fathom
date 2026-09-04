# Run it

```bash
docker run -p 8787:8787 ghcr.io/giovani-freitag/fathom
```

Open **http://localhost:8787**. The first columns appear within seconds.

One container: the database, the collector that mirrors the book, and the
gateway that draws it. Nothing to configure, nothing to clone, no file to write
first.

::: warning Give it somewhere to write before you care
The recording lives inside the container, so it goes when the container does.
That is the right default for looking at this and the wrong one for keeping what
it saw — **an order book cannot be recorded again after the fact.**

```bash
docker run -p 8787:8787 -v fathom:/var/lib/postgresql/data ghcr.io/giovani-freitag/fathom
```
:::

## What to change

The command above runs on the defaults. `.env.example` documents every variable;
these four decide what you get.

| | |
|---|---|
| `INSTRUMENT_SYMBOL` | Which contract to record. Any Binance USD-M perpetual. |
| `PRICE_BUCKET_SIZE` | How tall one row of the heat map is, in quote units. Ten dollars on Bitcoin; a hundredth of that on Litecoin. |
| `RECORDED_PRICE_RANGE_RATIO` | How far either side of the price the recording reaches. This is what a day of it costs on disk. |
| `POSTGRES_PASSWORD` | Defaults to `fathom`, which is fine while the port is on the loopback and not otherwise. |

One `-e` at a time:

```bash
docker run -p 8787:8787 -e INSTRUMENT_SYMBOL=ETHUSDT -e PRICE_BUCKET_SIZE=0.5 \
  ghcr.io/giovani-freitag/fathom
```

Both ports are published to `127.0.0.1` only. **Fathom asks nobody who they
are** — put it behind something that does before you bind it wider.

## As four containers

The database in its own container is what anything that has to be backed up,
upgraded or watched wants.

```bash
curl -O https://raw.githubusercontent.com/giovani-freitag/fathom/main/docker-compose.yml
docker compose up -d
```

TimescaleDB, a migration step that runs once and stops, the collector, and the
gateway. The file rather than a one-liner, because anyone choosing this over the
single container is going to edit it.

```bash
# The collector keeps its own log, a line per thing that happened to it.
docker compose exec collector tail -f logs/collector.*.log

docker compose logs collector         # only what it could not survive
docker compose down                   # stop, keeping the recording
docker compose down -v                # stop and delete it, permanently
```

## From the source

Node 22.12 or newer, and Docker for the database alone.

```bash
git clone https://github.com/giovani-freitag/fathom.git
cd fathom
npm install
cp .env.example .env

docker compose up -d timescaledb      # the database by itself
npm run migrate                       # only against a database that already exists
npm run build

npm run collector &                   # the half that must not stop
npm run gateway                       # http://localhost:8787
```

`npm run dev` serves the viewer with hot reload against a gateway already
running.

## Without a backend at all

The same collector registers as a Web Worker and records into IndexedDB, which
is what the [demo](https://giovani-freitag.github.io/fathom/) is.

```bash
npm run dev:demo
```

## Keeping it up

**The chart only ever covers time the collector was running.** There is no
history to load and nothing to wait for. Leave it up.

[How it is put together →](/en/architecture) · [What it writes →](/en/data-model) ·
[Running it as a service →](/en/operations)
