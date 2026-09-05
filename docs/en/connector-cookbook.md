# Connector cookbook

Whole connectors for the shapes real exchanges come in. Every recipe on this
page is compiled against the published surface on each build, so nothing here is
a snippet that used to work.

Start with [Writing a connector](/en/writing-a-connector) if you have not read
it. This page is the part after that: what a venue actually looks like when you
sit down to add one.

## The smallest thing that works

Most venues you will want are this: a listing and a past. No live book, no tape.

```ts
import { Connector } from 'fathom';
import type { BarPageRequest, VenueBar, VenueInstrument } from 'fathom';

export default class Simple extends Connector {
    private static readonly REST = 'https://api.example.com';
    private static readonly MINUTE_MS = 60_000;

    readonly declaration = {
        book: null,
        tape: null,
        bars: {
            rungs: [{ widthMs: Simple.MINUTE_MS, anchorMs: 0 }],
            barsPerRequest: 1_000,
            hasVolume: true,
            hasBuyVolume: false,
            hasTradeCount: false,
        },
    };

    readonly instruments = {
        planInstruments: () => ({ url: Simple.REST + '/markets' }),
        readInstruments: (payload: unknown): VenueInstrument[] =>
            this.requireList(payload, 'markets').map((one) => {
                const entry = one as Record<string, unknown>;
                return {
                    symbol: String(entry['id']),
                    base: String(entry['base']),
                    quote: String(entry['quote']),
                    priceStep: this.readNumber(entry['tick']) ?? 0,
                    isTrading: entry['status'] === 'online',
                };
            }),
    };

    readonly planStream = null;
    readonly book = null;
    readonly tape = null;

    readonly bars = {
        planPage: (request: BarPageRequest) => ({
            url: Simple.REST + '/candles?market=' + encodeURIComponent(request.symbol)
                + '&from=' + String(request.fromMs) + '&to=' + String(request.toMs),
        }),
        readPage: (payload: unknown): VenueBar[] =>
            this.requireList(payload, 'candles').map((one) => {
                const row = one as Record<string, unknown>;
                const openedAtMs = this.readNumber(row['t']) ?? 0;
                return {
                    openedAtMs,
                    closedAtMs: openedAtMs,
                    openPrice: this.readNumber(row['o']) ?? 0,
                    highPrice: this.readNumber(row['h']) ?? 0,
                    lowPrice: this.readNumber(row['l']) ?? 0,
                    closePrice: this.readNumber(row['c']) ?? 0,
                    volume: this.readNumber(row['v']),
                    buyVolume: null,
                    tradeCount: null,
                };
            }),
    };
}
```

That is a complete, installable venue. Everything below is a variation on it.

## Candles that arrive as tuples

Plenty of venues send an array per candle rather than an object. Name the
positions once, inside the class, and read them by name.

```ts
import { Connector } from 'fathom';
import type { BarPageRequest, VenueBar } from 'fathom';

export default class Tuples extends Connector {
    private static readonly OPENED_AT = 0;
    private static readonly OPEN_PRICE = 1;
    private static readonly HIGH_PRICE = 2;
    private static readonly LOW_PRICE = 3;
    private static readonly CLOSE_PRICE = 4;
    private static readonly VOLUME = 5;

    /** How many positions a row must have before it is worth reading. */
    private static readonly FIELDS = 6;

    readonly declaration = { book: null, tape: null, bars: null };
    readonly instruments = {
        planInstruments: () => ({ url: 'https://api.example.com/markets' }),
        readInstruments: () => [],
    };
    readonly planStream = null;
    readonly book = null;
    readonly tape = null;

    readonly bars = {
        planPage: (request: BarPageRequest) => ({
            url: 'https://api.example.com/klines?symbol=' + encodeURIComponent(request.symbol),
        }),
        readPage: (payload: unknown): VenueBar[] => this
            .requireList(payload)
            .map((row) => this.readCandle(row))
            .filter((bar): bar is VenueBar => bar !== null),
    };

    /**
     * One candle out of a tuple, or null where a field is unreadable.
     */
    private readCandle(row: unknown): VenueBar | null {
        if (!Array.isArray(row) || row.length < Tuples.FIELDS) {
            return null;
        }

        const openedAtMs = this.readNumber(row[Tuples.OPENED_AT]);
        const closePrice = this.readNumber(row[Tuples.CLOSE_PRICE]);
        if (openedAtMs === null || closePrice === null) {
            return null;
        }

        return {
            openedAtMs,
            closedAtMs: openedAtMs,
            openPrice: this.readNumber(row[Tuples.OPEN_PRICE]) ?? closePrice,
            highPrice: this.readNumber(row[Tuples.HIGH_PRICE]) ?? closePrice,
            lowPrice: this.readNumber(row[Tuples.LOW_PRICE]) ?? closePrice,
            closePrice,
            volume: this.readNumber(row[Tuples.VOLUME]),
            buyVolume: null,
            tradeCount: null,
        };
    }
}
```

::: warning Three traps, in order of how often they bite
**Seconds.** Fathom works in milliseconds throughout. Several venues take and
give seconds — multiply on the way in, divide on the way out.

**Order of the run.** Return oldest first. A venue that sends newest first needs
a `.reverse()`, and without it the chart moves backwards.

**Order of the fields.** `open, close, high, low` is a real ordering that real
venues use. Read it as the usual one and the high sits below the low on every
candle that closed down.
:::

## A venue that closes its candles for you

Some venues name both edges. Say so, and Fathom uses yours instead of deriving
one from the width.

```ts
const openedAtMs = this.readNumber(row['start']) ?? 0;
const closedAtMs = this.readNumber(row['end']) ?? 0;

return {
    openedAtMs,
    // The venue closes on the last instant it holds; the chart treats the edge
    // as the first it does not. Hence the millisecond.
    closedAtMs: closedAtMs + 1,
    // …
};
```

Leave `closedAtMs` equal to `openedAtMs` where the venue names only the open,
and Fathom fills the edge in from the width it asked for.

## A live book

This is the half that makes the heat map. You need three things: a socket to
open, a snapshot to start the mirror from, and a way to read each update.

```ts
import { Connector } from 'fathom';
import type { DepthDiff, DepthSnapshot, SerializedPriceLevel } from 'fathom';

export default class Live extends Connector {
    private static readonly REST = 'https://api.example.com';
    private static readonly SOCKET = 'wss://stream.example.com';

    readonly declaration = {
        book: {
            // Every update names the one before it, which is the strongest
            // check there is. See below for a venue that offers less.
            grade: 'linked' as const,
            levelsPerSide: 'all' as const,
            publishIntervalMs: 100,
            clock: 'venue' as const,
        },
        tape: null,
        bars: null,
    };

    readonly instruments = {
        planInstruments: () => ({ url: Live.REST + '/markets' }),
        readInstruments: () => [],
    };

    readonly planStream = (symbol: string) => ({
        url: Live.SOCKET + '/book/' + symbol.toLowerCase(),
    });

    readonly book = {
        planSnapshot: (symbol: string) => ({
            url: Live.REST + '/book?symbol=' + encodeURIComponent(symbol) + '&depth=1000',
        }),
        readSnapshot: (payload: unknown): DepthSnapshot => ({
            lastUpdateId: this.readNumber((payload as Record<string, unknown>)['seq']) ?? 0,
            bidLevels: this.requireList(payload, 'bids') as SerializedPriceLevel[],
            askLevels: this.requireList(payload, 'asks') as SerializedPriceLevel[],
        }),
        readUpdate: (payload: unknown): DepthDiff | null => {
            const message = payload as Record<string, unknown>;
            const first = this.readNumber(message['from']);
            const final = this.readNumber(message['to']);
            // Anything else on the socket is not an error — it is a heartbeat,
            // an acknowledgement, or another subscription's traffic.
            if (first === null || final === null
                || !Array.isArray(message['b']) || !Array.isArray(message['a'])) {
                return null;
            }

            return {
                firstUpdateId: first,
                finalUpdateId: final,
                previousFinalUpdateId: first - 1,
                bidLevels: message['b'] as SerializedPriceLevel[],
                askLevels: message['a'] as SerializedPriceLevel[],
            };
        },
    };

    readonly tape = null;
    readonly bars = null;
}
```

`readUpdate` returning `null` is the normal case, not the failure case. One
socket carries everything a venue streams, so most messages on it are not yours.

## A socket that has to be spoken to

Many venues take their subscription over the socket rather than in the URL, and
drop a connection nothing has said anything on.

```ts
readonly planStream = (symbol: string) => ({
    url: 'wss://stream.example.com/v2',
    greetings: [JSON.stringify({ op: 'subscribe', args: ['book.' + symbol] })],
    heartbeat: { everyMs: 20_000, send: JSON.stringify({ op: 'ping' }) },
});
```

Fathom owns that timer. A connector holding one could keep the process alive
after the recording it belonged to was torn down, which is the whole reason a
connector never holds anything.

## A book you only get a window of

Most venues publish the nearest few levels rather than the whole ladder. Say how
many, and Fathom trims its mirror to that rank after every update.

```ts
readonly declaration = {
    book: {
        grade: 'stepped' as const,
        // Fifty a side, not the whole ladder. In a whole ladder an absent price
        // means nothing rests there; in a window it means nobody said.
        levelsPerSide: 50,
        publishIntervalMs: 200,
        clock: 'venue' as const,
    },
    tape: null,
    bars: null,
};
```

Without the trim, a level that a fast move pushed past the edge of the window
stands in the recording for hours at the size it last had — a solid shelf that
stopped existing the moment the move started.

## Declaring less than you can

The most useful thing a connector does is say no.

```ts
bars: {
    rungs: [{ widthMs: 60_000, anchorMs: 0 }],
    barsPerRequest: 500,
    hasVolume: true,
    // Almost every venue. Declare it false and delta, cumulative delta and
    // two-tone volume are greyed out here with the reason on the row.
    hasBuyVolume: false,
    hasTradeCount: false,
}
```

The temptation is to leave a flag `true` and hope. What that buys is a delta of
zero drawn across the whole chart, which reads exactly like balanced trading.

## What the API will not do for you today

Written down because finding out by trying is worse, and because these are the
edges where a real venue will stop you.

- **One request per listing.** `planInstruments` returns a single request. A
  venue that pages its symbol list cannot be read whole — you get the first
  page.
- **No secrets.** `VenueRequest` carries headers, and there is nowhere to keep a
  key that belongs in one. Only endpoints that need no authentication work.
- **`GET` only.** No method, no body. A venue that hands out its socket through
  a `POST` cannot be streamed from.
- **No second request before the first.** A connector cannot say "fetch this,
  then use the answer to build the next URL" — which is the shape of every
  token-gated socket.

Each of those is a real limit, not an oversight waiting to be found. If one is
in your way, it is worth saying so: they are the next things to change.
