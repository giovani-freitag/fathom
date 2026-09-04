# What Fathom is

A chart of the **order book**, not just of the price.

Every second, Fathom records the resting limit orders on both sides of the
market and draws them as a heat map you can pan through. Bright bands are walls
of resting size; bubbles are the trades that ate them; candles ride on top. You
see whether a wall held or broke, and how long it stood there first.

![The chart](/screenshot.png)

## Why it has to be running

Candles come from the venue, so the chart opens on history from the first
second. **The order book does not.** No exchange sells yesterday's resting
depth, and nothing reconstructs it from trades — an hour that was not recorded
is gone for good.

That single fact shapes the whole design: the collector is the part that must
not stop, and a stretch of chart is only ever made of what it recorded.

## What is on the chart

| | |
|---|---|
| 🌊 **Depth heat map** | Every resting price level, once per second, as colour |
| 🕯️ **Candles over liquidity** | Full history and volume from the venue, with the book drawn under it |
| 🫧 **Aggressor bubbles** | Trades sized by volume, coloured by which side crossed the spread |
| 📊 **Depth ladder** | Resting size and traded volume per price, beside the chart |
| 🎚️ **Two-cut colour map** | Mute the background churn so real walls stand alone |
| 🔭 **Bands that hold up zoomed out** | Over days, prices fold into rows you can still follow |
| ✏️ **Marks and measures** | Levels, trend lines, zones and retracements, pinned to time and price |
| 📱 **Touch first** | One finger pans, two pinch both axes, the axes are scale handles |
| ⚡ **Live tail** | A WebSocket appends each new second without refetching the window |

## What you can add to it

Eighteen indicators ship with it — moving averages, bands, oscillators, volume
and delta. Beyond those, you write your own: a **reading** is a TypeScript file
you write in the page, against the same surface the shipped ones use. It
compiles as you type and draws on the chart beside the editor.

You can also bring one in from a GitHub repository or an npm package. Fathom
lists what is there, and where it came from, before it fetches a byte.

- [Write one →](/writing-a-reading)
- [Worked examples](https://github.com/giovani-freitag/fathom-addons)

## Where it runs

Two ways, from the same code:

- **With a backend** — a collector recording into TimescaleDB and a gateway
  serving the chart. One container, or four.
- **With none at all** — the same collector registers as a Web Worker and
  records into IndexedDB. That is what the
  [live demo](https://giovani-freitag.github.io/fathom/) is: no server, no
  account, and a recording that lives in the tab.

[Run it →](/running-it)
