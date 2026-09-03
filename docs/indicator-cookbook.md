# Writing an indicator

Worked examples, in two columns: **today**, which is the shape the nineteen
shipped readings are written in, and **in the page**, which is what a reader's
own script is written against.

Both run. The second column is the barrel at `src/shared/core/addon-api.ts`,
which the in-page editor compiles against and the palette offers alongside
what the build ships. What is *not* built is marked as such where it appears. See
[ADR 23](adr/0023-a-reader-writes-an-indicator-in-the-page.md) for why the
platform is shaped the way it is, and [ADR 22](adr/0022-an-indicator-declares-the-rungs-it-reads.md)
for the rung declaration the second recipe depends on.

Both columns produce the same picture — literally, and there is a test that
says so: `tests/unit/shared/plot-builder.test.ts` builds the first recipe both
ways and asserts the two drafts are the same object.

---

## 1. The delta of each bar

What was bought minus what was sold, as one histogram either side of nought.

### 1 — today

```ts
export class VolumeDelta implements Indicator {
    readonly label = 'indicator.delta';
    readonly about = 'indicator.delta.help';
    readonly scale: PlotScale = { kind: 'symmetric' };
    readonly isSelfColoured = true;
    readonly parameters: readonly IndicatorParameter[] = [];

    resolveWarmupBars(): number {
        return 0;
    }

    compute(input: IndicatorInput): PlanDraft {
        const bars = input.bars.bars;
        const value = createBlankValues(bars.length);
        for (const [index, bar] of bars.entries()) {
            value[index] = bar.buyVolume - bar.sellVolume;
        }

        return {
            series: [{
                label: this.label,
                tone: 'bid',
                negativeTone: 'ask',
                shape: 'histogram',
                baseline: 0,
                atMs: collectInstants(bars),
                value,
            }],
            levels: [{ value: 0, tone: 'muted' }],
        };
    }
}
```

### 1 — in the page

```ts
import { Plot } from 'fathom';
import type { Indicator, IndicatorInput, PlanDraft } from 'fathom';

export default class Delta implements Indicator {
    readonly label = 'Delta';
    readonly about = 'Net size that crossed the spread in each bar';
    readonly parameters = [];

    compute(input: IndicatorInput): PlanDraft {
        const bars = input.bars.bars;

        return Plot.over(input.bars)
            .histogram(bars.map((bar) => bar.buyVolume - bar.sellVolume), 'Delta')
            .risingAndFalling()
            .at(0)
            .aboutZero();
    }
}
```

`risingAndFalling()` is the bid-above / ask-below pair and the zero baseline in
one call — decisions that always travel together and have no reason to be
spelled out twice. `Plot.over` binds the instants once, so no series can be
misaligned with the bars; one that does not line up throws by name rather than
being dropped in silence.

---

## 2. Pivot points

Levels the previous session settled on, held flat across this one. The whole of
the multi-timeframe question in one reading.

### 2 — today

```ts
resolveSources(settings: IndicatorSettings): SourceRequest {
    return {
        sessions: {
            [SESSION]: { intervalMs: resolvePeriodMs(settings), reachingBack: 2 },
        },
    };
}

compute(input: IndicatorInput): PlanDraft {
    const session = readSessions(input, SESSION);
    for (const [index, settled] of session.perBar.entries()) {
        if (settled === undefined || session.turnsOver[index] === 1) {
            continue;
        }
        // ... one PivotSet per settled session, spread across the bars that followed
    }
}
```

The host runs `holdLastClosed` before `compute` is entered, so `perBar` is
already one entry per drawn bar holding the newest session that had *closed*.
There is no raw coarse window to reach into and no index that reaches forward.

### 2 — in the page

```ts
import { Plot, readSessions } from 'fathom';
import type { Indicator, IndicatorInput, PlanDraft, SourceRequest } from 'fathom';

const DAY_MS = 86_400_000;

export default class Pivots implements Indicator {
    readonly label = 'My pivots';
    readonly parameters = [];

    // Fetched by the host and handed back settled, never still forming.
    resolveSources(): SourceRequest {
        return { sessions: { daily: { intervalMs: DAY_MS, reachingBack: 2 } } };
    }

    compute(input: IndicatorInput): PlanDraft {
        const daily = readSessions(input, 'daily');
        const centre = daily.perBar.map((one) => (
            one === undefined ? Number.NaN : (one.highPrice + one.lowPrice + one.closePrice) / 3
        ));

        return Plot.over(input.bars)
            .lines({
                Pivot: centre,
                R1: centre.map((value, index) => 2 * value - (daily.perBar[index]?.lowPrice ?? Number.NaN)),
                S1: centre.map((value, index) => 2 * value - (daily.perBar[index]?.highPrice ?? Number.NaN)),
            })
            .namingEachLine()
            .overThePrice();
    }
}
```

`perBar` is one entry per drawn bar, holding the newest session that had
*closed* by then. The host applies `holdLastClosed` before `compute` is
entered, so there is no raw coarse window to reach into and no index that
reaches a session a drawn bar could not have seen. Getting this wrong is the one
mistake that makes an indicator look brilliant on history and lose money live,
so it is not something an author can write by hand.

`daily.turnsOver[index] === 1` marks the first bar after a session changed, for
breaking the lines between sessions rather than ramping from one to the next.

---

## 3. A parameter a reader can turn

### 3 — today

```ts
const PERIOD: NumericParameter = {
    name: 'periodBars',
    kind: 'number',
    defaultValue: 20,
    minimum: 2,
    maximum: 400,
    isIntegral: true,
};

const bars = readSetting(input.settings, PERIOD);
```

### 3 — in the page

```ts
import { Params, readChoice, readSetting, readToggle } from 'fathom';

const PERIOD = Params.integer('periodBars').called('Period').between(2, 400).startingAt(20);
const SOURCE = Params.choice('source', ['close', 'open', 'hl2']).called('Source');
const FILLED = Params.toggle('filled').called('Fill the band').startingAt(true);

readonly parameters = [PERIOD, SOURCE, FILLED];

compute(input: IndicatorInput): PlanDraft {
    const period = readSetting(input.settings, PERIOD);
    const source = readChoice(input.settings, SOURCE);
    const filled = readToggle(input.settings, FILLED);
    // ...
}
```

Each step returns a whole, valid parameter, so there is no closing call to
forget. Values arrive clamped to the declared range: a setting outlives the
control that produced it, so a figure no current control could produce still has
to arrive safely.

---

## 4. Reading the bars

### 4 — today

```ts
const bars = input.bars.bars;
const value = createBlankValues(bars.length);
for (const [index, bar] of bars.entries()) {
    value[index] = (bar.highPrice + bar.lowPrice) / 2;
}
```

### 4 — in the page

```ts
import { collectSource, findContinuousSegments, SOURCE } from 'fathom';

const bars = input.bars.bars;               // ordered oldest-first, the drawn rung
const values = collectSource(bars, input.settings);   // the source the reader chose
const runs = findContinuousSegments(bars);  // stretches unbroken by a recording gap
```

The arithmetic the shipped readings use is on the surface as it stands rather
than repackaged: `collectSource`, `findContinuousSegments`, `fillExponential`,
`fillWilder`, `collectTrueRanges`, `smoothWilder`. **Not built:** the sugar
(`bars.closes`, `bars.sma(20)`, `bars.segments`) — every reading restarts at a
gap boundary today by calling `findContinuousSegments` itself.

---

## 5. Saying you have nothing to draw

A reading whose window is too short, or whose rung the venue could not answer,
must draw blank and say so rather than draw something.

### 5 — today

```ts
return { /* ... */ hasConverged: didDrawAny };
```

### 5 — in the page

```ts
const daily = readSessions(input, 'daily');

return Plot.over(input.bars)
    .lines({ /* ... */ })
    .converged(daily.hasAny)
    .overThePrice();
```

`hasAny` is false when no session had closed by any drawn bar, and `converged`
is what puts the warning on the legend. **Not built:** a message of the
author's own — the host says the reading has not converged, not why.

Reaching for a session that was never declared throws by name, listing what
*was* declared. That is the one failure this design refuses to make silent.

---

## What was decided, and what it cost

1. **A class implementing `Indicator`** — rather than `extends`. `implements`
   needs no base class to import, so an addon and a shipped reading are the same
   shape rather than one being a subclass of the other's machinery. The editor
   completes from the first keystroke either way, off the `.d.ts` the barrel is
   generated into.

2. **A fluent plot builder that returns the plan object.** Not a translation:
   `tests/unit/shared/plot-builder.test.ts` asserts the built draft equals the
   hand-written one. Anything the builder does not cover is reachable by writing
   the object, in the same file, with no round trip.

3. **The arithmetic as functions, not as methods on `bars`.** Reversed from the
   recommendation. A collection type would have to be constructed on both sides
   of a worker boundary, and it is the surface most likely to grow without limit;
   plain functions over a plain array cost an import and nothing else.

4. **One `resolveSources`, returning what it reads by name.** Warm-up and coarser
   sessions were the same question — what must be in hand before this can run —
   and merging them cost nothing. Sessions arrive already held back to what each
   drawn bar could know, which is the piece that matters most.

5. **One barrel, `fathom`.** Nothing outside it is public and nothing inside it
   is promised across versions. A script that stops running after an upgrade
   reports the engine's own error and is reprocessed.

### Still open

- **The book, the executions and the gaps.** An addon still reaches only the
  bars and the sessions — the one dataset this project alone has is not on the
  surface. `COOKBOOK-RASCUNHO.md` has the design; nothing is built.
- **Where it runs.** Inline, on the main thread, like the shipped readings. A
  runaway loop in a reader's script takes the tab with it; a worker would not,
  and would cost a two-phase `computePlans`.
- **More than one at a time.** The editor holds one draft. The registry takes
  any number.
