import { describe, expect, it } from 'vitest';
import { collectSource, readBarSource } from '../../../../../src/app/indicators/shared/bar-source.ts';
import { buildBar, buildRun, buildWindow } from '../../../../mocks/price-bars.ts';
import { EXPONENTIAL_AVERAGE } from '../../../../../src/app/indicators/exponential-average/exponential-average.ts';

const BAR = buildBar(0, 40, { openPrice: 10, highPrice: 60, lowPrice: 20 });

describe('readBarSource', () => {
    it('reads each corner of the bar', () => {
        expect(readBarSource(BAR, 'open')).toBe(10);
        expect(readBarSource(BAR, 'high')).toBe(60);
        expect(readBarSource(BAR, 'low')).toBe(20);
        expect(readBarSource(BAR, 'close')).toBe(40);
    });

    it('blends the corners the conventional ways', () => {
        expect(readBarSource(BAR, 'hl2')).toBe(40);
        expect(readBarSource(BAR, 'hlc3')).toBe(40);
        expect(readBarSource(BAR, 'ohlc4')).toBe(32.5);
    });
});

describe('collectSource', () => {
    it('falls back to the close when the stored choice means nothing', () => {
        // A choice outlives the control that produced it, and a build that has
        // dropped one must not answer with nothing.
        const bars = [BAR];

        expect([...collectSource(bars, { source: 'vwap' })]).toEqual([40]);
        expect([...collectSource(bars, {})]).toEqual([40]);
    });

    it('changes what an indicator reads', () => {
        const bars = buildWindow(buildRun(60, (index) => 100 + index));
        const settings = { periodBars: 10 };

        const onClose = EXPONENTIAL_AVERAGE.compute({ bars, sessions: {}, settings });
        const onHigh = EXPONENTIAL_AVERAGE.compute({
            bars,
            sessions: {},
            settings: { ...settings, source: 'high' },
        });

        // The run builds each bar one either side of its close.
        expect(onHigh.series[0]!.value.at(-1)!).toBeCloseTo(onClose.series[0]!.value.at(-1)! + 1, 6);
    });
});
