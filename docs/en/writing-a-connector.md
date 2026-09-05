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

    planInstruments() {
        return { url: this.address(KuCoin.REST, '/api/v2/symbols') };
    }

    readInstruments(payload: unknown): VenueInstrument[] {
        return [];
    }
}
```

That is a whole connector. Three members, and there is no fourth to remember:
a venue that declares nothing beyond its listing writes nothing beyond it.

Everything else — the socket, the snapshot, the candles — is inherited from
`Connector`, and everything inherited refuses. Ask a venue like this one for a
page of candles and it says it serves none, in those words, rather than handing
back an empty page that reads like a quiet market.

So you add a method when, and only when, your declaration claims the capability
behind it. The two are checked against each other the moment you save: declare a
book without the methods to read one and Fathom names the ones you did not
write, and write them without declaring it and Fathom says so too.

Each of the three fields of `declaration` is required, and each is either
described or `null`. You have to type the `null` — and typing it is the moment
you read what Fathom does instead.

`Connector` also carries the two readings every connector ends up repeating:

| | |
|---|---|
| `this.address(base, path, query)` | A URL, built through `URL` and escaped for you. |
| `this.readNumber(field)` | A figure as a number, or `null` where it does not read as one. |
| `this.requireList(payload, 'data')` | A list out of the venue's answer, or a refusal saying it sent none. |

Every address in this guide goes through `address`. A URL joined by hand is a
URL with a symbol pasted into it unescaped, and the one pair with an `&` in its
name is the one that quietly asks for something else.

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
planInstruments() {
    return { url: this.address(KuCoin.REST, '/api/v2/symbols') };
}

readInstruments(payload: unknown): VenueInstrument[] {
    return this.requireList(payload, 'data').map((listing) => {
        const entry = listing as Record<string, unknown>;
        return {
            symbol: String(entry['symbol']),
            base: String(entry['baseCurrency']),
            quote: String(entry['quoteCurrency']),
            priceStep: this.readNumber(entry['priceIncrement']) ?? 0,
            isTrading: entry['enableTrading'] === true,
        };
    });
}
```

`payload` is whatever the venue answered, already parsed from JSON.
`requireList` throws for you when there is no list where you said there is one.
Anywhere else the shape surprises you, throw with a sentence of your own — the
picker shows it to the reader.

### A listing served in pages

Some venues hand you a few hundred pairs at a time. `planInstruments` is given
the offset it is being asked for, so say where a page is and how many there are
in all:

```ts
planInstruments(from: number) {
    return { url: this.address(KuCoin.REST, '/api/v2/symbols', { offset: from, limit: 500 }) };
}

override readInstrumentTotal(payload: unknown) {
    return this.readNumber((payload as Record<string, unknown>)['total']);
}
```

That pair is what buys the reader a listing rather than a wait. Knowing the
total, Fathom works out every remaining page from the first one and asks for
them **together** — five in the air at a time, and each handed to the picker as
it lands, so the first five hundred pairs are on screen while the rest arrive.

A venue that hands out a cursor instead of a total has pages that can only be
walked, and `continueInstruments` is where you say so:

```ts
override continueInstruments(payload: unknown, read: number) {
    void read;
    const cursor = (payload as { cursor?: string }).cursor;

    return cursor === undefined ? null : { url: this.address(KuCoin.REST, '/api/v2/symbols', { cursor }) };
}
```

Either way Fathom stops at twenty pages, so a venue whose answer never says it
is finished stops on Fathom's count rather than yours.

### A venue that searches for you

A reader typing while four thousand pairs are still arriving is searching
whatever has landed. Where the venue matches on its own, hand Fathom the
question:

```ts
override planInstrumentSearch(term: string) {
    return { url: this.address(KuCoin.REST, '/api/v2/symbols', { query: term }) };
}
```

The answer is read by your own `readInstruments`. Leave the method out — the
default, and right for most venues — and the picker searches what it has read,
saying so while the reading is unfinished.

## Reading candles

```ts
override planBars(request: BarPageRequest) {
    return {
        url: this.address(KuCoin.REST, '/api/v1/market/candles', {
            type: '1min',
            symbol: request.symbol,
            startAt: Math.floor(request.fromMs / 1_000),
            endAt: Math.floor(request.toMs / 1_000),
        }),
    };
}

override readBars(payload: unknown, request: BarPageRequest): VenueBar[] {
    return [];
}
```

The `override` is what says you are standing in for the refusal you inherited.
Leave it off and the compiler tells you, which is the same check from the other
side: a method spelled almost right is a method Fathom never calls.

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

## A socket you have to buy first

Plenty of venues will not give you a fixed socket URL. You ask for one, they hand
you a short-lived address, and you connect to that. A connector cannot fetch, so
it describes both halves and Fathom performs them in order.

```ts
override planStreamTicket() {
    return { url: this.address(KuCoin.REST, '/api/v1/bullet-public'), method: 'POST' as const };
}

override readStreamTicket(payload: unknown): string {
    const data = (payload as Record<string, Record<string, unknown>>)['data'];
    return String((this.requireList(data, 'instanceServers')[0] as
        Record<string, unknown>)['endpoint']) + '?token=' + String(data?.['token']);
}

override planStream(symbol: string, ticket: string) {
    return {
        url: ticket,
        greetings: [JSON.stringify({ type: 'subscribe', topic: '/market/level2:' + symbol })],
        heartbeat: { everyMs: 20_000, send: JSON.stringify({ type: 'ping' }) },
    };
}
```

Any request you describe may carry a `method`, a `body` and `headers` — that is
the whole of what a `POST` needs here. What it may not carry is a secret: there
is nowhere in Fathom to keep a key, so only endpoints that need no signature can
be read.

Fathom buys a fresh ticket every time it opens the socket, including after a
reconnect, because a short-lived address is short-lived exactly when a stream
drops. It owns that heartbeat timer too, for the reason at the top of the page.

## Installing it

Save. The venue appears among the others in the contract picker, and Fathom asks
it what it trades straight away. Mark a pair to file it under one of your tags.

Your connector is kept as the source you wrote, so it is still there next week —
and so you can read what you installed before it runs again.

::: warning Where your connectors are kept
Like saved indicators, they live in your browser's local storage. Clearing site
data will take them with it. Export anything you want to keep.
:::

## What a connector cannot do yet

- **No secrets.** A request carries headers, and there is nowhere to keep a key
  that belongs in one. Only endpoints that need no signature can be read, which
  rules out most of what an exchange puts behind an account.
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

Whole connectors for the shapes real exchanges come in — a listing that arrives
in pages, candles as tuples, a live book, a socket you have to ask for first, a
book you only get a window of — are in the [cookbook](/en/connector-cookbook).

## A worked one

The [`kucoin` example](https://github.com/giovani-freitag/fathom-example-addons/tree/main/src/addons/kucoin)
is a complete connector with tests, including the seconds, the field order and
the reversed page.

---

The reasoning behind all of this is in
[ADR 25](/en/adr/0025-a-reader-brings-the-venue-as-well-as-the-indicator).
