# Writing an indicator

Worked examples, in two columns: **today**, which is the shape the twenty-odd
shipped readings are written in and which runs right now, and **proposed**,
which is the surface a reader's own script would be written against.

The proposed column is not built. It is here to be approved, changed or thrown
out before anything is written, which is the point of the document. See
[ADR 23](adr/0023-a-reader-writes-an-indicator-in-the-page.md) for why the
platform is shaped the way it is, and [ADR 22](adr/0022-an-indicator-declares-the-rungs-it-reads.md)
for the rung declaration the second recipe depends on.

Both columns produce the same picture. Every "today" snippet below is a
condensed version of code in `src/app/indicators/` that is under test.

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

### 1 — proposed

```ts
import { Indicator, Plot } from 'fathom';

export default class Delta extends Indicator {
    name = 'Delta';
    about = 'Net size that crossed the spread in each bar';

    draw(bars) {
        return Plot.histogram(bars.map((bar) => bar.bought - bar.sold))
            .named('Delta')
            .risingAndFalling()
            .inItsOwnBand({ centredOnZero: true });
    }
}
```

`risingAndFalling()` is the bid-above / ask-below pair, the zero baseline, the
marked midline and the refusal to be tinted — four decisions that always travel
together and have no reason to be spelled out four times.

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

### 2 — proposed

```ts
import { Indicator, Plot, Session } from 'fathom';

export default class Pivots extends Indicator {
    name = 'My pivots';

    // Fetched by the host and handed back settled, never still forming.
    reads = [Session.daily.reachingBack(2)];

    draw(bars, sessions) {
        const yesterday = sessions.daily.settledFor(bars);

        return Plot.lines({
            Pivot: yesterday.map((one) => one.centre),
            R1: yesterday.map((one) => 2 * one.centre - one.low),
            S1: yesterday.map((one) => 2 * one.centre - one.high),
        })
            .brokenBetweenSessions()
            .overThePrice();
    }
}
```

`settledFor` is what `perBar` already is: one entry per drawn bar, holding the
newest session that had *closed* by then. The proposal only renames it.
Getting this wrong is the one mistake that makes an indicator look brilliant on
history and lose money live, so it is not something an author should be able to
write by hand.

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

### 3 — proposed

```ts
params = {
    period: Params.whole('Period').between(2, 400).default(20),
    source: Params.oneOf('Source', ['close', 'open', 'hl2']).default('close'),
    filled: Params.toggle('Fill the band').default(true),
};

draw(bars, sessions, { period, source }) { ... }
```

Values arrive clamped to the declared range, as they do today: a setting outlives
the control that produced it, so a figure no current control could produce still
has to arrive safely.

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

### 4 — proposed

```ts
bars.map((bar) => bar.mid)          // one number per bar
bars.closes                          // the common ones without a callback
bars.sma(20)                         // the arithmetic already in series-math
bars.segments                        // runs unbroken by a recording gap
```

`bars` stays ordered oldest-first and stays the drawn rung. Warm-up bars are at
the front and are counted, not hidden — a reading that cannot say where it has
converged draws a line that looks settled and is not.

---

## 5. Saying you have nothing to draw

A reading whose window is too short, or whose rung the venue could not answer,
must draw blank and say so rather than draw something.

### 5 — today

```ts
return { /* ... */ hasConverged: didDrawAny };
```

### 5 — proposed

```ts
if (!yesterday.any()) {
    return Plot.nothing('No session has closed inside this window');
}
```

---

## The decisions this is asking about

1. **A class extending `Indicator`**, rather than a plain object with the right
   keys. Recommended: it gives the editor something to complete against from the
   first keystroke, and `extends` is the one word that tells an author where to
   look for what else is available.

2. **A fluent plot builder**, rather than returning the plan object literally.
   Recommended: the literal has eleven keys of which an author cares about two,
   and every one of the other nine is a way to be quietly wrong.

3. **Bars as a collection with the common arithmetic on it**, rather than a plain
   array. Recommended, with a caution: it is the surface most likely to grow
   without limit, and the line to hold is that it carries what the shipped
   readings needed and nothing speculative.

4. **`reads = [Session.daily...]` for a coarser rung**, resolved by the host and
   handed back already settled. Recommended, and the piece that matters most —
   it is where a hand-written version goes wrong invisibly.

5. **One barrel, `fathom`.** Nothing outside it is public, and nothing inside it
   is promised across versions. A script that stops running after an upgrade
   reports the engine's own error and is reprocessed.

Approve, amend or reject each. Nothing here is written yet.
