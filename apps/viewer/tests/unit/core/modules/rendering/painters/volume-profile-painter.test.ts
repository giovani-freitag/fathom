import type { TradeCluster } from '@fathom/contracts';
import { VolumeProfilePainter } from '@core/modules/rendering/painters/volume-profile-painter';
import { describe, expect, it } from 'vitest';
import { buildPaintContext, createRecordingContext } from '../../../../../mocks/canvas-context.ts';

function buildCluster(overrides: Partial<TradeCluster> = {}): TradeCluster {
    return {
        executedAtMs: 1_500_000,
        priceBucketIndex: 7_850,
        buyQuantity: 2,
        sellQuantity: 1,
        tradeCount: 3,
        largestTradeQuantity: 1,
        ...overrides,
    };
}

function paintWith(clusters: TradeCluster[], isVolumeProfileVisible = true) {
    const recording = createRecordingContext();
    const paint = buildPaintContext(recording, {
        dataset: { clusters, clusterPriceBucketSize: 10, clusterIntervalMs: 5_000 },
        isVolumeProfileVisible,
    });
    new VolumeProfilePainter().paint(paint);
    return { recording, paint };
}

describe('VolumeProfilePainter', () => {
    it('draws nothing when the panel is switched off', () => {
        const { recording } = paintWith([buildCluster()], false);

        expect(recording.calls).toEqual([]);
    });

    it('lays its own ground so bars do not read as a stain on the depth', () => {
        const { recording, paint } = paintWith([]);

        const backdrop = recording.callsTo('fillRect')[0];
        expect(Number(backdrop?.args[0])).toBe(paint.layout.profileX);
    });

    it('draws a bar pair per traded price level', () => {
        const { recording } = paintWith([
            buildCluster({ priceBucketIndex: 7_850 }),
            buildCluster({ priceBucketIndex: 7_860 }),
        ]);

        expect(recording.callsTo('fillRect').length).toBeGreaterThan(4);
    });

    it('keeps every bar inside the panel', () => {
        const { recording, paint } = paintWith([buildCluster()]);

        const lefts = recording.callsTo('fillRect').map((call) => Number(call.args[0]));
        expect(lefts.every((left) => left >= paint.layout.profileX - 1)).toBe(true);
    });

    it('skips price levels scrolled off the plot', () => {
        const { recording } = paintWith([buildCluster({ priceBucketIndex: 1 })]);

        expect(recording.callsTo('fillRect').length).toBe(1);
    });

    it('marks the busiest level so it does not have to be eyeballed', () => {
        const { recording } = paintWith([
            buildCluster({ priceBucketIndex: 7_850, buyQuantity: 1, sellQuantity: 0 }),
            buildCluster({ priceBucketIndex: 7_860, buyQuantity: 50, sellQuantity: 0 }),
        ]);

        expect(recording.callsTo('stroke').length).toBeGreaterThanOrEqual(2);
    });

    it('marks nothing when nothing traded in view', () => {
        const { recording } = paintWith([]);

        expect(recording.callsTo('stroke').length).toBe(1);
    });
});
