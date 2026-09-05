# Writing a connector

## Introduction

A connector is the second kind of addon. An indicator adds arithmetic over what
an exchange said; a connector adds the exchange that says it.

You write one in the same editor, save it the same way, and Fathom works out
which of the two you wrote from what your file exports.

To begin, open the contract picker at the top of the chart and press **Add a
venue**. The editor opens on a connector rather than on a moving average.

## The one rule

**A connector describes and reads. Fathom performs and measures.**

Every method you write is plain and synchronous. It hands back a URL, and it
reads what came back. It never fetches, never holds a socket, and never sets a
timer. Fathom owns the timeout, the size limit, the retry and the clock.

This is not a matter of style. The collector shuts a recording down by waiting
for it to let go, so a connector that owned a connection would own a `close`
that can hang — and that would stop every other recording on the machine, not
just its own.

## The shape of a connector

You write a connector as a class extending `Connector`.

```ts
import { Connector } from 'fathom';
import type { VenueInstrument } from 'fathom';

/**
 * KuCoin spot, as far as a page can read it.
 */
export default class KuCoin extends Connector {
    // Kept in here because nothing outside this class uses it.
    private static readonly REST = 'https://api.kucoin.com';

    readonly declaration = { book: null, tape: null, bars: null };

    readonly instruments = {
        planInstruments: () => ({ url: KuCoin.REST + '/api/v2/symbols' }),
        readInstruments: (payload: unknown): VenueInstrument[] => [],
    };

    readonly planStream = null;
    readonly book = null;
    readonly tape = null;
    readonly bars = null;
}
```

Six members, and five of them may be `null`.

Every one is abstract on the base class, including those five. That is
deliberate: you have to type `null` to say no, and typing it is the moment you
read what Fathom does instead. Leave one out and the compiler asks for it.

`Connector` also carries the two readings every connector ends up repeating:

| | |
|---|---|
| `this.readNumber(field)` | A figure as a number, or `null` where it does not read as one. |
| `this.requireList(payload, 'data')` | A list out of the venue's answer, or a refusal saying it sent none. |

## Declaring what the venue cannot do

`declaration` is where a venue says what it can answer. It has three
capabilities, each either described or `null`.

| | What it means when present | What `null` does |
|---|---|---|
| `book` | Resting size per price, live | No heat map on this venue at all |
| `tape` | What actually traded, live | No live executions |
| `bars` | Candles for the past | Fathom folds bars from what it records |

Inside `bars`, three flags decide what an indicator may rely on:

```ts
bars: {
    rungs: [{ widthMs: 60_000, anchorMs: 0 }],
    barsPerRequest: 1_500,
    hasVolume: true,
    hasBuyVolume: false,
    hasTradeCount: false,
}
```

`hasBuyVolume: false` is the important one, and it is the honest answer almost
everywhere. Only one exchange of any size publishes the taker split in its
candles.

Declare it false and every indicator that divides by it — delta, cumulative
delta, volume in two tones — is greyed out on this venue, with the reason
printed on the row. Leave it out, and Fathom would draw a delta of zero and let
it look exactly like balanced trading.

The `anchorMs` beside each width is the phase its buckets open on. It is zero
for almost everything. A weekly bar opens on a Monday, which is four days past
where the epoch puts one.

## Reading the listing

This is the half worth writing first, because you find out in a second whether
it works. Press save, and either the pairs appear in the picker or the venue
tells you why not.

```ts
readonly instruments = {
    planInstruments: () => ({ url: KuCoin.REST + '/api/v2/symbols' }),
    readInstruments: (payload: unknown): VenueInstrument[] =>
        this.requireList(payload, 'data').map((listing) => {
            const entry = listing as Record<string, unknown>;
            return {
                symbol: String(entry['symbol']),
                base: String(entry['baseCurrency']),
                quote: String(entry['quoteCurrency']),
                priceStep: this.readNumber(entry['priceIncrement']) ?? 0,
                isTrading: entry['enableTrading'] === true,
            };
        }),
};
```

`payload` is whatever the venue answered, already parsed from JSON.
`requireList` throws for you when there is no list where you said there is one.
Anywhere else the shape surprises you, throw with a sentence of your own — the
picker shows it to the reader.

## Reading candles

```ts
readonly bars = {
    planPage: (request: BarPageRequest) => ({
        url: KuCoin.REST + '/api/v1/market/candles?type=1min'
            + '&symbol=' + encodeURIComponent(request.symbol)
            + '&startAt=' + String(Math.floor(request.fromMs / 1_000))
            + '&endAt=' + String(Math.floor(request.toMs / 1_000)),
    }),
    readPage: (payload: unknown, request: BarPageRequest): VenueBar[] => [],
};
```

Three things catch everybody:

- **Units.** Fathom works in milliseconds. Several exchanges take and give
  seconds.
- **Order.** Return your bars oldest first. Some exchanges send newest first,
  and a run in the wrong order draws a chart that moves backwards.
- **Field order.** Some exchanges send `open, close, high, low` rather than the
  usual order. Read it wrong and the high sits below the low on every candle
  that closed down.

Leave `volume`, `buyVolume` and `tradeCount` as `null` wherever the venue
publishes none. Zero is a real answer here — a bucket nobody traded in is a
quiet bucket — so a venue that publishes nothing has to stay distinguishable
from one that was simply quiet.

If the venue names only where a candle opens, leave `closedAtMs` equal to
`openedAtMs`. Fathom fills the closing edge in from the width it asked for.

## Installing it

Save. The venue appears among the others in the contract picker, and Fathom asks
it what it trades straight away. Star a pair to keep it in one of your lists.

Your connector is kept as the source you wrote, so it is still there next week —
and so you can read what you installed before it runs again.

::: warning Where your connectors are kept
Like saved indicators, they live in your browser's local storage. Clearing site
data will take them with it. Export anything you want to keep.
:::

## What a connector cannot do yet

- **`GET` only.** A connector names a URL. An exchange that hands out its socket
  through a `POST` for a short-lived URL cannot be streamed from, which is
  exactly why the KuCoin example declares `book: null`.
- **The chart, not the collector.** A connector you install lives in your
  browser, so the server that records order books cannot see it. A venue brought
  in this way gives you a pair listing and nothing more: with no recording behind
  a pair, there is nothing for the chart to open.
- **A linked book only.** The grade a connector declares is recorded but not yet
  acted on. Fathom's mirror still requires the back reference that the built-in
  venue publishes.
- **A page alone cannot reach most exchanges.** Almost none publish the header a
  browser needs to read them cross-origin. Where Fathom has a server, requests
  go through it — https only, no redirects, and nothing on the server's own
  network reachable. In the browser-only demo there is nobody to ask, so only an
  exchange that lets a page in can be read.

## More recipes

Whole connectors for the shapes real exchanges come in — tuples, a live book, a
socket that has to be spoken to, a book you only get a window of — are in the
[cookbook](/en/connector-cookbook).

## A worked one

The [`kucoin` example](https://github.com/giovani-freitag/fathom-example-addons/tree/main/src/addons/kucoin)
is a complete connector with tests, including the seconds, the field order and
the reversed page.

---

The reasoning behind all of this is in
[ADR 25](/en/adr/0025-a-reader-brings-the-venue-as-well-as-the-indicator).
