import type { LiquidityFrame } from '../../../shared/core/liquidity-frame.ts';

/** The rows one frame reached, so only those are painted and then cleared. */
export interface TouchedRows {
    readonly lowRow: number;
    readonly highRow: number;
}

export interface DepthRowFolderConfig {
    /** Rows the image holds, one per band of buckets. */
    readonly rowCount: number;
    /** The bucket drawn at the top of the image. */
    readonly highestBucketIndex: number;
    /** Price buckets folded into one drawn row. */
    readonly bucketsPerBand: number;
}

/**
 * Folds a frame's two ladders into the rows they will be drawn as.
 *
 * A row narrower than a pixel is not something a browser can draw: a window
 * wide enough to squeeze the book below one bucket per pixel comes out as
 * scattered specks with half the prices dropped, which is the opposite of what
 * a liquidity map is for. Folding first turns those buckets into bands the
 * reader can follow across the window.
 *
 * The largest resting size anywhere in a band, never the total of it. A colour
 * then means the same thing at every zoom — how big the biggest wall around
 * here is — and a wall does not dim as the window widens and the empty prices
 * either side of it are folded in with it.
 */
export class DepthRowFolder {
    private readonly rowCount: number;
    private readonly highestBucketIndex: number;
    private readonly bucketsPerBand: number;
    private readonly quantities: Float64Array;

    constructor(config: DepthRowFolderConfig) {
        this.rowCount = Math.max(0, config.rowCount);
        this.highestBucketIndex = config.highestBucketIndex;
        this.bucketsPerBand = Math.max(1, Math.floor(config.bucketsPerBand));
        this.quantities = new Float64Array(this.rowCount);
    }

    /**
     * Folds both sides of one frame into the rows.
     *
     * @param frame - The instant to fold.
     * @returns The rows it reached, or null when it reached none of them.
     */
    fold(frame: LiquidityFrame): TouchedRows | null {
        const bids = this.foldLadder(frame.bids);
        const asks = this.foldLadder(frame.asks);
        if (bids === null) {
            return asks;
        }
        if (asks === null) {
            return bids;
        }
        return {
            lowRow: Math.min(bids.lowRow, asks.lowRow),
            highRow: Math.max(bids.highRow, asks.highRow),
        };
    }

    /**
     * What was folded into one row.
     *
     * @param row - The row to read.
     * @returns The largest resting size in it, or nought where nothing rests.
     */
    quantityAt(row: number): number {
        return this.quantities[row] ?? 0;
    }

    /**
     * Empties the rows a fold reached, ready for the next column.
     *
     * @param touched - What that fold answered with.
     */
    clear(touched: TouchedRows): void {
        this.quantities.fill(0, touched.lowRow, touched.highRow + 1);
    }

    /**
     * The row a price bucket is drawn in.
     *
     * @param bucketIndex - The bucket to place.
     * @returns Its row, which may fall outside the image.
     */
    rowOf(bucketIndex: number): number {
        return Math.floor((this.highestBucketIndex - bucketIndex) / this.bucketsPerBand);
    }

    /**
     * Folds one side of the book, leaving the other side's rows alone.
     */
    private foldLadder(ladder: LiquidityFrame['bids']): TouchedRows | null {
        const { quantities, lowestBucketIndex } = ladder;
        let lowRow = Number.POSITIVE_INFINITY;
        let highRow = Number.NEGATIVE_INFINITY;

        for (let offset = 0; offset < quantities.length; offset += 1) {
            const quantity = quantities[offset]!;
            if (quantity <= 0) {
                continue;
            }

            const row = this.rowOf(lowestBucketIndex + offset);
            if (row < 0 || row >= this.rowCount) {
                continue;
            }

            if (quantity > this.quantities[row]!) {
                this.quantities[row] = quantity;
            }
            lowRow = Math.min(lowRow, row);
            highRow = Math.max(highRow, row);
        }

        return lowRow > highRow ? null : { lowRow, highRow };
    }
}
