# Introduction

Fathom is a chart of the **order book**, not just of the price.

Once a second, it records every resting limit order on both sides of the market
and draws them as a heat map you can pan through. Bright bands are walls of
resting size. Bubbles are the trades that ate them. Candles ride on top, so you
can see whether a wall held or broke, and how long it stood there first.

![The chart](/screenshot.png)

There is no account to create, no trial to start, and no paid tier hiding the
useful part. You open it and it works.

## Why it has to be running

Candles come from the exchange, so the chart opens on real history from the
first second.

**The order book does not.** No exchange sells you yesterday's resting depth,
and nothing reconstructs it from the trades that happened. An hour nobody
recorded is gone for good.

That one fact shapes everything else. The collector is the part that must not
stop, and any stretch of chart is only ever made of what it managed to record.

::: tip Leave it running
If you install Fathom on Monday and open it on Friday, you get Monday to Friday.
If you install it on Friday, you get Friday. There is no history to download.
:::

## What is on the chart

| | |
|---|---|
| 🌊 **Depth heat map** | Every resting price level, once a second, as colour |
| 🕯️ **Candles over liquidity** | Full history and volume from the exchange, with the book drawn underneath |
| 🫧 **Aggressor bubbles** | Trades sized by volume and coloured by the side that crossed the spread |
| 📊 **Depth ladder** | Resting size and traded volume per price, beside the chart |
| 🎚️ **Two-cut colour map** | Mute the background churn so the real walls stand out |
| 🔭 **Bands that survive zooming out** | Over days, prices fold into rows you can still follow |
| ✏️ **Marks and measures** | Levels, trend lines, zones and retracements, pinned to time and price |
| 📱 **Built for touch** | One finger pans, two pinch both axes, and the axes are scale handles |
| ⚡ **Live tail** | A WebSocket appends each new second without refetching the window |

## Indicators

Eighteen indicators ship with Fathom: moving averages, bands, oscillators,
volume and delta. You add them from the layer panel and tune them from there.

Beyond those, you write your own. An **indicator** is a TypeScript file you
write in the page, against the exact interface the built-in ones use. It
compiles as you type and draws on the chart beside the editor.

You may also bring one in from a GitHub repository or an npm package. Fathom
shows you every file, its size and where it came from before it fetches a byte.

- [Writing an indicator →](/en/writing-a-reading)
- [Worked examples](https://github.com/giovani-freitag/fathom-example-addons)

## Exchanges

Fathom records Binance USD-M perpetuals, and reads five more exchanges out of
the box: Bybit, OKX, Coinbase, Kraken and Gate. If you want one that is not
there, you write a **connector** — the same kind of addon, in the same editor,
and the same interface the six shipped ones are written against. A connector
tells Fathom what a venue can answer and how to read its replies, and Fathom
does the fetching.

A connector also declares what its venue *cannot* do. Most exchanges publish no
taker split in their candles, for example. When a connector says so, Fathom
greys out the readings that would need it instead of drawing a delta of zero and
letting it look like balanced trading.

[Writing a connector →](/en/writing-a-connector)

## Where it runs

You have two ways to run Fathom, and the difference matters.

### In the browser, as a demo

The [live demo](https://giovani-freitag.github.io/fathom/) runs the whole
collector inside a Web Worker and records into IndexedDB. Nothing is installed
and no server is involved.

It is genuinely the same code, and it is genuinely limited:

- **It records only while the tab is open.** Close it and the recording stops.
- **It keeps a window, not a history.** Newest frames up to a share of the
  device's quota, oldest dropped first. Days on a desktop, hours on a phone.
- **It watches one contract at a time**, not four.
- **Browser storage is not durable.** Clearing site data, a full disk, or the
  browser reclaiming space will take the recording with it.

Use it to see what Fathom draws. Do not use it to keep anything.

### On your own machine, properly

One `docker run` gives you the database, the collector and the chart, recording
into a volume you control and running whether or not a tab is open.

```bash
docker run -p 8787:8787 -v fathom:/var/lib/postgresql/data \
  ghcr.io/giovani-freitag/fathom
```

If you would rather deploy it somewhere of your own, clone the repository and
build it. Four containers, a compose file, or from source — all covered on the
next page.

[Installation →](/en/running-it)
