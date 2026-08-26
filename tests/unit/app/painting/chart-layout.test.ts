import { describe, expect, it } from 'vitest';
import { resolveChartLayout } from '../../../../src/app/painting/chart-layout.ts';

const SURFACE = { cssWidth: 1_200, cssHeight: 800, isVolumeProfileVisible: false };

describe('resolveChartLayout', () => {
    it('gives the whole stack to the price when nothing else asked for room', () => {
        const layout = resolveChartLayout(SURFACE);

        expect(layout.pricePaneHeight).toBe(layout.paneStackHeight);
        expect(layout.indicatorPanes).toEqual([]);
    });

    it('takes a band out of the price for each indicator that needs one', () => {
        const layout = resolveChartLayout({ ...SURFACE, indicatorPaneCount: 2 });

        expect(layout.indicatorPanes).toHaveLength(2);
        expect(layout.pricePaneHeight).toBeLessThan(layout.paneStackHeight);
    });

    it('stacks the bands under the price without a gap between them', () => {
        const layout = resolveChartLayout({ ...SURFACE, indicatorPaneCount: 3 });

        const [first, second, third] = layout.indicatorPanes;
        expect(first!.topY).toBe(layout.pricePaneHeight);
        expect(second!.topY).toBeCloseTo(first!.topY + first!.height, 6);
        expect(third!.topY + third!.height).toBeCloseTo(layout.paneStackHeight, 6);
    });

    it('stops shrinking the price, however many bands are added', () => {
        // Stacking indicators until the thing they describe is a sliver helps
        // nobody, so the price keeps a floor rather than a share.
        const crowded = resolveChartLayout({ ...SURFACE, indicatorPaneCount: 8 });

        expect(crowded.pricePaneHeight / crowded.paneStackHeight).toBeGreaterThanOrEqual(0.4);
    });

    it('leaves the time axis its own strip under every band', () => {
        const layout = resolveChartLayout({ ...SURFACE, indicatorPaneCount: 2 });

        expect(layout.paneStackHeight).toBeLessThan(SURFACE.cssHeight);
    });
});
