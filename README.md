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
- ✏️ **Mark it up** — levels, trend lines and zones, pinned to time and price rather than pixels
- 📏 **Measure a move** — drag a stretch and read it in money and in percent
- 🎯 **Press what you mean** — a mark or a plotted line opens its own settings where you pressed it
- 📱 **Touch first** — one finger pans, two pinch both axes, the axes are scale handles
- ⚡ **Live tail** — a WebSocket appends each new second without refetching the window
- 🎛️ **Recording control** — pick which contracts record and cap the disk, from the chart itself
- 🔌 **Venue-neutral core** — the exchange lives behind a driver; Binance USD-M is the first
- 🌐 **Runs with no backend** — the same collector registers as a Web Worker and records into IndexedDB

## 🚀 Run it locally

```bash
git clone https://github.com/giovani-freitag/fathom.git
cd fathom
npm install
cp .env.example .env          # set POSTGRES_PASSWORD

docker compose up -d          # TimescaleDB
npm run migrate
npm run build

npm run collect &             # start recording — this is the part that must not stop
npm run gateway               # http://localhost:8787
```

The chart only covers time the collector was running. Leave it up.

## 📚 Docs

- [Architecture](docs/architecture.md) — the two registrations, and how a frame reaches the screen
- [Data model](docs/data-model.md) — schema, grids, and what each column means
- [Operations](docs/operations.md) — running it as a service, reading its log, disk, sharing it
- [Decisions](docs/adr/) — why the design is what it is, with the measurements behind it
- [Demo](demo/) — the browser-only build, published to GitHub Pages on every release
