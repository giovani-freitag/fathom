import { type LiquidityFrame } from '../../shared/core/liquidity-frame.ts';
import { toPriceBucketIndex } from '../../shared/core/price-bucket.ts';
import type { OrderBookReading } from './depth-types.ts';

/** What a bucket holds when several of the book's prices fall into it. */
export type BucketCombine = 'sum' | 'largest';

export interface LadderBuildRequest {
    readonly reading: OrderBookReading;
    readonly capturedAtMs: number;
    readonly priceBucketSize: number;
    readonly recordedPriceRangeRatio: number;
    /** Defaults to the total, which is what a narrow bucket is asking for. */
    readonly combine?: BucketCombine;
}

/**
 * Projects a book reading onto the recorded price grid.
 *
 * @param request - The reading, its instant, and the grid to project onto.
 * @returns The frame, with quantities in quote-currency-per-bucket order.
 */
export function buildLiquidityFrame(request: LadderBuildRequest): LiquidityFrame {
    const { reading, priceBucketSize, recordedPriceRangeRatio } = request;
    const midPrice = (reading.bestBidPrice + reading.bestAskPrice) / 2;
    const recordedHalfRange = midPrice * recordedPriceRangeRatio;

    const lowestBucketIndex = toPriceBucketIndex(midPrice - recordedHalfRange, priceBucketSize);
    const highestBucketIndex = toPriceBucketIndex(midPrice + recordedHalfRange, priceBucketSize);
    const bestBidBucketIndex = toPriceBucketIndex(reading.bestBidPrice, priceBucketSize);
    const bestAskBucketIndex = toPriceBucketIndex(reading.bestAskPrice, priceBucketSize);

    const bidHighestBucketIndex = Math.min(bestBidBucketIndex, highestBucketIndex);
    const askLowestBucketIndex = Math.max(bestAskBucketIndex, lowestBucketIndex);

    const combine = request.combine ?? 'sum';
    const bidQuantities = accumulate({
        quantityByPrice: reading.bidQuantityByPrice,
        lowestBucketIndex,
        highestBucketIndex: bidHighestBucketIndex,
        priceBucketSize,
        combine,
    });
    const askQuantities = accumulate({
        quantityByPrice: reading.askQuantityByPrice,
        lowestBucketIndex: askLowestBucketIndex,
        highestBucketIndex,
        combine,
        priceBucketSize,
    });

    return {
        capturedAtMs: request.capturedAtMs,
        bestBidPrice: reading.bestBidPrice,
        bestAskPrice: reading.bestAskPrice,
        bids: { lowestBucketIndex, quantities: bidQuantities },
        asks: { lowestBucketIndex: askLowestBucketIndex, quantities: askQuantities },
    };
}

interface AccumulateRequest {
    readonly quantityByPrice: ReadonlyMap<number, number>;
    readonly lowestBucketIndex: number;
    readonly highestBucketIndex: number;
    readonly priceBucketSize: number;
    readonly combine: BucketCombine;
}

/**
 * Lays the book's prices onto a bucket grid, one figure per bucket.
 *
 * Summing answers how much is resting in a band, which is what a band ten
 * dollars wide is asking. A band a thousand dollars wide is asking something
 * else: near the price it swallows a dense book and reads in the thousands,
 * while the same band twenty percent away holds two orders and reads in tens.
 * Put on one colour ramp, the second disappears — so a wide grid takes the
 * largest single order in the band instead, which is the wall a reader is
 * looking for and is comparable wherever it stands.
 */
function accumulate(request: AccumulateRequest): Float32Array {
    const bucketCount = request.highestBucketIndex - request.lowestBucketIndex + 1;
    if (bucketCount <= 0) {
        return new Float32Array(0);
    }

    const quantities = new Float32Array(bucketCount);
    for (const [price, quantity] of request.quantityByPrice) {
        const offset = toPriceBucketIndex(price, request.priceBucketSize) - request.lowestBucketIndex;
        if (offset >= 0 && offset < bucketCount) {
            quantities[offset] = request.combine === 'largest'
                ? Math.max(quantities[offset]!, quantity)
                : quantities[offset]! + quantity;
        }
    }
    return quantities;
}
