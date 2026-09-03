import {
    type ChoiceParameter,
    type Indicator,
    type IndicatorInput,
    type IndicatorParameter,
    type PlanDraft,
    type PlotScale,
    readChoice,
    type SourceRequest,
} from '../../../shared/core/draw-plan.ts';
import { collectInstants, createBlankValues } from '../shared/series-math.ts';
import type { PriceBar } from '../../../shared/core/price-bar.ts';

const DAY_MS = 86_400_000;

/**
 * Where the running total starts over.
 *
 * The session is what a reader means by "the VWAP": a level the day's trading
 * has agreed on, which says nothing once it carries yesterday with it. The
 * window is for reading one stretch on its own terms.
 */
const ANCHOR: ChoiceParameter = {
    name: 'vwapAnchor',
    kind: 'choice',
    defaultValue: 'session',
    choices: ['session', 'window'],
};

/**
 * The average price weighted by what traded at it.
 *
 * The one average on this chart that knows how much changed hands: a mean of
 * closes treats a bar nobody traded in as it treats the day's heaviest, and
 * this does not.
 */
export class VolumeWeightedAverage implements Indicator {
    readonly label = 'indicator.vwap';
    readonly about = 'indicator.vwap.help';
    readonly scale: PlotScale = { kind: 'price' };
    readonly parameters: readonly IndicatorParameter[] = [ANCHOR];

    /**
     * Bars needed before the window, which is as many as it can be given.
     *
     * The running total starts at the anchor, so a window opening mid-session
     * needs everything back to the session's first bar to say anything true.
     *
     * @returns One, the smallest a window can be asked for.
     */
    resolveSources(): SourceRequest {
        return { warmupBars: 1 };
    }

    /**
     * Divides what traded by how much, from the anchor forward.
     *
     * @param input - The bars, the warm-up count, and the parameters.
     * @returns One line, restarting at each anchor.
     */
    compute(input: IndicatorInput): PlanDraft {
        const bars = input.bars.bars;
        const isSessionAnchored = readChoice(input.settings, ANCHOR) === 'session';
        const value = createBlankValues(bars.length);

        let tradedValue = 0;
        let tradedSize = 0;
        let anchorDay = -1;
        let didFindAnchor = !isSessionAnchored;

        for (const [index, bar] of bars.entries()) {
            const day = Math.floor(bar.openedAtMs / DAY_MS);
            if (isSessionAnchored && day !== anchorDay) {
                tradedValue = 0;
                tradedSize = 0;
                didFindAnchor = didFindAnchor || anchorDay !== -1;
                anchorDay = day;
            }

            const size = bar.buyVolume + bar.sellVolume;
            tradedValue += typicalPrice(bar) * size;
            tradedSize += size;
            // A stretch nobody traded in has no weighted average; carrying the
            // last one forward would draw a level the market never agreed on.
            if (tradedSize > 0) {
                value[index] = tradedValue / tradedSize;
            }
        }

        return {
            series: [{
                label: this.label,
                tone: 'ink',
                shape: 'line',
                atMs: collectInstants(bars),
                value,
            }],
            // Anchored to a session the window does not reach back to, the total
            // starts wherever the window happens to, which is not the session.
            hasConverged: didFindAnchor,
        };
    }
}

/**
 * The one price a bar is weighted at.
 *
 * The mean of the high, the low and the close, which is the convention
 * everywhere: the close alone would ignore where the bar actually traded.
 */
function typicalPrice(bar: PriceBar): number {
    return (bar.highPrice + bar.lowPrice + bar.closePrice) / 3;
}

export const VOLUME_WEIGHTED_AVERAGE = new VolumeWeightedAverage();
