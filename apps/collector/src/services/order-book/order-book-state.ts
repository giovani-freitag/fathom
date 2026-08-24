import type { SerializedPriceLevel, TopOfBook } from './depth-types.ts';

/**
 * The venue's book, mirrored locally.
 *
 * Prices key the maps as numbers rather than strings: parsing a decimal literal
 * always yields the same double, so a deletion still lands on the level an
 * earlier update created even when the venue changes its textual formatting
 * between the two messages.
 */
export class OrderBookState {
    private readonly bidQuantityByPrice = new Map<number, number>();
    private readonly askQuantityByPrice = new Map<number, number>();

    /**
     * Discards the local book and adopts a full ladder.
     *
     * @param bidLevels - Every resting bid in the snapshot.
     * @param askLevels - Every resting ask in the snapshot.
     */
    replaceWith(bidLevels: readonly SerializedPriceLevel[], askLevels: readonly SerializedPriceLevel[]): void {
        this.bidQuantityByPrice.clear();
        this.askQuantityByPrice.clear();
        applyLevels(this.bidQuantityByPrice, bidLevels);
        applyLevels(this.askQuantityByPrice, askLevels);
    }

    /**
     * Applies one incremental update in place.
     *
     * @param bidLevels - Changed bid levels; a zero quantity removes the level.
     * @param askLevels - Changed ask levels; a zero quantity removes the level.
     */
    applyDelta(bidLevels: readonly SerializedPriceLevel[], askLevels: readonly SerializedPriceLevel[]): void {
        applyLevels(this.bidQuantityByPrice, bidLevels);
        applyLevels(this.askQuantityByPrice, askLevels);
    }

    /**
     * Overwrites only the price span a fresh ladder actually covers.
     *
     * A REST ladder reaches a few hundred levels from the touch while the local
     * book, fed by unbounded diffs, reaches much further. Replacing wholesale
     * would discard the deep resting size that is the entire point of the
     * recording, so levels outside the ladder's own span are left untouched.
     *
     * @param bidLevels - Every resting bid in the ladder.
     * @param askLevels - Every resting ask in the ladder.
     */
    mergeWithinLadderSpan(
        bidLevels: readonly SerializedPriceLevel[],
        askLevels: readonly SerializedPriceLevel[],
    ): void {
        replaceSpan(this.bidQuantityByPrice, bidLevels);
        replaceSpan(this.askQuantityByPrice, askLevels);
    }

    /**
     * Drops levels further than a distance from a reference price.
     *
     * Diffs create levels at any depth and only remove them when the venue does,
     * so a book left unpruned grows for as long as the process runs.
     *
     * @param referencePrice - Price the distance is measured from.
     * @param maximumDistance - Half-width of the band to keep, in quote currency.
     * @returns How many levels were dropped.
     */
    pruneBeyond(referencePrice: number, maximumDistance: number): number {
        const lowestKeptPrice = referencePrice - maximumDistance;
        const highestKeptPrice = referencePrice + maximumDistance;
        return prune(this.bidQuantityByPrice, lowestKeptPrice, highestKeptPrice)
            + prune(this.askQuantityByPrice, lowestKeptPrice, highestKeptPrice);
    }

    /**
     * The touch, or null when the book is empty or crossed.
     *
     * @returns Best bid and best ask, or null when they do not form a valid book.
     */
    resolveTopOfBook(): TopOfBook | null {
        let bestBidPrice = Number.NEGATIVE_INFINITY;
        for (const price of this.bidQuantityByPrice.keys()) {
            if (price > bestBidPrice) {
                bestBidPrice = price;
            }
        }

        let bestAskPrice = Number.POSITIVE_INFINITY;
        for (const price of this.askQuantityByPrice.keys()) {
            if (price < bestAskPrice) {
                bestAskPrice = price;
            }
        }

        if (!Number.isFinite(bestBidPrice) || !Number.isFinite(bestAskPrice) || bestBidPrice >= bestAskPrice) {
            return null;
        }
        return { bestBidPrice, bestAskPrice };
    }

    get bidLevels(): ReadonlyMap<number, number> {
        return this.bidQuantityByPrice;
    }

    get askLevels(): ReadonlyMap<number, number> {
        return this.askQuantityByPrice;
    }

    get levelCount(): number {
        return this.bidQuantityByPrice.size + this.askQuantityByPrice.size;
    }
}

function applyLevels(
    quantityByPrice: Map<number, number>,
    levels: readonly SerializedPriceLevel[],
): void {
    for (const [priceText, quantityText] of levels) {
        const price = Number(priceText);
        const quantity = Number(quantityText);
        if (quantity === 0) {
            quantityByPrice.delete(price);
        } else {
            quantityByPrice.set(price, quantity);
        }
    }
}

function replaceSpan(
    quantityByPrice: Map<number, number>,
    levels: readonly SerializedPriceLevel[],
): void {
    if (levels.length === 0) {
        return;
    }

    let lowestPrice = Number.POSITIVE_INFINITY;
    let highestPrice = Number.NEGATIVE_INFINITY;
    for (const [priceText] of levels) {
        const price = Number(priceText);
        if (price < lowestPrice) {
            lowestPrice = price;
        }
        if (price > highestPrice) {
            highestPrice = price;
        }
    }

    for (const price of quantityByPrice.keys()) {
        if (price >= lowestPrice && price <= highestPrice) {
            quantityByPrice.delete(price);
        }
    }

    applyLevels(quantityByPrice, levels);
}

function prune(
    quantityByPrice: Map<number, number>,
    lowestKeptPrice: number,
    highestKeptPrice: number,
): number {
    let prunedCount = 0;
    for (const price of quantityByPrice.keys()) {
        if (price < lowestKeptPrice || price > highestKeptPrice) {
            quantityByPrice.delete(price);
            prunedCount += 1;
        }
    }
    return prunedCount;
}
