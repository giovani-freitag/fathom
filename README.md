<p align="center">
  <img src="public/brand.svg" alt="Fathom" width="112">
</p>

<h1 align="center">Fathom</h1>

<p align="center">
  <strong>Order book liquidity, recorded second by second.</strong><br>
  Resting depth becomes a heat map you can pan through: bright bands are walls
  of limit orders, bubbles are the trades that ate them. Candles ride on top, so
  you see whether a wall held or broke.
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6">
  ·
  <img alt="License" src="https://img.shields.io/badge/license-MIT-2bd4a8">
  ·
  <img alt="Vite" src="https://img.shields.io/badge/Vite-rolldown-a259ff">
  ·
  <img alt="TimescaleDB" src="https://img.shields.io/badge/TimescaleDB-hypertable-fdb515">
  ·
  <img alt="Coverage" src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fgiovani-freitag%2Ffathom%2Fmain%2F.github%2Fbadges%2Fcoverage.json">
</p>

<p align="center">
  <a href="https://giovani-freitag.github.io/fathom/"><strong>Open the live demo →</strong></a><br>
  <sub>Your browser becomes the collector. No backend, no signup.</sub>
</p>

<p align="center">
  <img src="docs/screenshot.png" alt="Fathom chart" width="100%">
</p>

Candles come from the venue, so the chart opens on history from the first
second. The order book does not — no venue sells yesterday's resting depth, and
nothing reconstructs it. An hour that was not recorded is gone. Fathom exists to
be running before you need the data.

## ✨ Features

- 🌊 **Depth heat map** — every resting price level, once per second, as colour
- 🕯️ **Candles over liquidity** — full history and volume from the venue, with the book drawn over it
- 🫧 **Aggressor bubbles** — trades sized by volume, coloured by which side crossed
- 📊 **Depth ladder** — resting size and traded volume per price, beside the chart
- 🎚️ **Two-cut colour map** — mute the background churn so real walls stand alone
- 🔭 **Bands that hold up zoomed out** — over days, prices fold into rows you can still follow
- 🕳️ **Honest gaps** — stretches that were not recorded are drawn as holes, never smoothed
- ✏️ **Mark it up** — levels, trend lines, zones and retracements, pinned to time and price rather than pixels
- 📏 **Measure a move** — drag a stretch and read it in money and in percent
- 🎯 **Press what you mean** — a mark or a plotted line opens its own settings where you pressed it
- 📱 **Touch first** — one finger pans, two pinch both axes, the axes are scale handles
- ⚡ **Live tail** — a WebSocket appends each new second without refetching the window
- 🎛️ **Recording control** — pick which contracts record and cap the disk, from the chart itself
- 🔌 **Venue-neutral core** — the exchange lives behind a driver; Binance USD-M is the first
- 🌐 **Runs with no backend** — the same collector registers as a Web Worker and records into IndexedDB

## 🚀 Run it

```bash
docker run -p 8787:8787 ghcr.io/giovani-freitag/fathom
```

Open **http://localhost:8787**. The first columns appear within seconds.

One container: the database, the collector that mirrors the book, and the
gateway that draws it. Nothing to configure, nothing to clone, no file to write
first.

The recording lives inside the container, so it goes when the container does.
That is the right default for looking at this and the wrong one for keeping
what it saw — an order book cannot be recorded again after the fact, so give it
somewhere to write the moment you care:

```bash
docker run -p 8787:8787 -v fathom:/var/lib/postgresql/data ghcr.io/giovani-freitag/fathom
```

It takes the same settings as everything below, one `-e` at a time:

```bash
docker run -p 8787:8787 -e INSTRUMENT_SYMBOL=ETHUSDT -e PRICE_BUCKET_SIZE=0.5 \
  ghcr.io/giovani-freitag/fathom
```

### Or as four containers

The database in its own container is what anything that has to be backed up,
upgraded or watched wants. Take the file and run it:

```bash
curl -O https://raw.githubusercontent.com/giovani-freitag/fathom/main/docker-compose.yml
docker compose up -d
```

TimescaleDB, a migration step that runs once and stops, the collector, and the
gateway. It uses the `slim` tag — the same two processes, without the database
the single container carries.

The file rather than a one-liner, because anyone choosing this over the single
container is going to edit it.

**The chart only ever covers time the collector was running.** An order book
cannot be fetched after the fact, so there is no history to load and nothing to
wait for. Leave it up.

```bash
# The collector keeps its own log, a line per thing that happened to it.
docker compose exec collector tail -f logs/collector.*.log

docker compose logs collector         # only what it could not survive
docker compose down                   # stop, keeping the recording
docker compose down -v                # stop and delete it, permanently
```

### What to change

The commands above run on the defaults. A `.env` beside the compose file is
read as usual. `.env.example` documents every
variable; these four decide what you get:

| | |
|---|---|
| `INSTRUMENT_SYMBOL` | Which contract to record. Any Binance USD-M perpetual. |
| `PRICE_BUCKET_SIZE` | How tall one row of the heat map is, in quote units. Ten dollars on Bitcoin; a hundredth of that on Litecoin. |
| `RECORDED_PRICE_RANGE_RATIO` | How far either side of the price the recording reaches. This is what a day of it costs on disk. |
| `POSTGRES_PASSWORD` | Defaults to `fathom`, which is fine while the port is on the loopback and not otherwise. |

Both ports are published to `127.0.0.1` only. Fathom asks nobody who they are —
put it behind something that does before you bind it wider.

### From the source

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

`npm run dev` serves the viewer with hot reload against a gateway already running.

### Without a backend at all

The same collector registers as a Web Worker and records into IndexedDB, which
is what the [demo](https://giovani-freitag.github.io/fathom/) is: no server, no
database, and a recording that lives in the tab.

```bash
npm run dev:demo
```

### The tools it was built with

Two scripts nothing runs for you, kept because every optimisation in this
project was chosen from one of them:

```bash
node --env-file-if-exists=.env scripts/measure-chart.mjs --repeat 4
node --env-file-if-exists=.env scripts/rebuild-pyramid.mjs
```

The first drives the real chart through pan, zoom and price gestures over the
Chrome debugging protocol and reports what each cost. The second rebuilds the
coarse levels of the archive from the finest one, which is what a change to how
they fold needs afterwards.

## 📚 Docs

- [Architecture](docs/architecture.md) — the two registrations, and how a frame reaches the screen
- [Data model](docs/data-model.md) — schema, grids, and what each column means
- [Operations](docs/operations.md) — running it as a service, reading its log, disk, sharing it
- [Writing an indicator](docs/indicator-cookbook.md) — the surface a reading is written against, both ways
- [Decisions](docs/adr/) — why the design is what it is, with the measurements behind it
- [Demo](demo/) — the browser-only build, published to GitHub Pages on every release
