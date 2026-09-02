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

Two ways in. The first asks for Docker and nothing else; the second is for
working on the source.

Either way, the recording starts empty. **The chart only ever covers time the
collector was running** — an order book cannot be fetched after the fact, so
there is no history to load and nothing to wait for. Leave it up.

### With Docker

```bash
git clone https://github.com/giovani-freitag/fathom.git
cd fathom
cp .env.example .env                       # then set POSTGRES_PASSWORD

docker compose --profile full up -d        # database, collector, gateway
```

Open **http://localhost:8787**. The first columns appear within seconds of the
collector reaching the exchange.

The database applies the migrations itself the first time its volume is created,
so there is no separate step. What each service is doing:

```bash
docker compose --profile full ps
docker compose --profile full logs -f collector
```

To stop, keeping everything recorded so far:

```bash
docker compose --profile full down
```

`docker compose down -v` also deletes the volume, and with it the recording.
Nothing can bring that back.

### From the source

Node 22.12 or newer, and Docker for the database — TimescaleDB is Postgres with
an extension, so any instance that has it will do if you would rather not run a
container. Point `DATABASE_URL` at it.

```bash
git clone https://github.com/giovani-freitag/fathom.git
cd fathom
npm install
cp .env.example .env                       # then set POSTGRES_PASSWORD

docker compose up -d                       # the database alone
npm run migrate                            # only needed against an existing one
npm run build

npm run collector &                        # the half that must not stop
npm run gateway                            # http://localhost:8787
```

`npm run dev` serves the viewer with hot reload against a gateway you have
already started.

### Worth setting

Everything lives in `.env`, and `.env.example` documents all of it. The four
that decide what you get:

| | |
|---|---|
| `INSTRUMENT_SYMBOL` | Which contract to record. Any Binance USD-M perpetual. |
| `PRICE_BUCKET_SIZE` | How tall one row of the heat map is, in quote units. Ten dollars on Bitcoin; a hundredth of that on Litecoin. |
| `RECORDED_PRICE_RANGE_RATIO` | How far either side of the price the recording reaches. This is what a day of it costs on disk. |
| `FATHOM_ACCESS_TOKEN` | Leave it empty and every route is open. Set it before the port is reachable by anyone you have not met. |

### If nothing appears

- `docker compose --profile full logs collector` — it says what it is doing every
  time it reaches the exchange, loses it, or is refused by it.
- A first run needs a moment to mirror the book before the first column exists.
- Recorded gaps are drawn as gaps rather than filled in. A stripe across the
  chart is the recording saying it was not running, which is the truth.

### Without a backend at all

The same collector registers as a Web Worker and records into IndexedDB, which
is what the [demo](https://giovani-freitag.github.io/fathom/) is: no server, no
database, and a recording that lives in the tab.

```bash
npm run dev:demo
```

## 📚 Docs

- [Architecture](docs/architecture.md) — the two registrations, and how a frame reaches the screen
- [Data model](docs/data-model.md) — schema, grids, and what each column means
- [Operations](docs/operations.md) — running it as a service, reading its log, disk, sharing it
- [Decisions](docs/adr/) — why the design is what it is, with the measurements behind it
- [Demo](demo/) — the browser-only build, published to GitHub Pages on every release
