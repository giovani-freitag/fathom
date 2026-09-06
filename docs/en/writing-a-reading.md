# Writing an indicator

## Introduction

An indicator you write yourself uses the exact same interface as the nineteen
that ship with Fathom. There is no plugin API and no second-class surface: what
you write and what ships are the same shape.

You write it in the page. Press **Write a reading** in the toolbar and an editor
opens beside the chart. It compiles as you type, and what it draws appears on
the chart next to it.

This guide starts with the smallest indicator that works and builds up to the
parts you will reach for last. Every example here compiles.

::: tip Learn from working code
The [example addons repository](https://github.com/giovani-freitag/fathom-example-addons)
holds several complete indicators, with tests. They are typechecked against this
exact surface on every push, so nothing there is a snippet that used to work.
:::

## Your first indicator

Here is a complete, working indicator. It draws the midpoint of every bar.

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

Press **Write a reading**, paste it, and it draws.

Three things are true of every indicator you write:

- It lives in **`main.ts`**, and its **default export** is the indicator.
- It may import from **`'fathom'`** and from its own files. Nothing else
  resolves.
- **`compute` is arithmetic.** It runs again on every new bar, every pan and
  every zoom, so it must never fetch, wait, or remember anything between calls.

## The shape of an indicator

An indicator is a class with up to five members. Two are required.

```ts
export default class MyIndicator implements Indicator {
    readonly label = 'My indicator';         // required — what the chart calls it
    readonly about = 'One line about it';    // optional — shown when picking a layer
    readonly parameters = [];                // required — the knobs, possibly none
    readonly scale = { kind: 'price' };      // optional — usually decided for you

    resolveSources(settings) { … }           // optional — what to fetch first
    compute(input) { … }                     // required — the arithmetic
}
```

Notice `implements Indicator` rather than `extends` something. There is no base
class to import. An indicator you write is the same shape as one that ships.

`label` appears in the legend and in the layer list. `about` is the single line
shown under the name when a reader is choosing what to add. Both are plain
strings — see [Two languages](#two-languages) if you want them translated.

## What compute receives

`compute` is handed one object:

```ts
interface IndicatorInput {
    readonly bars: PriceBarWindow;
    readonly settings: IndicatorSettings;
    readonly sessions: Readonly<Record<string, SettledSessions>>;
}
```

### The bars

`input.bars.bars` is the array of bars, oldest first. Each one looks like this:

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

`buyVolume` and `sellVolume` are the pair most charts do not have. A zero in
either is a real answer: it means a bucket the book was recorded through with
nobody trading on that side.

When `frameCount` falls short of `expectedFrames`, the bar was built from less
than it should have been. That is a gap in the recording, not a quiet market.
Call `classifyBar` when you need to tell the two apart.

`input.bars` also carries `instrumentSymbol` and `intervalMs`.

### One value per bar

Every series you plot must have exactly one value for every bar in
`input.bars.bars`. Hand back a different length and the plan builder throws,
telling you what it got and what it expected.

When you have no answer for a bar, use `Number.NaN`. It breaks the line at that
point rather than drawing a straight segment across the gap.

## Drawing

`Plot.over(input.bars)` starts a plan. You add series to it, style them, and
finish by saying where the plan goes. That last call returns the plan, so it
always ends the chain.

### Series

```ts
Plot.over(input.bars)
    .line(values, 'Mean')            // a joined line
    .histogram(values, 'Delta')      // bars from a baseline
    .dots(values, 'Stop')            // marks that are not joined up
    .lines({ Upper: a, Lower: b })   // several lines at once, in order
```

Reach for `dots` when your indicator flips from one side of the price to the
other. Joining the marks would draw a stroke straight through the price at every
flip, which is a move the indicator never made.

### Styling what you just added

Each styling call applies to the series added immediately before it.

```ts
    .in('amber')          // a palette token, never a CSS colour
    .dashed()
    .thick(2)
    .risingAndFalling()   // split by side about a baseline, defaulting to zero
```

The tones are `bid`, `ask`, `amber`, `phosphor`, `violet`, `cyan`, `ink` and
`muted`.

Leave the colour off entirely and the reader picks it in the layer list. That is
what most indicators should do — it keeps them legible when the theme changes.

### Levels and shading

```ts
    .at(70, 'muted')            // a horizontal line at a constant
    .shading(0, 1, 'amber')     // fill between two series, by the order added
    .namingEachLine()           // write each series' name at the end of its line
```

### Where the plot goes

One of these ends the chain.

```ts
    .overThePrice()        // on the price itself
    .inItsOwnBand()        // a band below, scaled to what the values reach
    .between(0, 100)       // a band pinned to a fixed range
    .aboutZero()           // a band centred on zero
    .alongTheFloor(0.2)    // a strip along the bottom of the price pane
```

`alongTheFloor` costs the price pane no height, only some of its floor. It is
what the built-in volume indicator uses.

Two more calls turn up occasionally:

```ts
    .summarisedAs('20, close')   // what the legend says about the settings
    .converged(false)            // see Coarser sessions, below
```

### The budget

A plan may hold at most **8 series of 8192 points each**. A plan over that is
refused whole rather than quietly clipped, and the editor's footer tells you
which limit you passed.

That message only appears while the indicator is open in the editor, so
`isPlanWithinBudget` is available if you want to check a plan yourself.

## Parameters

A parameter is built once, outside the class. The object you build is both what
the settings panel renders and what you read the value back with.

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

Read them inside `compute`:

```ts
const periodBars = readSetting(input.settings, PERIOD);   // number
const deviations = readSetting(input.settings, BAND);     // number
const mode = readChoice(input.settings, MODE);            // string
const isFilled = readToggle(input.settings, FILL);        // boolean
```

Finally, list every parameter you built in `readonly parameters`, in the order
you want them shown:

```ts
readonly parameters = [PERIOD, BAND, MODE, FILL];
```

::: warning Choices are stored as written
A choice's values are shown to the reader exactly as you wrote them, so keep
them readable. Keep them stable too: the string is what gets saved, so renaming
one loses the setting of anyone who had picked it.
:::

## Warm-up bars

A mean over twenty bars needs nineteen bars of history before the first drawn
one, or the left edge is blank where it need not be.

Ask for them, and Fathom fetches them. They arrive as part of `input.bars`, and
the drawn window does not change.

```ts
resolveSources(settings: IndicatorSettings): SourceRequest {
    return { warmupBars: readSetting(settings, PERIOD) };
}
```

Ask for what you actually read, and no more. An indicator that declares warm-up
it never uses reports itself unconverged whenever the recording begins
mid-window, which is a warning about nothing.

## Coarser sessions

Say your indicator draws on one-minute bars but needs yesterday's close. Declare
the coarser session under a name of your own:

```ts
resolveSources(): SourceRequest {
    return { sessions: { previous: { intervalMs: 86_400_000, reachingBack: 1 } } };
}
```

`reachingBack` is how many settled sessions you need before the window opens.

### Reading a session back

```ts
const previous = readSessions(input, 'previous');

previous.hasAny             // false where nothing had settled by any drawn bar
previous.perBar[index]      // the newest session that had closed by that bar's open
previous.turnsOver[index]   // 1 where this bar is the first after the turn
previous.closed             // every settled session, oldest first
previous.indexPerBar[index] // where in `closed` this bar's own session sits
```

All five are held back to what each drawn bar could know. There is no index here
that reaches a session a drawn bar could not have seen, which means an indicator
written against them **cannot repaint**.

`perBar[index]` is `undefined` at the left edge, before anything had settled.
`?? Number.NaN` is the usual answer.

Reaching for a name you never declared throws, and the message lists the names
you did declare. That is the one failure this design refuses to make silent.

### Computing over the coarser run

`perBar` answers *what did this bar know*, which is a single session. For a
mean, a range, or anything else with a memory, you need the whole run. That is
`closed`, and `indexPerBar` tells you where each drawn bar sits in it.

```ts
const period = 50;
const held = readSessions(input, 'previous');

// Computed once over the run, then held at each drawn bar: a step, because the
// coarser mean did not move between closes.
const means = exponentialMean(held.closed.map((bar) => bar.closePrice), period);
const perBar = [...held.indexPerBar]
    .map((at) => (at < 0 ? Number.NaN : means[at] ?? Number.NaN));
```

`closed` reaches back by exactly `reachingBack` sessions, so ask for a multiple
of your period rather than for one. `reachingBack: period * 8` hands a
fifty-period mean four hundred closes, and it costs the same single request per
rung as asking for one would. Nothing still forming is ever in there.

::: tip There is no monthly rung
Which widths a venue publishes is a fixed list: a minute, five, fifteen, thirty,
an hour, two, four, a day, a week. A month cannot be on it — the list is keyed by
a width in milliseconds, and a month has no fixed one.
:::

### Saying you have nothing yet

```ts
    .converged(previous.hasAny)
```

The legend then marks your indicator as not yet converged, rather than letting a
blank line read as a flat one.

## Splitting into files

Press the **new-file** button in the toolbar and name it. An indicator always
starts at `main.ts`; everything else is yours to arrange.

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

You may use relative paths only, and only within your own indicator: `./`, `../`
and `index.ts` for a folder.

::: warning End your imports in `.js`, or in nothing
`./maths/mean` and `./maths/mean.js` both find `maths/mean.ts`. The second is how
TypeScript has you write an import. Ending it in `.ts` is the one form the
compiler refuses, and the editor will tell you so.
:::

Each file runs once, however many others ask for it. Two files that import each
other get whatever the other has exported so far, rather than looping forever. A
file that throws is not kept, so the next import runs it again and throws again.

`'fathom'` is the only other thing that resolves. **There is no npm here.**

A file you delete is offered back for a few seconds, the same way a deleted
indicator is.

## Two languages

The interface speaks two. Because an indicator names itself, it can answer in
both:

```ts
import { inWords } from 'fathom';

readonly label = inWords({ en: 'My mean', 'pt-BR': 'Minha média' });
```

`en` is required, and is what any language you did not write falls back to.

This works anywhere in the file — a field, a parameter label, a series name.
Changing the language rebuilds every indicator from the JavaScript it was saved
as, so the whole file runs again with the new language in force.

## Debugging

`console.log` works. It prints to the **Console** panel below the editor rather
than to the browser's own.

```ts
console.log('bars', input.bars.bars.length, 'first', input.bars.bars[0]);
```

Series print with their length, like `Float64Array(43) [81176.4, …31 more]`.
Lists show their first twelve and count the rest. Objects are opened two levels
deep.

Remember that `compute` runs again on every bar, pan and zoom, so a line printed
inside it arrives constantly. Fathom handles that for you: a line printed twice
in a row shows once with a count beside it, only the last 200 are kept, and when
more than one indicator is printing, each line is named.

`warn` and `error` are marked. `info` and `debug` read as `log`. Nothing else
from the real console is offered.

## Sharing an indicator

**Exporting.** An indicator of one file exports as a `.ts`. One of several files
exports as a `.fathom.json` holding all of them, which is also what it opens
from.

**Importing a file.** The open button takes a `.ts`, a `.tsx` or a bundle.

**Importing from a repository or a package.** The cloud button takes addresses
like these:

```text
gh/user/repo                       the newest tag, or the default branch
gh/user/repo@main/readings/mean    a branch, and a folder within it
npm/@someone/reading@1.2.0
```

An address copied straight out of GitHub or npm works too.

Fathom takes the `.ts` and `.tsx` files under the folder you named — up to forty
of them and 512 kB, entry `main.ts` or `index.ts`, with `.d.ts` left out — and
opens them as one indicator, marked unsaved.

You are shown the file list and where it came from before a single byte is
fetched, and Fathom then fetches exactly what it showed you. Every file is
checked against the size and the hash the listing gave.

::: danger What you import is somebody else's code
It runs in this page as soon as it opens, the same way your own does. Only bring
in what you would be willing to run yourself.
:::

## The full surface

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

### Arithmetic the shipped indicators use

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

The connector base class and its types are on the same surface — see
[Writing a connector](/en/writing-a-connector).

## What an indicator cannot do

Stated plainly, because finding out by trying is worse.

- **No npm.** Nothing outside `'fathom'` and your own files resolves. A package
  whose code imports anything else will not build, and the editor says which
  import it could not find.
- **No fetching, no timers, no state between calls.** `compute` is called again
  on every redraw, so anything it remembers is a bug waiting for a pan.
- **No book, no executions, no gaps.** An indicator reaches the bars and the
  sessions. The order-book field this chart is built around is not on the
  surface yet.
- **No sandbox.** An indicator runs in the page, on the main thread, exactly
  like the built-in ones. It can reach a global if it goes looking, and a
  runaway loop takes the tab with it.
- **No colour of its own.** Tones come from the palette, so an indicator stays
  legible when the theme changes.
- **Nothing promised across versions.** The surface is one barrel and it may
  change. An indicator that stops building after an upgrade reports the
  compiler's own error, and the source is still yours.

::: warning Where your work is kept
Saved indicators live in your browser's local storage. That is convenient and it
is not durable: clearing site data, a full disk, or a different browser will not
have them. Export anything you want to keep.
:::

---

The reasoning behind all of this is in
[ADR 23](/en/adr/0023-a-reader-writes-an-indicator-in-the-page).
