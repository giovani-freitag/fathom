# Writing a reading

A **reading** is an indicator you write yourself, in the page, against the same
surface the shipped ones use. It compiles as you type, draws on the chart beside
the editor, and never leaves your browser.

This guide goes from the smallest reading that works to the parts you will reach
for last. Every example here compiles.

Worked examples you can open in one press:
[github.com/giovani-freitag/fathom-example-addons](https://github.com/giovani-freitag/fathom-example-addons)
— checked against this surface on every push, so nothing there is a snippet
that used to work.

---

## 1. The smallest reading that works

```ts
import { Plot } from 'fathom';
import type { Indicator, IndicatorInput, PlanDraft } from 'fathom';

export default class Midpoint implements Indicator {
    readonly label = 'Midpoint';
    readonly parameters = [];

    compute(input: IndicatorInput): PlanDraft {
        const middle = input.bars.bars.map((bar) => (bar.highPrice + bar.lowPrice) / 2);

        return Plot.over(input.bars).line(middle, 'Midpoint').overThePrice();
    }
}
```

That is a whole reading. Press **Write a reading**, paste it, and it draws.

Three things are true of every reading:

- It lives in **`main.ts`**, and its **default export** is the reading.
- It imports from **`'fathom'`** and from its own files. Nothing else resolves.
- **`compute` is arithmetic.** It runs again on every bar, every pan and every
  zoom, so it must not fetch, wait, or remember anything between calls.

---

## 2. The five parts

```ts
export default class MyReading implements Indicator {
    readonly label = 'My reading';          // required — what the chart calls it
    readonly about = 'One line about it';   // optional — shown where a layer is picked
    readonly parameters = [];               // required — the knobs, possibly none
    readonly scale = { kind: 'price' };     // optional — usually decided by the builder

    resolveSources(settings) { … }          // optional — what the chart must fetch first
    compute(input) { … }                    // required — the arithmetic
}
```

`implements Indicator` rather than `extends` anything: there is no base class to
import, and a reading you write is the same shape as one that ships.

**`label`** appears in the legend and in the layer list. **`about`** is one line
under the name where a reader adds a layer. Both are plain strings — see
[§9](#9-two-languages) for writing them in more than one language.

---

## 3. What you are given

`compute` is handed one object:

```ts
interface IndicatorInput {
    readonly bars: PriceBarWindow;
    readonly settings: IndicatorSettings;
    readonly sessions: Readonly<Record<string, SettledSessions>>;
}
```

### The bars

`input.bars.bars` is the array, oldest first. Each bar:

```ts
interface PriceBar {
    readonly openedAtMs: number;   // bucket edges, always aligned
    readonly closedAtMs: number;
    readonly openPrice: number;
    readonly highPrice: number;
    readonly lowPrice: number;
    readonly closePrice: number;
    readonly buyVolume: number;    // what crossed the spread, by side
    readonly sellVolume: number;
    readonly tradeCount: number;
    readonly expectedFrames: number;   // frames a whole bucket of this width holds
    readonly frameCount: number;       // frames actually recorded
    readonly isClosed: boolean;        // false for the bar still forming
}
```

`buyVolume` and `sellVolume` are the pair this chart has that most do not: a
zero is a real answer, meaning a bucket the book was recorded through with
nobody trading.

`frameCount` short of `expectedFrames` means the bar was built from less than it
should have been — a gap in the recording, not a quiet market. `classifyBar`
tells you which.

`input.bars` also carries `instrumentSymbol` and `intervalMs`.

### One value per drawn bar

Every series you plot must have exactly one value per bar in `input.bars.bars`.
Hand back a different length and the builder throws, saying what it got and what
it expected. Use `Number.NaN` for "no answer here" — it breaks the line rather
than bridging across the gap.

---

## 4. Drawing

`Plot.over(input.bars)` starts a plan. You add series, then say where it goes.
The last call returns the plan, so it always ends the chain.

### Series

```ts
Plot.over(input.bars)
    .line(values, 'Mean')            // a joined line
    .histogram(values, 'Delta')      // bars from a baseline
    .dots(values, 'Stop')            // marks that are not joined up
    .lines({ Upper: a, Lower: b })   // several lines at once, in order
```

`dots` is for a reading that flips from one side of price to the other: joining
the marks would draw a stroke through the price at every flip that no reading
took.

### Styling the one just added

```ts
    .in('amber')          // a palette token, never a CSS colour
    .dashed()
    .thick(2)
    .risingAndFalling()   // split by side about a baseline, defaulting to zero
```

Tones: `bid`, `ask`, `amber`, `phosphor`, `violet`, `cyan`, `ink`, `muted`.
Leave the colour off and the reader picks it in the layer list, which is what
most readings should do.

### Marks that are not series

```ts
    .at(70, 'muted')            // a horizontal line at a constant
    .shading(0, 1, 'amber')     // fill between two series, by the order added
    .namingEachLine()           // write each series' name at the end of its line
```

### Where it goes — one of these ends the chain

```ts
    .overThePrice()        // on the price itself
    .inItsOwnBand()        // a band below, scaled to what the values reach
    .between(0, 100)       // a band pinned to a fixed range
    .aboutZero()           // a band centred on zero
    .alongTheFloor(0.2)    // a strip along the bottom of the price pane
```

`alongTheFloor` costs the price no height, only some of its floor — it is what
volume uses.

### Two more, occasionally

```ts
    .summarisedAs('20, close')   // what the legend says about the settings
    .converged(false)            // see §7
```

**Budget:** at most 8 series and 8192 points each. A plan over it is refused
whole rather than clipped, and the editor's footer says which limit it went past
— but only while the reading is open, so `isPlanWithinBudget` is still there to
check a plan before the chart does.

---

## 5. Knobs the reader can turn

A parameter is built once, outside the class. The object you build is both what
the settings panel shows and what you read the value back with.

```ts
import { Params, readSetting, readToggle, readChoice } from 'fathom';

const PERIOD = Params.integer('periodBars')   // stored under this name
    .called('Period')                         // what the panel shows
    .between(2, 400)                          // clamped to this range
    .by(1)                                    // how far one nudge moves it
    .startingAt(20);

const BAND = Params.decimal('deviations').called('Deviations').between(0.5, 5).startingAt(2);
const MODE = Params.choice('mode', ['Fast', 'Slow']).called('Mode').startingAt('Fast');
const FILL = Params.toggle('isFilled').called('Fill it').startingAt(true);
```

Then in `compute`:

```ts
const periodBars = readSetting(input.settings, PERIOD);   // number
const deviations = readSetting(input.settings, BAND);     // number
const mode = readChoice(input.settings, MODE);            // string
const isFilled = readToggle(input.settings, FILL);        // boolean
```

Put every one you built in `readonly parameters = [PERIOD, BAND, MODE, FILL]`,
in the order you want them shown.

A choice's values are shown as they are, so keep them readable — and keep them
stable, because the value is what gets stored.

---

## 6. What the chart must fetch first

A mean over twenty bars needs nineteen bars of history before the first drawn
one, or the left edge is blank where it need not be. Ask, and the chart fetches
them; they arrive as part of `input.bars` and the drawn window is unchanged.

```ts
resolveSources(settings: IndicatorSettings): SourceRequest {
    return { warmupBars: readSetting(settings, PERIOD) };
}
```

Ask for what you actually read. A reading that declares warm-up it does not use
reports itself unconverged when the archive begins mid-window, which is a
warning about nothing.

---

## 7. A coarser session

For a reading drawn on one-minute bars that needs yesterday's close, declare the
session by a name of your own:

```ts
resolveSources(): SourceRequest {
    return { sessions: { previous: { intervalMs: 86_400_000, reachingBack: 1 } } };
}
```

`reachingBack` is how many settled sessions you need before the window opens.
Then read it back:

```ts
const previous = readSessions(input, 'previous');

previous.hasAny             // false where nothing had settled by any drawn bar
previous.perBar[index]      // the newest session that had closed by that bar's open
previous.turnsOver[index]   // 1 where this bar is the first after the turn
previous.closed             // every settled session, oldest first
previous.indexPerBar[index] // where in `closed` this bar's own session sits
```

**All four are held back to what each drawn bar could know**, so there is no
index that reaches a session a drawn bar could not have seen. A reading written
against them cannot repaint.

`perBar[index]` is `undefined` at the left edge, before anything had settled.
`?? Number.NaN` is the usual answer.

Reaching for a name you never declared throws, and says which names you did
declare. That is the one failure this design refuses to make silent.

### A figure computed over the coarser rung

`perBar` answers *what did this bar know*, which is one session. For a mean, a
range or anything else with a memory, you need the run — that is `closed`, and
`indexPerBar` says where each drawn bar sits in it:

```ts
const period = 50;
const held = readSessions(input, 'previous');

// Computed once over the run, then held at each drawn bar: a step, because the
// coarser mean did not move between closes.
const means = exponentialMean(held.closed.map((bar) => bar.closePrice), period);
const perBar = [...held.indexPerBar]
    .map((at) => (at < 0 ? Number.NaN : means[at] ?? Number.NaN));
```

`closed` reaches back by `reachingBack` sessions, so ask for a multiple of the
period rather than for one: `reachingBack: period * 8` hands a fifty-period mean
four hundred closes, and it costs the same one request per rung as asking for
one. Nothing still forming is in there.

Which rungs a venue publishes is a fixed list — a minute, five, fifteen, thirty,
an hour, two, four, a day, a week. A month is not on it and cannot be: the list
is keyed by a width in milliseconds and a month has no fixed one.

### Saying you have nothing yet

```ts
    .converged(previous.hasAny)
```

The legend then marks the reading as not yet converged, rather than letting a
blank line read as a flat one.

---

## 8. More than one file

Press the **new-file** button in the toolbar and name it. A reading starts at
`main.ts`; everything else is yours to arrange.

```ts
// maths/mean.ts
export function rollingMean(values: readonly number[], periodBars: number): number[] {
    // …
}
```

```ts
// main.ts
import { rollingMean } from './maths/mean.js';
```

Relative paths only, and only within the reading: `./`, `../`, and `index.ts`
for a folder. **End it in `.js`, or leave the ending off** — `./maths/mean` and
`./maths/mean.js` both find `maths/mean.ts`, the second because that is how
TypeScript has you write an import. Ending it in `.ts` is the one form the
compiler refuses, and the editor says so.

Each file runs once however many others ask for it. Two files that import each
other get what the other has exported so far rather than looping. A file that
throws is not kept: the next `require` runs it again and throws again.

`'fathom'` is the only other thing that resolves. **There is no npm here.**

A file you take out is offered back for a few seconds, like a deleted reading.

---

## 9. Two languages

The interface has two. A reading names itself, so it can answer in both:

```ts
import { inWords } from 'fathom';

readonly label = inWords({ en: 'My mean', 'pt-BR': 'Minha média' });
```

`en` is required and is what a language you did not write in falls back to. It
works anywhere in the file — a field, a parameter label, a series name — because
changing the language builds every reading again from the JavaScript it was
saved as, so the whole file runs afresh with the new language in force.

---

## 10. Seeing what actually arrived

`console.log` works, and prints to the **Console** below the editor rather than
to the browser's own.

```ts
console.log('bars', input.bars.bars.length, 'first', input.bars.bars[0]);
```

Series print with their length — `Float64Array(43) [81176.4, …31 more]` — lists
show their first twelve and count the rest, and objects are opened two levels
deep.

`compute` runs again on every bar, pan and zoom, so a line printed inside it
arrives constantly: a line printed twice running shows once with a count beside
it, only the last 200 are kept, and when more than one reading is printing each
line is named. `warn` and `error` are marked; `info` and `debug` read as `log`.
Nothing else on the real console is offered.

---

## 11. Sharing one

**Out.** A reading of one file exports as a `.ts`. One of several exports as a
`.fathom.json` holding all of them, which is also what it opens from.

**In, from a file.** The open button takes a `.ts`, a `.tsx` or a bundle.

**In, from a repository or a package.** The cloud button takes:

```text
gh/user/repo                       the newest tag, or the default branch
gh/user/repo@main/readings/mean    a branch, and a folder within it
npm/@someone/reading@1.2.0
```

An address copied out of GitHub or npm works too. It takes the `.ts` and `.tsx`
files under the folder you named — up to forty and 512 kB, entry `main.ts` or
`index.ts`, `.d.ts` left out — and opens them as one reading, marked unsaved.

You are shown the file list and where it came from before any of it is fetched,
and it fetches from exactly what it showed you. Every file is checked against
the size and the hash the listing gave.

> What you bring in is somebody else's code, and it runs in this page as soon as
> it opens — the same way your own does. Only bring in what you would run
> yourself.

---

## 12. Everything on the surface

Everything importable from `'fathom'`. Nothing outside this list is public.

### Starting a plan and a parameter

| | |
|---|---|
| `Plot.over(bars)` | Starts a plan bound to the drawn bars. |
| `Params.integer(name)` `.decimal` `.choice` `.toggle` | Builds a knob. |

### Reading settings and sessions

| | |
|---|---|
| `readSetting(settings, parameter)` | A numeric knob's value. |
| `readToggle(settings, parameter)` | A switch's value. |
| `readChoice(settings, parameter)` | A choice's value. |
| `readSessions(input, name)` | A declared session. Throws on a name you did not declare. |
| `summariseParameters(parameters, settings)` | The legend's own summary of the settings. |

### The bars

| | |
|---|---|
| `readBarSource(bar, source)` | One bar under `'close'`, `'hl2'`, `'ohlc4'` and the rest. |
| `collectSource(bars, settings)` | The chosen source across every bar. |
| `collectInstants(bars)` | Each bar's close time. |
| `classifyBar(bar)` | Whether a bar was wholly recorded. |
| `findContinuousSegments(bars)` | Runs of bars with no gap between them. |
| `BAR_SOURCES`, `SOURCE` | The source names, and a ready-made choice over them. |

### Arithmetic the shipped readings use

| | |
|---|---|
| `createBlankValues(length)` | A `Float64Array` of NaN. |
| `smoothWilder(previous, sample, periodBars)` | One Wilder step. |
| `fillWilder(fill)` / `fillExponential(fill)` | A whole smoothed series, in place. |
| `resolveExponentialWeight(periodBars)` | The α an EMA of that length uses. |
| `resolveTrueRange(bar, previousClose)` / `collectTrueRanges(bars, segment)` | True range. |
| `holdLastClosed(bars, higher)` | Aligns a coarser rung by hand, as the host does. |

### Words, budgets and shapes

| | |
|---|---|
| `inWords(words)` | One phrase in the reader's language. |
| `isPlanWithinBudget(plan)` | Whether a plan is inside the 8 × 8192 budget. |
| `PLOT_TONES`, `PLOT_BUDGET`, `BAR_BUDGET`, `NO_SESSIONS` | The constants behind all of it. |

Types: `Indicator`, `IndicatorInput`, `IndicatorSettings`, `PlanDraft`,
`SourceRequest`, `SessionRequest`, `SettledSessions`, `PriceBar`,
`PriceBarWindow`, `PlotSeries`, `PlotShape`, `PlotTone`, `PlotScale`,
`PlotBand`, `PlotLevel`, `PlotValues`, `NumericParameter`, `ChoiceParameter`,
`ToggleParameter`, `IndicatorParameter`, `Tunable`, `BarSource`,
`BarCompleteness`, `BarSegment`, `SeriesFill`, `Words`, `Locale`, `DrawPlan`.

---

## 13. What a reading cannot do

Stated plainly, because finding out by trying is worse.

- **No npm.** Nothing outside `'fathom'` and your own files resolves. A package
  whose code imports anything else will not build, and the editor says which
  import it could not find.
- **No fetching, no timers, no state between calls.** `compute` is called again
  on every redraw; anything it remembers is a bug waiting for a pan.
- **No book, no executions, no gaps.** A reading reaches the bars and the
  sessions. The order-book field this chart is built around is not on the
  surface yet.
- **No sandbox.** A reading runs in the page, on the main thread, like the
  shipped ones. It can reach a global if it goes looking. A runaway loop takes
  the tab with it.
- **No colour of its own.** Tones come from the palette, so a reading stays
  legible when the theme changes.
- **Nothing promised across versions.** The surface is one barrel and it may
  change. A reading that stops building after an upgrade reports the compiler's
  own error, and the source is still yours.

## 14. Writing a connector

A **connector** is the other kind of addon. A reading adds arithmetic over what
a venue said; a connector adds a venue to say it. You write it in the same
editor, save it the same way, and which of the two Fathom builds comes from what
your file exports.

Press the contract picker at the top of the chart, then **Add a venue**. The
editor opens on a connector rather than on a moving average.

### The one rule

**A connector describes and reads. The engine performs and measures.**

Every method is plain and synchronous. It hands back a URL and reads what came
back. It never fetches, never holds a socket, never sets a timer. Fathom owns
the timeout, the size limit, the retry and the clock.

That is not a style preference. The collector tears recordings down by waiting
for each one to let go, and a connector that owned a connection would own a
close that can hang — which would stop every other recording on the machine, not
just its own.

### The shape

```ts
import type { VenueBar, VenueConnector, VenueInstrument } from 'fathom';

const REST = 'https://api.kucoin.com';

/**
 * KuCoin spot, as far as a page can read it.
 */
export default {
    declaration: { book: null, tape: null, bars: null },
    instruments: {
        planInstruments: () => ({ url: `${REST}/api/v2/symbols` }),
        readInstruments: (payload: unknown): VenueInstrument[] => [],
    },
    planStream: null,
    book: null,
    tape: null,
    bars: null,
} satisfies VenueConnector;
```

Six fields, and five of them can be `null`. There are no optional properties on
purpose: you have to type `null` to say no, and typing it is the moment you read
what the chart does instead.

### Saying what the venue cannot do

`declaration` is where a venue says what it can answer. Three capabilities, each
either described or `null`:

| | What it means when it is there | What `null` does |
|---|---|---|
| `book` | Resting size per price, live | No heatmap on this venue at all |
| `tape` | What actually traded, live | No live executions |
| `bars` | Candles for the past | The chart folds bars from what it records |

Inside `bars`, three flags decide what a reading may rely on:

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
everywhere: one venue of any size publishes the taker split in its candles.
Declared false, every reading that divides by it — delta, cumulative delta,
volume in two tones — is greyed out on this venue with the reason on the row.
Left out, the chart would draw a delta of nought and call it even buying and
selling, which reads exactly like the truth.

The `anchorMs` beside each width is the phase its buckets open on. Zero for
almost everything; a weekly bar opens on a Monday, which is four days past where
the epoch puts one.

### Reading a listing

This is the half worth writing first, because you find out in a second whether
it works: press save, and either the pairs appear in the picker or the venue
says why not.

```ts
instruments: {
    planInstruments: () => ({ url: `${REST}/api/v2/symbols` }),
    readInstruments: (payload: unknown): VenueInstrument[] => {
        const listed = (payload as { data?: unknown }).data;
        if (!Array.isArray(listed)) {
            throw new Error('The venue listed no symbols.');
        }
        return listed.map((one) => {
            const entry = one as Record<string, unknown>;
            return {
                symbol: String(entry['symbol']),
                base: String(entry['baseCurrency']),
                quote: String(entry['quoteCurrency']),
                priceStep: Number(entry['priceIncrement']),
                isTrading: entry['enableTrading'] === true,
            };
        });
    },
}
```

`payload` is whatever the venue answered, already parsed from JSON. Throw with a
sentence if it is not the shape you expected — the picker shows it.

### Reading candles

```ts
bars: {
    planPage: (request) => ({
        url: `${REST}/api/v1/market/candles?type=1min`
            + `&symbol=${encodeURIComponent(request.symbol)}`
            + `&startAt=${String(Math.floor(request.fromMs / 1_000))}`
            + `&endAt=${String(Math.floor(request.toMs / 1_000))}`,
    }),
    readPage: (payload: unknown, request): VenueBar[] => [],
}
```

Three things catch everybody:

- **Units.** Fathom works in milliseconds. Several venues take and give seconds.
- **Order.** Return oldest first. Some venues send newest first, and a run in
  the wrong order draws a chart that moves backwards.
- **Field order.** Some venues send `open, close, high, low`, not the usual one.
  Read it wrong and the high sits below the low on every red candle.

Leave `volume`, `buyVolume` and `tradeCount` as `null` where the venue publishes
none. Zero is a real answer here — a bucket nobody traded in is a quiet bucket —
so a venue that publishes nothing must be distinguishable from one that was
quiet. And if the venue names only where a candle opens, leave `closedAtMs`
equal to `openedAtMs`; Fathom fills the edge in from the width it asked for.

### Installing it

Save. The venue appears among the others in the contract picker and is asked
what it trades straight away. Star a pair to keep it in a list.

It is kept as the source you wrote, so it is there again next week — and so you
can read what you installed before it runs again.

### What a connector cannot do yet

- **Only GET.** A connector names a URL. A venue that hands out its socket
  through a POST for a short-lived URL cannot be streamed from — which is why
  the KuCoin example declares `book: null`.
- **The chart, not the collector.** A connector you install lives in your
  browser, so the server that records order books cannot see it. A venue brought
  in this way gives you a listing and a past, not a recording.
- **A page alone cannot reach most venues.** Almost none publish the header a
  browser needs to read them cross-origin. Where Fathom has a server, requests
  go through it — https only, no redirects, and nothing on the server's own
  network reachable. In the browser-only build there is nobody to ask, so only a
  venue that lets a page in can be read.
- **A linked book only.** The grade a connector declares is recorded but not yet
  acted on: the mirror still needs the back reference the shipped venue
  publishes.

A worked one, tests and all:
[`src/addons/kucoin`](https://github.com/giovani-freitag/fathom-example-addons/tree/main/src/addons/kucoin).

---

The design behind all of this — what was decided and what it cost — is in
[ADR 23](/en/adr/0023-a-reader-writes-an-indicator-in-the-page.md) for readings
and [ADR 25](/en/adr/0025-a-reader-brings-the-venue-as-well-as-the-indicator.md)
for connectors.
