import type { LiquidityFrame, LiquidityFrameWindow } from './liquidity-frame.ts';
import {
    type PriceBand,
    resolveWindowBand,
    toBandRow,
    toFoldedBucketIndex,
} from './price-band.ts';

/**
 * The same instants laid on a coarser price grid.
 *
 * A window read back over a wide band comes folded, and its bucket indices
 * count rows of that fold rather than prices. The tail is not folded — it reads
 * the recording as it was written — so its frames carry indices on the fine
 * grid. Appended as they are, every price in them lands at a fraction of where
 * it belongs, and the chart draws liquidity nobody ever offered.
 *
 * Largest wins within a row, the same rule the stored fold uses: a wall that
 * stood anywhere in the row is a wall, and averaging it away is exactly what a
 * reader looking at a wide band is trying to see.
 *
 * @param window - The instants as they were read.
 * @param priceBucketSize - The grid they have to land on.
 * @returns The window on that grid, or null when it cannot be laid on it.
 */
export function foldFrameWindow(
    window: LiquidityFrameWindow,
    priceBucketSize: number,
): LiquidityFrameWindow | null {
    if (priceBucketSize === window.priceBucketSize) {
        return window;
    }
    if (!(window.priceBucketSize > 0) || !(priceBucketSize > 0)) {
        return null;
    }

    // A whole number of fine buckets to the coarse one, or the rows do not line
    // up with the ones already drawn and every wall lands a little off.
    const bucketsPerRow = priceBucketSize / window.priceBucketSize;
    if (!Number.isInteger(bucketsPerRow) || bucketsPerRow < 1) {
        return null;
    }

    return {
        ...window,
        priceBucketSize,
        frames: window.frames.map((frame) => foldFrame(frame, bucketsPerRow)),
    };
}

/** One instant with its prices gathered into rows of the coarser grid. */
function foldFrame(frame: LiquidityFrame, bucketsPerRow: number): LiquidityFrame {
    const byRow = new Map<number, number>();
    for (const ladder of [frame.bids, frame.asks]) {
        for (let index = 0; index < ladder.quantities.length; index += 1) {
            const quantity = ladder.quantities[index] ?? 0;
            if (quantity <= 0) {
                continue;
            }
            const row = Math.floor((ladder.lowestBucketIndex + index) / bucketsPerRow);
            byRow.set(row, Math.max(byRow.get(row) ?? 0, quantity));
        }
    }

    // Split on the folded grid: taken on the fine one, the row holding the
    // touch would land whole on one side and the book would read as one-sided.
    const touchRow = Math.floor(frame.bids.lowestBucketIndex + frame.bids.quantities.length - 1);
    const touch = Math.floor(
        (Number.isFinite(touchRow) ? touchRow : 0) / bucketsPerRow,
    );
    return { ...frame, ...toLadders(byRow, touch) };
}

/** The two sides of one instant, as the dense runs a frame is read as. */
export interface LadderPair {
    readonly bids: LiquidityFrame['bids'];
    readonly asks: LiquidityFrame['asks'];
}

/**
 * One instant's prices split into the two sides a frame carries.
 *
 * Split on whichever grid the prices are already counted in, the stored one or
 * a folded one, because both sides have to be split on the same grid: taken on
 * the finer of the two, the row holding the touch lands whole on one side and
 * the book reads as one-sided.
 *
 * One definition rather than one per store. The recording and the chunked
 * archive are held against each other, and a copy of this rule that drifts in
 * one of them shows up as a difference between the stores that is really a
 * difference between two copies of the same twenty lines.
 *
 * @param byBucket - What is resting at each price, on one grid.
 * @param touchBucketIndex - The last price of the bid side, on that grid.
 * @returns The two sides, each a dense run over the prices it holds.
 */
export function toLadders(
    byBucket: ReadonlyMap<number, number>,
    touchBucketIndex: number,
): LadderPair {
    return {
        bids: toLadder(byBucket, (bucketIndex) => bucketIndex <= touchBucketIndex),
        asks: toLadder(byBucket, (bucketIndex) => bucketIndex > touchBucketIndex),
    };
}

/** The rows a side holds, as the dense run a frame is read as. */
function toLadder(
    byRow: ReadonlyMap<number, number>,
    belongs: (row: number) => boolean,
): LiquidityFrame['bids'] {
    const held = [...byRow.keys()].filter(belongs).sort((left, right) => left - right);
    const lowest = held[0];
    const highest = held.at(-1);
    if (lowest === undefined || highest === undefined) {
        return { lowestBucketIndex: 0, quantities: new Float32Array(0) };
    }

    const quantities = new Float32Array(highest - lowest + 1);
    for (const row of held) {
        quantities[row - lowest] = byRow.get(row) ?? 0;
    }
    return { lowestBucketIndex: lowest, quantities };
}

/**
 * The same instants, holding only the prices a reader is going to draw.
 *
 * Every store answers in this shape, so the band can be applied here for the
 * ones that cannot apply it while reading. It saves nothing on the read — the
 * bytes were already decoded — and everything on the wire, which is where the
 * cost was: measured on a whole-book window, eighty-nine megabytes became under
 * one, and the reader stopped folding a hundred thousand rows a frame on the
 * thread it draws with.
 *
 * @param window - The instants as they were read.
 * @param band - The prices to keep, and how many of them make a row.
 * @returns The window over that band, on the grid the fold puts it on.
 */
export function applyPriceBand(
    window: LiquidityFrameWindow,
    band: PriceBand | null,
): LiquidityFrameWindow {
    if (band === null) {
        return window;
    }
    return {
        ...window,
        priceBucketSize: window.priceBucketSize * band.bucketsPerRow,
        frames: window.frames.map((frame) => clipFrame(frame, band, window.priceBucketSize)),
    };
}

/** One instant over the band, its prices gathered onto the band's rows. */
function clipFrame(
    frame: LiquidityFrame,
    band: PriceBand,
    priceBucketSize: number,
): LiquidityFrame {
    const byRow = new Map<number, number>();
    for (const ladder of [frame.bids, frame.asks]) {
        for (let index = 0; index < ladder.quantities.length; index += 1) {
            const quantity = ladder.quantities[index] ?? 0;
            if (quantity <= 0) {
                continue;
            }
            const row = toBandRow(band, ladder.lowestBucketIndex + index);
            if (row !== null) {
                const at = toFoldedBucketIndex(band, row);
                byRow.set(at, Math.max(byRow.get(at) ?? 0, quantity));
            }
        }
    }

    // Split on the folded grid: taken on the stored one, the row holding the
    // touch would land whole on one side and the book would read as one-sided.
    const touch = Math.floor(Math.round(frame.bestBidPrice / priceBucketSize) / band.bucketsPerRow);
    return { ...frame, ...toLadders(byRow, touch) };
}

/** The prices a reader named, as a store that reads on its own grid gets them. */
export interface WantedPriceBand {
    readonly lowPrice?: number | undefined;
    readonly highPrice?: number | undefined;
    readonly maxRows?: number | undefined;
}

/**
 * A window over the prices a reader named, taken off the window itself.
 *
 * For a store that reads its whole stored grid whatever it was asked for: the
 * band cannot narrow the read, so it narrows what is sent. The frame table is
 * the one such store — the chunked archive is addressed by price and narrows
 * the read itself. Resolving it here rather than at each caller keeps one rule
 * for what a row is, so the two stores cannot disagree about the same band and
 * be compared anyway.
 *
 * @param window - The instants as the store answered them.
 * @param wanted - The prices and rows the reader asked for.
 * @returns The window over that band, on the grid the fold puts it on.
 */
export function bandReadWindow(
    window: LiquidityFrameWindow,
    wanted: WantedPriceBand,
): LiquidityFrameWindow {
    const first = window.frames[0];
    if (first === undefined) {
        return window;
    }
    return applyPriceBand(window, resolveWindowBand({
        lowPrice: wanted.lowPrice ?? null,
        highPrice: wanted.highPrice ?? null,
        maxRows: wanted.maxRows ?? null,
        priceBucketSize: window.priceBucketSize,
        recordedCeiling: first.bestBidPrice * 2,
    }));
}
