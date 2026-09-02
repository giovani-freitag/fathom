import { describe, expect, it } from 'vitest';
import {
    chooseInstanceTone,
    MAXIMUM_STORED_INDICATORS,
    mintInstanceId,
    withIndicatorAdded,
    withIndicatorRecoloured,
    withIndicatorRemoved,
    withIndicatorRestored,
    withIndicatorRetuned,
    withIndicatorVisibility,
} from '../../../../src/shared/core/indicator-selection.ts';
import type { AddedIndicator } from '../../../../src/shared/core/indicator-selection.ts';
import { INSTANCE_TONES } from '../../../../src/shared/core/draw-plan.ts';

const SETTINGS = { periodBars: 20 };

function addTimes(count: number): readonly AddedIndicator[] {
    let added: readonly AddedIndicator[] = [];
    for (let index = 0; index < count; index += 1) {
        added = withIndicatorAdded({ added, indicatorId: 'ema', settings: SETTINGS, tone: chooseInstanceTone(added) });
    }
    return added;
}

describe('indicator revision', () => {
    it('keeps two copies of one indicator apart', () => {
        // The ordinary case, not an edge one: a fast average and a slow one.
        const added = addTimes(2);

        expect(added.map((entry) => entry.instanceId)).toEqual(['ema-1', 'ema-2']);
    });

    it('reuses an id that removing gave back', () => {
        const added = withIndicatorRemoved(addTimes(2), 'ema-1');

        expect(mintInstanceId('ema', added)).toBe('ema-1');
    });

    it('stops adding once the chart is holding all it can draw', () => {
        const full = addTimes(MAXIMUM_STORED_INDICATORS);

        const beyond = withIndicatorAdded({ added: full, indicatorId: 'rsi', settings: SETTINGS, tone: chooseInstanceTone(full) });

        expect(beyond).toHaveLength(MAXIMUM_STORED_INDICATORS);
    });

    it('retunes one copy and leaves its twin alone', () => {
        const added = addTimes(2);

        const retuned = withIndicatorRetuned({ added, instanceId: 'ema-2', name: 'periodBars', value: 50 });

        expect(retuned.map((entry) => entry.settings['periodBars'])).toEqual([20, 50]);
    });

    it('composes revisions, which is what two additions in one frame are', () => {
        // Each revision reads the set the one before it produced. Applying both
        // to the same starting set instead would land the second on top of the
        // first, and the addition would be silently lost.
        const first = withIndicatorAdded({ added: [], indicatorId: 'ema', settings: SETTINGS, tone: 'phosphor' });
        const second = withIndicatorAdded({ added: first, indicatorId: 'rsi', settings: SETTINGS, tone: chooseInstanceTone(first) });

        expect(second.map((entry) => entry.indicatorId)).toEqual(['ema', 'rsi']);
    });
});

describe('indicator colours', () => {
    it('gives each copy a colour nothing else is using', () => {
        const added = addTimes(3);

        expect(new Set(added.map((entry) => entry.tone)).size).toBe(3);
    });

    it('starts reusing colours only once every one is taken', () => {
        // Counted off the rotation rather than a figure written here twice:
        // taking a colour out of it is a decision about what a reading may be
        // drawn in, and it should not also be a failing test about arithmetic.
        const many = addTimes(MAXIMUM_STORED_INDICATORS);

        expect(new Set(many.map((entry) => entry.tone)).size).toBe(INSTANCE_TONES.length);
    });

    it('recolours one copy and leaves its twin alone', () => {
        const added = withIndicatorRecoloured(addTimes(2), 'ema-2', 'cyan');

        expect(added.map((entry) => entry.tone)).toEqual(['phosphor', 'cyan']);
    });
});

describe('undoing a removal', () => {
    it('puts the indicator back in the band it was drawn in', () => {
        // Restoring to the end would move every oscillator below it up a pane,
        // which is not what undoing a removal means.
        const added = [...addTimes(1), ...withIndicatorAdded({ added: addTimes(1), indicatorId: 'rsi', settings: SETTINGS, tone: 'cyan' }).slice(1)];
        const removed = withIndicatorRemoved(added, added[0]!.instanceId);

        const restored = withIndicatorRestored(removed, added[0]!, 0);

        expect(restored.map((entry) => entry.instanceId)).toEqual(added.map((entry) => entry.instanceId));
    });

    it('refuses to restore a copy that is already back', () => {
        const added = addTimes(1);

        expect(withIndicatorRestored(added, added[0]!, 0)).toEqual(added);
    });

    it('refuses to restore into a chart that has since filled up', () => {
        const full = addTimes(MAXIMUM_STORED_INDICATORS);
        const stray = { instanceId: 'rsi-9', indicatorId: 'rsi', settings: SETTINGS, tone: 'cyan' } as const;

        expect(withIndicatorRestored(full, stray, 0)).toHaveLength(MAXIMUM_STORED_INDICATORS);
    });
});

describe('hiding an indicator', () => {
    it('keeps how it was tuned', () => {
        const added = withIndicatorRetuned({ added: addTimes(1), instanceId: 'ema-1', name: 'periodBars', value: 200 });

        const hidden = withIndicatorVisibility(added, 'ema-1', true);

        expect(hidden[0]?.isHidden).toBe(true);
        expect(hidden[0]?.settings['periodBars']).toBe(200);
    });

    it('leaves its neighbours drawing', () => {
        const added = withIndicatorAdded({ added: addTimes(1), indicatorId: 'rsi', settings: SETTINGS, tone: 'cyan' });

        const hidden = withIndicatorVisibility(added, 'ema-1', true);

        expect(hidden.map((entry) => entry.isHidden === true)).toEqual([true, false]);
    });
});

describe('the colours a copy is identified by', () => {
    it('never hands a reading the colour that means the offer side', () => {
        // Red is the ask on the candles, the volume, the delta, the heat ramp
        // and the resistances of a pivot set. A mean has no side, so a mean
        // drawn in it teaches a reader something false.
        const tones = addTimes(MAXIMUM_STORED_INDICATORS).map((entry) => entry.tone);

        expect(tones).not.toContain('ask');
    });

    it('never hands a reading the colour that means the bid side either', () => {
        const tones = addTimes(MAXIMUM_STORED_INDICATORS).map((entry) => entry.tone);

        expect(tones).not.toContain('bid');
    });
});
