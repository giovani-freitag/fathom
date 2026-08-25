import { describe, expect, it } from 'vitest';
import {
    floorToInterval,
    toBucketCentrePrice,
    toBucketLowerPrice,
    toPriceBucketIndex,
} from '../../../src/book/price-bucket.ts';

describe('toPriceBucketIndex', () => {
    it('places a price inside the bucket that starts at or below it', () => {
        const bucketIndex = toPriceBucketIndex(78_945.7, 10);

        expect(bucketIndex).toBe(7_894);
    });

    it('places the lower edge of a bucket in that bucket', () => {
        const bucketIndex = toPriceBucketIndex(78_940, 10);

        expect(bucketIndex).toBe(7_894);
    });

    it('collapses decimal formattings of the same price onto one bucket', () => {
        const withTrailingZero = toPriceBucketIndex(Number('78945.10'), 10);
        const withoutTrailingZero = toPriceBucketIndex(Number('78945.1'), 10);

        expect(withTrailingZero).toBe(withoutTrailingZero);
    });
});

describe('toBucketLowerPrice', () => {
    it('returns the inclusive lower edge of the bucket', () => {
        const lowerPrice = toBucketLowerPrice(7_894, 10);

        expect(lowerPrice).toBe(78_940);
    });

    it('round-trips a price back to its own bucket', () => {
        const bucketIndex = toPriceBucketIndex(78_945.7, 10);

        expect(toPriceBucketIndex(toBucketLowerPrice(bucketIndex, 10), 10)).toBe(bucketIndex);
    });
});

describe('toBucketCentrePrice', () => {
    it('returns the midpoint of the bucket', () => {
        const centrePrice = toBucketCentrePrice(7_894, 10);

        expect(centrePrice).toBe(78_945);
    });
});

describe('floorToInterval', () => {
    it('snaps a timestamp down onto the grid', () => {
        const snapped = floorToInterval(1_787_606_652_689, 1_000);

        expect(snapped).toBe(1_787_606_652_000);
    });

    it('leaves a timestamp already on the grid untouched', () => {
        const snapped = floorToInterval(1_787_606_652_000, 1_000);

        expect(snapped).toBe(1_787_606_652_000);
    });

    it('produces the same instant for every timestamp inside one interval', () => {
        const early = floorToInterval(1_787_606_652_001, 1_000);
        const late = floorToInterval(1_787_606_652_999, 1_000);

        expect(early).toBe(late);
    });
});
