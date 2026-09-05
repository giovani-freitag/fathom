# Installation

The fastest way to run Fathom properly is one Docker command.

```bash
docker run -p 8787:8787 -v fathom:/var/lib/postgresql/data \
  ghcr.io/giovani-freitag/fathom
```

Open **http://localhost:8787**. The first columns appear within seconds.

That single container holds the database, the collector that mirrors the order
book, and the gateway that draws it. There is nothing to configure, nothing to
clone, and no file to write first.

::: warning Always give it a volume
The `-v` above is not optional in spirit. Without it, the recording lives inside
the container and goes when the container does — and **an order book cannot be
recorded again after the fact.**
:::

## Just looking?

If you only want to see what Fathom draws, the
[live demo](https://giovani-freitag.github.io/fathom/) needs no installation at
all. It runs the collector in a Web Worker and records into browser storage.

It is a demo, and it behaves like one: it records only while the tab is open, it
keeps a rolling window rather than a history, it follows one contract at a time,
and browser storage can be cleared out from under it at any moment. Come back
here when you want to keep what it recorded.

## Configuration

The command above runs on the defaults. Every variable is documented in
`.env.example`, but these four are the ones you are likely to change.

| | |
|---|---|
| `INSTRUMENT_SYMBOL` | Which contract to record. Any Binance USD-M perpetual. |
| `PRICE_BUCKET_SIZE` | How tall one row of the heat map is, in quote units. Ten dollars on Bitcoin, a hundredth of that on Litecoin. |
| `RECORDED_PRICE_RANGE_RATIO` | How far either side of the price the recording reaches. This is what decides what a day of it costs on disk. |
| `POSTGRES_PASSWORD` | Defaults to `fathom`. Fine while the port is on loopback, and not otherwise. |

Pass them with `-e`:

```bash
docker run -p 8787:8787 -v fathom:/var/lib/postgresql/data \
  -e INSTRUMENT_SYMBOL=ETHUSDT -e PRICE_BUCKET_SIZE=0.5 \
  ghcr.io/giovani-freitag/fathom
```

::: danger Fathom asks nobody who they are
There is no login, which is the point on your own machine and a problem on a
public one. Both ports are published to `127.0.0.1` only. Put Fathom behind
something that authenticates before you bind it any wider.
:::

## As four containers

Once you care about backups, upgrades or monitoring, you want the database in a
container of its own.

```bash
curl -O https://raw.githubusercontent.com/giovani-freitag/fathom/main/docker-compose.yml
docker compose up -d
```

That brings up TimescaleDB, a migration step that runs once and stops, the
collector, and the gateway. It is a file rather than a one-liner because anyone
choosing this over the single container is going to edit it.

A few commands you will want:

```bash
# The collector keeps its own log, a line per thing that happened to it.
docker compose exec collector tail -f logs/collector.*.log

docker compose logs collector         # only what it could not survive
docker compose down                   # stop, keeping the recording
docker compose down -v                # stop and delete the recording, permanently
```

## From source

If you want to deploy Fathom somewhere of your own, or change it, clone it. You
need Node 22.12 or newer, and Docker for the database alone.

```bash
git clone https://github.com/giovani-freitag/fathom.git
cd fathom
npm install
cp .env.example .env
```

Bring up the database, apply the migrations, and build:

```bash
docker compose up -d timescaledb      # the database by itself
npm run migrate                       # against a database that already exists
npm run build
```

Then start the two halves:

```bash
npm run collector &                   # the half that must not stop
npm run gateway                       # http://localhost:8787
```

While you are working on the interface, `npm run dev` serves the viewer with hot
reload against a gateway that is already running. `npm run dev:demo` serves the
browser-only build.

## Keeping it up

**The chart only ever covers time the collector was running.** There is no
history to load and nothing to wait for. Leave it up, and it fills in behind you.

[Architecture →](/en/architecture) ·
[Data model →](/en/data-model) ·
[Running it as a service →](/en/operations)
