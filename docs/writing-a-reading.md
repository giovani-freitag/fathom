# Writing a reading

A **reading** is an indicator you write yourself, in the page, against the same
surface the shipped ones use. It compiles as you type, draws on the chart beside
the editor, and never leaves your browser.

This guide goes from the smallest reading that works to the parts you will reach
for last. Every example here compiles.

- [1. The smallest reading that works](#1-the-smallest-reading-that-works)
- [2. The five parts](#2-the-five-parts)
- [3. What you are given](#3-what-you-are-given)
- [4. Drawing](#4-drawing)
- [5. Knobs the reader can turn](#5-knobs-the-reader-can-turn)
- [6. What the chart must fetch first](#6-what-the-chart-must-fetch-first)
- [7. A coarser session](#7-a-coarser-session)
- [8. More than one file](#8-more-than-one-file)
- [9. Two languages](#9-two-languages)
- [10. Seeing what actually arrived](#10-seeing-what-actually-arrived)
- [11. Sharing one](#11-sharing-one)
- [12. Everything on the surface](#12-everything-on-the-surface)
- [13. What a reading cannot do](#13-what-a-reading-cannot-do)

Worked examples you can open in one press:
[github.com/giovani-freitag/fathom-readings](https://github.com/giovani-freitag/fathom-readings)
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

**Budget:** at most 8 series and 8192 points each. `isPlanWithinBudget` checks a
plan if you want to know before the chart does.

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

previous.hasAny            // false where nothing had settled by any drawn bar
previous.perBar[index]     // the newest session that had closed by that bar's open
previous.turnsOver[index]  // 1 where this bar is the first after the turn
```

**`perBar` is the whole point.** It is aligned to the drawn bars and held back to
what each one could know, so there is no index that reaches a session a drawn
bar could not have seen. A reading written against it cannot repaint.

`perBar[index]` is `undefined` at the left edge, before anything had settled.
`?? Number.NaN` is the usual answer.

Reaching for a name you never declared throws, and says which names you did
declare. That is the one failure this design refuses to make silent.

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
for a folder. Write the ending or leave it off — `./maths/mean`, `./maths/mean.ts`
and `./maths/mean.js` all find the same file, the last because that is how
TypeScript has you write an import.

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

---

The design behind all of this — what was decided and what it cost — is in
[ADR 23](adr/0023-a-reader-writes-an-indicator-in-the-page.md).
