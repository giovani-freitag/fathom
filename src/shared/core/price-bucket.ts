/**
 * Index of the bucket a price falls into.
 *
 * @param price - Absolute price, in quote currency units.
 * @param priceBucketSize - Height of one bucket, in quote currency units.
 * @returns Zero-anchored index; bucket `n` spans `[n * size, (n + 1) * size)`.
 */
export function toPriceBucketIndex(price: number, priceBucketSize: number): number {
    return Math.floor(price / priceBucketSize);
}

/**
 * Lowest price contained in a bucket.
 *
 * @param bucketIndex - Zero-anchored bucket index.
 * @param priceBucketSize - Height of one bucket, in quote currency units.
 * @returns The inclusive lower edge of the bucket, in quote currency units.
 */
export function toBucketLowerPrice(bucketIndex: number, priceBucketSize: number): number {
    return bucketIndex * priceBucketSize;
}

/**
 * Price at the centre of a bucket.
 *
 * @param bucketIndex - Zero-anchored bucket index.
 * @param priceBucketSize - Height of one bucket, in quote currency units.
 * @returns The midpoint of the bucket, in quote currency units.
 */
export function toBucketCentrePrice(bucketIndex: number, priceBucketSize: number): number {
    return (bucketIndex + 0.5) * priceBucketSize;
}

/**
 * Timestamp snapped down onto a fixed-interval grid.
 *
 * @param timestampMs - Unix milliseconds to snap.
 * @param intervalMs - Grid spacing, in milliseconds.
 * @returns The grid instant at or before `timestampMs`.
 */
export function floorToInterval(timestampMs: number, intervalMs: number): number {
    return Math.floor(timestampMs / intervalMs) * intervalMs;
}
