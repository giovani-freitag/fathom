import { describe, expect, it } from 'vitest';
import {
    resolvePriceBand,
    resolveWindowBand,
    toBandRow,
    toFoldedBucketIndex,
} from '../../../src/shared/core/price-band.ts';

describe('resolvePriceBand', () => {
    it('names no band when the reader named no prices', () => {
        expect(resolvePriceBand({ lowPrice: null, highPrice: null, maxRows: null, priceBucketSize: 10 })).toBeNull();
    });

    it('names no band when the prices are the wrong way round', () => {
        // An inverted band would read as empty, and a window that answered with
        // nothing looks exactly like a stretch nobody recorded.
        expect(resolvePriceBand({ lowPrice: 200, highPrice: 100, maxRows: null, priceBucketSize: 10 })).toBeNull();
    });

    it('covers every bucket the prices touch, edges included', () => {
        const band = resolvePriceBand({ lowPrice: 1_000, highPrice: 1_099, maxRows: null, priceBucketSize: 10 });

        expect(band).toMatchObject({ lowestBucketIndex: 100, bucketCount: 10 });
    });

    it('holds one bucket per row while the reader has room for them', () => {
        const band = resolvePriceBand({
            lowPrice: 1_000, highPrice: 1_099, maxRows: 500, priceBucketSize: 10,
        });

        expect(band?.bucketsPerRow).toBe(1);
    });

    it('folds until the band fits the rows the reader can draw', () => {
        // Ninety buckets into thirty rows is three buckets a row, and a row
        // thinner than a pixel is not something a browser can draw.
        const band = resolvePriceBand({
            lowPrice: 1_000, highPrice: 1_899, maxRows: 30, priceBucketSize: 10,
        });

        expect(band?.bucketsPerRow).toBe(3);
    });

    it('holds the row boundaries still under a pan shorter than a row', () => {
        // Anchored to the band, every boundary would slide with it and the
        // walls would shimmer through the rows on every drag.
        const band = (lowPrice: number) => resolvePriceBand({
            lowPrice, highPrice: lowPrice + 899, maxRows: 30, priceBucketSize: 10,
        })?.lowestBucketIndex;

        expect([band(1_000), band(1_010)]).toEqual([99, 99]);
    });

    it('moves the boundaries by a whole row once the pan reaches one', () => {
        const band = (lowPrice: number) => resolvePriceBand({
            lowPrice, highPrice: lowPrice + 899, maxRows: 30, priceBucketSize: 10,
        })?.lowestBucketIndex;

        expect(band(1_020)).toBe(102);
    });

    it('spans whole rows, so the last one is not a fraction', () => {
        const band = resolvePriceBand({
            lowPrice: 1_000, highPrice: 1_899, maxRows: 30, priceBucketSize: 10,
        });

        expect((band?.bucketCount ?? 0) % (band?.bucketsPerRow ?? 1)).toBe(0);
    });
});

describe('toBandRow', () => {
    const band = { lowestBucketIndex: 100, bucketCount: 12, bucketsPerRow: 3 };

    it('puts a bucket in the row that holds it', () => {
        expect(toBandRow(band, 107)).toBe(2);
    });

    it('turns away a bucket under the band', () => {
        expect(toBandRow(band, 99)).toBeNull();
    });

    it('turns away a bucket over the band', () => {
        expect(toBandRow(band, 112)).toBeNull();
    });
});

describe('toFoldedBucketIndex', () => {
    it('reports the row on the grid the window says it is on', () => {
        // The window reports a bucket size of the fold, so the index a reader
        // reads back has to be on that grid and not on the stored one.
        expect(toFoldedBucketIndex({ lowestBucketIndex: 300, bucketCount: 12, bucketsPerRow: 3 }, 2))
            .toBe(102);
    });
});

describe('resolveWindowBand', () => {
    /** A reader opening: it has rows to fill but does not yet know the market. */
    const opening = {
        lowPrice: null, highPrice: null, maxRows: 1_000,
        priceBucketSize: 10, recordedCeiling: 160_000,
    };

    it('folds the whole recording when the reader named no prices', () => {
        // Answered with no band at all, a whole-book store hands back every
        // price on the fine grid: measured, three hundred and forty-two
        // megabytes and five seconds before a chart drew anything.
        expect(resolveWindowBand(opening)?.bucketsPerRow).toBeGreaterThan(1);
    });

    it('covers the whole of what was recorded, so a chart can find the market', () => {
        const band = resolveWindowBand(opening);
        const top = ((band?.lowestBucketIndex ?? 0) + (band?.bucketCount ?? 0)) * 10;

        expect(top).toBeGreaterThanOrEqual(160_000);
    });

    it('honours the prices when the reader does name them', () => {
        const band = resolveWindowBand({ ...opening, lowPrice: 77_000, highPrice: 78_000 });

        expect(band?.lowestBucketIndex).toBe(7_700);
    });

    it('names no band at all when neither prices nor rows were asked for', () => {
        expect(resolveWindowBand({ ...opening, maxRows: null })).toBeNull();
    });
});
