import { describe, expect, it } from 'vitest';
import {
    DepthColourScale,
    resolveDepthRange,
    resolveSaturationQuantity,
} from '../../../../../src/app/indicators/book/depth-colour-scale.ts';

function buildScale(gain = 1): DepthColourScale {
    return new DepthColourScale({ saturationQuantity: 100, floorQuantity: 0, gain });
}

describe('DepthColourScale', () => {
    it('maps an empty bucket to the transparent end', () => {
        expect(buildScale().toRampIndex(0)).toBe(0);
    });

    it('maps the saturation quantity to the hot end', () => {
        expect(buildScale().toRampIndex(100)).toBe(255);
    });

    it('never exceeds the hot end for a quantity above saturation', () => {
        expect(buildScale().toRampIndex(10_000)).toBe(255);
    });

    it('increases monotonically with resting size', () => {
        const scale = buildScale();
        const indices = [1, 5, 20, 50, 90].map((quantity) => scale.toRampIndex(quantity));

        expect(indices).toEqual([...indices].sort((left, right) => left - right));
    });

    it('keeps a typical bucket well below the warm half of the ramp', () => {
        expect(buildScale().toRampIndex(4.5)).toBeLessThan(64);
    });

    it('brightens a bucket when gain rises', () => {
        expect(buildScale(3).toRampIndex(10)).toBeGreaterThan(buildScale(1).toRampIndex(10));
    });

    it('builds a ramp of 256 four-byte entries', () => {
        expect(DepthColourScale.ramp().length).toBe(1_024);
    });

    it('reuses one ramp across instances', () => {
        expect(DepthColourScale.ramp()).toBe(DepthColourScale.ramp());
    });

    it('starts the ramp fully transparent', () => {
        expect(DepthColourScale.ramp()[3]).toBe(0);
    });

    it('ends the ramp fully opaque', () => {
        expect(DepthColourScale.ramp()[1_023]).toBe(255);
    });
});

describe('resolveSaturationQuantity', () => {
    it('falls back to one for an empty window', () => {
        expect(resolveSaturationQuantity([], 0.995)).toBe(1);
    });

    it('picks the value at the requested percentile', () => {
        const quantities = Array.from({ length: 100 }, (_unused, index) => index + 1);

        expect(resolveSaturationQuantity(quantities, 0.5)).toBe(51);
    });

    it('ignores the ordering it is handed', () => {
        const ascending = resolveSaturationQuantity([1, 2, 3, 4, 100], 0.8);
        const shuffled = resolveSaturationQuantity([100, 3, 1, 4, 2], 0.8);

        expect(ascending).toBe(shuffled);
    });

    it('keeps a lone outlier from setting the ceiling', () => {
        const quantities = [...Array.from({ length: 99 }, () => 1), 10_000];

        expect(resolveSaturationQuantity(quantities, 0.9)).toBe(1);
    });
});

/**
 * Percentiles over 194,882 depth buckets of BTCUSDT.
 *
 * Measured rather than chosen, so a change to the response curve is judged
 * against the book it has to draw rather than against taste.
 */
const MEASURED_DEPTH = {
    tenthPercentile: 7.4,
    floor: 16.09,
    median: 19.52,
    ninetiethPercentile: 53.82,
    ninetyNinthPercentile: 154.06,
    saturation: 235.1,
} as const;

describe('DepthColourScale against a real book', () => {
    const scale = new DepthColourScale({
        saturationQuantity: MEASURED_DEPTH.saturation,
        floorQuantity: MEASURED_DEPTH.floor,
        gain: 1,
    });
    const share = (quantity: number) => scale.toRampIndex(quantity) / 255;

    it('leaves the typical bucket in the cold end, so walls have something to stand out against', () => {
        expect(share(MEASURED_DEPTH.median)).toBeLessThan(0.25);
    });

    it('drops the churn below the floor out of the picture entirely', () => {
        expect(share(MEASURED_DEPTH.tenthPercentile)).toBe(0);
    });

    it('costs the reader the difference between a thin level and an empty one', () => {
        expect([share(MEASURED_DEPTH.tenthPercentile), share(0)]).toEqual([0, 0]);
    });

    it('spends most of the ramp on the decile where walls live', () => {
        const wallBand = share(MEASURED_DEPTH.ninetyNinthPercentile)
            - share(MEASURED_DEPTH.ninetiethPercentile);

        expect(wallBand).toBeGreaterThan(0.4);
    });

    it('lifts a wall further clear of the median than an uncut ramp would', () => {
        const uncut = new DepthColourScale({
            saturationQuantity: MEASURED_DEPTH.saturation,
            floorQuantity: 0,
            gain: 1,
        });
        const gap = (candidate: DepthColourScale) =>
            (candidate.toRampIndex(MEASURED_DEPTH.ninetyNinthPercentile)
                - candidate.toRampIndex(MEASURED_DEPTH.median)) / 255;

        expect(gap(scale)).toBeGreaterThan(gap(uncut));
    });

    it('puts a genuine wall in the hot end', () => {
        expect(share(MEASURED_DEPTH.ninetyNinthPercentile)).toBeGreaterThan(0.75);
    });

    it('still separates the top decile into distinguishable steps', () => {
        const steps = new Set(
            [60, 90, 125, 160, 195, 230].map((quantity) => scale.toRampIndex(quantity)),
        );

        expect(steps.size).toBe(6);
    });
});

describe('resolveDepthRange', () => {
    const quantities = Array.from({ length: 100 }, (_unused, index) => index + 1);

    it('reads both cuts from the same window', () => {
        expect(resolveDepthRange(quantities, 0.4, 0.99)).toEqual({
            floorQuantity: 41,
            saturationQuantity: 100,
        });
    });

    it('falls back to a drawable range for an empty window', () => {
        expect(resolveDepthRange([], 0.4, 0.99)).toEqual({
            floorQuantity: 0,
            saturationQuantity: 1,
        });
    });

    it('never lets the floor climb past half the saturation', () => {
        const flat = Array.from({ length: 100 }, () => 50);

        expect(resolveDepthRange(flat, 0.9, 0.99).floorQuantity).toBe(25);
    });

    it('leaves the hot end where the upper cut asked for it', () => {
        const withOutlier = [...Array.from({ length: 99 }, () => 1), 10_000];

        expect(resolveDepthRange(withOutlier, 0.4, 0.9).saturationQuantity).toBe(1);
    });
});
