import { type LiquidityFrame } from '../../shared/core/liquidity-frame.ts';
import { toPriceBucketIndex } from '../../shared/core/price-bucket.ts';
import type { OrderBookReading } from './depth-types.ts';

export interface LadderBuildRequest {
    readonly reading: OrderBookReading;
    readonly capturedAtMs: number;
    readonly priceBucketSize: number;
    readonly recordedPriceRangeRatio: number;
}

/**
 * Projects a book reading onto the recorded price grid.
 *
 * Each side gets its own offset and array, so the bucket the spread falls in
 * never sums resting bid size into resting ask size, and neither side stores
 * the other's empty half.
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

    const bidQuantities = accumulate({
        quantityByPrice: reading.bidQuantityByPrice,
        lowestBucketIndex,
        highestBucketIndex: bidHighestBucketIndex,
        priceBucketSize,
    });
    const askQuantities = accumulate({
        quantityByPrice: reading.askQuantityByPrice,
        lowestBucketIndex: askLowestBucketIndex,
        highestBucketIndex,
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
}

function accumulate(request: AccumulateRequest): Float32Array {
    const bucketCount = request.highestBucketIndex - request.lowestBucketIndex + 1;
    if (bucketCount <= 0) {
        return new Float32Array(0);
    }

    const quantities = new Float32Array(bucketCount);
    for (const [price, quantity] of request.quantityByPrice) {
        const offset = toPriceBucketIndex(price, request.priceBucketSize) - request.lowestBucketIndex;
        if (offset >= 0 && offset < bucketCount) {
            quantities[offset] = quantities[offset]! + quantity;
        }
    }
    return quantities;
}
