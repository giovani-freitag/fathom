import { describe, expect, it } from 'vitest';
import { ViewportProjector } from '../../../src/app/core/viewport-projector.ts';

function buildProjector(): ViewportProjector {
    return new ViewportProjector({
        viewport: { fromMs: 1_000, toMs: 2_000, lowPrice: 100, highPrice: 200 },
        width: 500,
        height: 400,
    });
}

describe('ViewportProjector', () => {
    it('places the start of the range at the left edge', () => {
        expect(buildProjector().timeToX(1_000)).toBe(0);
    });

    it('places the end of the range at the right edge', () => {
        expect(buildProjector().timeToX(2_000)).toBe(500);
    });

    it('places the highest price at the top, since price grows upward', () => {
        expect(buildProjector().priceToY(200)).toBe(0);
    });

    it('places the lowest price at the bottom', () => {
        expect(buildProjector().priceToY(100)).toBe(400);
    });

    it('round-trips an instant through the horizontal axis', () => {
        const projector = buildProjector();

        expect(projector.xToTime(projector.timeToX(1_432))).toBeCloseTo(1_432, 6);
    });

    it('round-trips a price through the vertical axis', () => {
        const projector = buildProjector();

        expect(projector.yToPrice(projector.priceToY(137.5))).toBeCloseTo(137.5, 6);
    });

    it('reports how tall one bucket is on screen', () => {
        expect(buildProjector().bucketHeight(10)).toBe(40);
    });

    it('survives a viewport whose span collapsed to nothing', () => {
        const projector = new ViewportProjector({
            viewport: { fromMs: 500, toMs: 500, lowPrice: 100, highPrice: 100 },
            width: 500,
            height: 400,
        });

        expect(Number.isFinite(projector.timeToX(500))).toBe(true);
    });
});
