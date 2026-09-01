import { toPriceBucketIndex } from './price-bucket.ts';

/** The stretch of price a reader is looking at, and how finely they can see it. */
export interface PriceBandRequest {
    /** Lowest price on screen. Nought means the reader named no band. */
    readonly lowPrice: number | null;
    readonly highPrice: number | null;
    /** Most rows the reader can draw. Nought means every stored row. */
    readonly maxRows: number | null;
    /** Height of one stored bucket, in quote currency units. */
    readonly priceBucketSize: number;
}

/** A stretch of the stored grid, and how many of its buckets make one row. */
export interface PriceBand {
    readonly lowestBucketIndex: number;
    readonly bucketCount: number;
    /** Stored buckets folded into one returned row, at least one. */
    readonly bucketsPerRow: number;
}

/**
 * The stored buckets a reader will actually draw.
 *
 * Without one, a whole-book window answers with every price from nothing to
 * twice the market — some fifteen thousand of them, nearly all empty — and the
 * reader throws all but the hundred on screen away after paying to receive
 * them. Naming the band moves that discarding to the side of the wire that can
 * afford it.
 *
 * The low edge is snapped down onto a multiple of the fold. Rows anchored to
 * the band instead would shift under a reader panning by a single bucket, and
 * the whole picture would shimmer as the boundaries slid through the walls.
 *
 * @param request - The prices on screen, the rows available, and the grid.
 * @returns The band, or null when the reader named none.
 */
export function resolvePriceBand(request: PriceBandRequest): PriceBand | null {
    const { lowPrice, highPrice, priceBucketSize } = request;
    if (lowPrice === null || highPrice === null || !(priceBucketSize > 0)) {
        return null;
    }
    if (!Number.isFinite(lowPrice) || !Number.isFinite(highPrice) || highPrice <= lowPrice) {
        return null;
    }

    const lowestWanted = toPriceBucketIndex(lowPrice, priceBucketSize);
    const highestWanted = toPriceBucketIndex(highPrice, priceBucketSize);
    const wantedCount = highestWanted - lowestWanted + 1;
    const maxRows = request.maxRows;
    const bucketsPerRow = maxRows === null || maxRows < 1
        ? 1
        : Math.max(1, Math.ceil(wantedCount / maxRows));

    const lowestBucketIndex = Math.floor(lowestWanted / bucketsPerRow) * bucketsPerRow;
    const bucketCount = Math.ceil((highestWanted + 1 - lowestBucketIndex) / bucketsPerRow)
        * bucketsPerRow;

    return { lowestBucketIndex, bucketCount, bucketsPerRow };
}

/**
 * Which row of the band a stored bucket lands in.
 *
 * @param band - The band the row belongs to.
 * @param bucketIndex - A bucket on the stored grid.
 * @returns The row index, or null when the bucket is outside the band.
 */
export function toBandRow(band: PriceBand, bucketIndex: number): number | null {
    const offset = bucketIndex - band.lowestBucketIndex;
    if (offset < 0 || offset >= band.bucketCount) {
        return null;
    }
    return Math.floor(offset / band.bucketsPerRow);
}

/**
 * The bucket index a band row carries once the window is read back.
 *
 * @param band - The band the row belongs to.
 * @param row - A row index within the band.
 * @returns The index that row has on the folded grid the window reports.
 */
export function toFoldedBucketIndex(band: PriceBand, row: number): number {
    return band.lowestBucketIndex / band.bucketsPerRow + row;
}

/** What a window read knows about the prices it is being asked for. */
export interface WindowBandRequest {
    readonly lowPrice: number | null;
    readonly highPrice: number | null;
    readonly maxRows: number | null;
    readonly priceBucketSize: number;
    /** The top of what was recorded, for a reader that named no prices. */
    readonly recordedCeiling: number;
}

/**
 * The band a window answers over, named or not.
 *
 * A reader that asks for rows but names no prices has not framed itself on the
 * book yet — it is opening, and it needs to see the whole of one to find the
 * market. Answering that with no band at all hands it every price on the fine
 * grid: measured on a whole-book store, three hundred and forty-two megabytes
 * and five seconds before a chart drew anything. Folding the recorded range to
 * the rows it asked for answers the same question in a hundredth of that.
 *
 * @param request - The prices, the rows, the grid, and what was recorded.
 * @returns The band, or null when neither prices nor rows were named.
 */
export function resolveWindowBand(request: WindowBandRequest): PriceBand | null {
    const namesPrices = request.lowPrice !== null && request.highPrice !== null;
    // The recorded range stands in for prices nobody named only so that a row
    // budget can be honoured. With no budget either, there is nothing to fold
    // to and no reason to clip: a caller that named neither wants everything.
    if (!namesPrices && request.maxRows === null) {
        return null;
    }
    return resolvePriceBand({
        lowPrice: namesPrices ? request.lowPrice : 0,
        highPrice: namesPrices ? request.highPrice : request.recordedCeiling,
        maxRows: request.maxRows,
        priceBucketSize: request.priceBucketSize,
    });
}
