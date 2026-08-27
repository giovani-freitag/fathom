import type { TradeCluster } from '../../../../../src/shared/core/trade-cluster.ts';
import { TradePainter } from '../../../../../src/app/indicators/book/trade-painter.ts';
import { describe, expect, it } from 'vitest';
import { buildPaintContext, createRecordingContext, DEFAULT_VIEWPORT } from '../../../../mocks/canvas-context.ts';

function buildCluster(overrides: Partial<TradeCluster> = {}): TradeCluster {
    return {
        executedAtMs: 1_500_000,
        priceBucketIndex: 7_850,
        buyQuantity: 2,
        sellQuantity: 0,
        tradeCount: 3,
        largestTradeQuantity: 1,
        ...overrides,
    };
}

function paintWith(
    clusters: readonly TradeCluster[],
    options: { viewport?: Partial<typeof DEFAULT_VIEWPORT> } = {},
) {
    const recording = createRecordingContext();
    new TradePainter().paint(buildPaintContext(recording, {
        dataset: { clusters: [...clusters], clusterPriceBucketSize: 10 },
        ...(options.viewport === undefined ? {} : { viewport: options.viewport }),
    }));
    return recording;
}

describe('TradePainter', () => {
    it('draws nothing when nothing traded', () => {
        expect(paintWith([]).callsTo('arc')).toEqual([]);
    });

    it('draws one bubble per execution cell', () => {
        const recording = paintWith([
            buildCluster({ executedAtMs: 1_200_000 }),
            buildCluster({ executedAtMs: 1_400_000 }),
        ]);

        expect(recording.callsTo('arc').length).toBe(2);
    });

    it('skips cells outside the visible range', () => {
        const recording = paintWith([buildCluster({ executedAtMs: 1 })]);

        expect(recording.callsTo('arc')).toEqual([]);
    });

    it('colours a buy-dominant cell as resting bid liquidity taken', () => {
        const recording = paintWith([buildCluster({ buyQuantity: 5, sellQuantity: 1 })]);

        expect(recording.callsTo('fill')[0]?.fillStyle).toContain('43, 212, 168');
    });

    it('colours a sell-dominant cell as the other side', () => {
        const recording = paintWith([buildCluster({ buyQuantity: 1, sellQuantity: 5 })]);

        expect(recording.callsTo('fill')[0]?.fillStyle).toContain('255, 92, 114');
    });

    it('gives a larger cell a larger radius', () => {
        const recording = paintWith([
            buildCluster({ executedAtMs: 1_200_000, buyQuantity: 1 }),
            buildCluster({ executedAtMs: 1_400_000, buyQuantity: 100 }),
        ]);

        const [small, large] = recording.callsTo('arc');
        expect(Number(large?.args[2]) > Number(small?.args[2])).toBe(true);
    });

    it('leaves the smallest cell faint enough to read past', () => {
        const recording = paintWith([
            buildCluster({ executedAtMs: 1_200_000, buyQuantity: 0.01 }),
            buildCluster({ executedAtMs: 1_400_000, buyQuantity: 100 }),
        ]);

        const alpha = Number(recording.callsTo('fill')[0]?.fillStyle.match(/([\d.]+)\)$/)?.[1]);
        expect(alpha).toBeLessThan(0.35);
    });
});

describe('TradePainter merging', () => {
    it('draws one bubble for prints that land on the same spot', () => {
        // A day of a liquid contract puts several prints inside one column, and
        // one column is under a pixel wide: the second bubble hides the first.
        const recording = paintWith([
            buildCluster({ executedAtMs: 1_500_000 }),
            buildCluster({ executedAtMs: 1_500_100 }),
            buildCluster({ executedAtMs: 1_500_200 }),
        ]);

        expect(recording.callsTo('arc').length).toBe(1);
    });

    it('sizes a merged bubble from everything that went into it', () => {
        const alone = paintWith([
            buildCluster({ executedAtMs: 1_500_000, buyQuantity: 1 }),
            buildCluster({ executedAtMs: 1_200_000, buyQuantity: 4 }),
        ]);
        const merged = paintWith([
            buildCluster({ executedAtMs: 1_500_000, buyQuantity: 1 }),
            buildCluster({ executedAtMs: 1_500_100, buyQuantity: 3 }),
            buildCluster({ executedAtMs: 1_200_000, buyQuantity: 4 }),
        ]);

        const radiusOf = (recording: ReturnType<typeof paintWith>): number =>
            Number(recording.callsTo('arc')[0]!.args[2]);
        expect(radiusOf(merged)).toBeGreaterThan(radiusOf(alone));
    });

    it('keeps prints apart while they can be told apart', () => {
        const recording = paintWith([
            buildCluster({ executedAtMs: 1_200_000 }),
            buildCluster({ executedAtMs: 1_500_000 }),
            buildCluster({ executedAtMs: 1_800_000 }),
        ]);

        expect(recording.callsTo('arc').length).toBe(3);
    });

    it('skips prints outside the price band rather than drawing them off-plot', () => {
        const recording = paintWith([
            buildCluster({ priceBucketIndex: 7_850 }),
            buildCluster({ priceBucketIndex: 90_000 }),
            buildCluster({ priceBucketIndex: 10 }),
        ]);

        expect(recording.callsTo('arc').length).toBe(1);
    });
});

describe('TradePainter stability under a drag', () => {
    /**
     * The bubbles a viewport shows, as radius and centre, rounded to a pixel.
     */
    function bubblesAt(clusters: readonly TradeCluster[], shiftMs: number): string[] {
        const recording = paintWith(clusters, {
            viewport: {
                fromMs: DEFAULT_VIEWPORT.fromMs + shiftMs,
                toMs: DEFAULT_VIEWPORT.toMs + shiftMs,
            },
        });
        return recording.callsTo('arc').map((call) => Number(call.args[2]).toFixed(3));
    }

    it('merges the same prints together however far the chart has been dragged', () => {
        // Keyed on where a print landed on screen, a cell moves as the chart is
        // dragged: two prints sharing one at a given offset fall into separate
        // ones a pixel later, and the bubble splits and rejoins as it moves.
        const clusters = Array.from({ length: 40 }, (_, index) => buildCluster({
            executedAtMs: 1_200_000 + index * 900,
            buyQuantity: 1 + (index % 5),
        }));

        const still = bubblesAt(clusters, 0);
        const dragged = bubblesAt(clusters, 137);

        expect(dragged).toEqual(still);
    });

    it('keeps a bubble the size it was when a bigger one scrolls into view', () => {
        // Scaled against what is visible, one whale entering the window resizes
        // every other bubble on screen at once. The whale starts outside the
        // default range and the drag brings it in; the ordinary print beside it
        // is inside throughout and must not move.
        const clusters = [
            buildCluster({ executedAtMs: 1_500_000, buyQuantity: 1 }),
            buildCluster({ executedAtMs: 950_000, buyQuantity: 900 }),
        ];

        const before = bubblesAt(clusters, 0);
        const after = bubblesAt(clusters, -120_000);

        expect(before).toHaveLength(1);
        expect(after).toHaveLength(2);
        expect(after[0]).toBe(before[0]);
    });
});
