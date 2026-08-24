import { describe, expect, it } from 'vitest';
import { DepthColourScale, resolveSaturationQuantity } from '@core/domain/depth-colour-scale';

function buildScale(gain = 1): DepthColourScale {
    return new DepthColourScale({ saturationQuantity: 100, gain });
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
