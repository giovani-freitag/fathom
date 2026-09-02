import {
    type DrawPlan,
    type Indicator,
    type IndicatorInput,
    type IndicatorParameter,
    type PlotScale,
} from '../../../shared/core/draw-plan.ts';
import { collectInstants, createBlankValues } from '../shared/series-math.ts';

/**
 * What the aggressors did in each bar, as one figure.
 *
 * The same arithmetic the running total is built from, left un-added: how much
 * more was bought than sold at market inside this bucket and no other. Where
 * the total answers what the session has been doing, this answers what the
 * last bar did, which is the question a reader watching the live edge is
 * actually asking.
 *
 * Drawn as one bar rather than two. Bought and sold as separate columns is the
 * same picture the volume reading already gives, and reading a difference off
 * two heights is work the eye should not be doing: the difference is the
 * reading, so the difference is what is drawn.
 */
export class VolumeDelta implements Indicator {
    readonly id = 'delta';
    readonly labelKey = 'indicator.delta';
    // Symmetric so a bar bought and a bar sold of the same size are the same
    // height. Scaled to their own extents, an aggressive session would draw its
    // buying and its selling alike and the imbalance would be invisible.
    readonly scale: PlotScale = { kind: 'symmetric' };
    // The colour is the reading — above nought was bought, below was sold — so
    // a copy tinted to tell it from another copy would say something false.
    readonly isSelfColoured = true;
    readonly parameters: readonly IndicatorParameter[] = [];

    /**
     * Bars needed before the window for the first drawn value to be true.
     *
     * @returns None: each bar is answered from itself.
     */
    resolveWarmupBars(): number {
        return 0;
    }

    /**
     * Takes what was sold off what was bought, bar by bar.
     *
     * @param input - The bars and the parameters.
     * @returns One histogram, growing either side of nought.
     */
    compute(input: IndicatorInput): DrawPlan {
        const bars = input.bars.bars;
        const value = createBlankValues(bars.length);

        // No segment walk, unlike the running total: nothing carries across a
        // hole here, so a bar either side of one is as true as the rest.
        for (const [index, bar] of bars.entries()) {
            value[index] = bar.buyVolume - bar.sellVolume;
        }

        return {
            indicatorId: this.id,
            labelKey: this.labelKey,
            parameterSummary: '',
            scale: this.scale,
            isSelfColoured: this.isSelfColoured,
            series: [{
                labelKey: this.labelKey,
                tone: 'bid',
                negativeTone: 'ask',
                shape: 'histogram',
                baseline: 0,
                atMs: collectInstants(bars),
                value,
            }],
            levels: [{ value: 0, tone: 'muted' }],
            hasConverged: true,
        };
    }
}

export const VOLUME_DELTA = new VolumeDelta();
