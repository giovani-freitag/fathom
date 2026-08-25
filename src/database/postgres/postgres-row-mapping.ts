import type { InstrumentCoverage } from '../../shared/core/api-contract.ts';
import type { DepthLadder, LiquidityFrame } from '../../shared/core/liquidity-frame.ts';
import type { RecordingGap } from '../../shared/core/recording-gap.ts';
import type { TradeCluster } from '../../shared/core/trade-cluster.ts';

/**
 * Row shapes each query produces, named as PostgreSQL returns them.
 *
 * They live beside the functions that translate them so a column rename shows up
 * in one file rather than two.
 */
export interface LiquidityFrameRow {
    readonly captured_at: Date;
    readonly best_bid_price: number;
    readonly best_ask_price: number;
    readonly bid_lowest_bucket_index: number;
    readonly bid_quantities: unknown;
    readonly ask_lowest_bucket_index: number;
    readonly ask_quantities: unknown;
}

export interface InstrumentRow {
    readonly instrument_symbol: string;
    readonly price_bucket_size: number;
    readonly frame_interval_ms: number;
    readonly first_frame_at: Date | null;
    readonly last_frame_at: Date | null;
}

export interface TradeClusterRow {
    readonly bucket_start: Date;
    readonly grouped_bucket_index: number;
    readonly buy_quantity: number;
    readonly sell_quantity: number;
    readonly trade_count: number;
    readonly largest_trade_quantity: number;
}

export interface RecordingGapRow {
    readonly gap_started_at: Date;
    readonly gap_ended_at: Date;
    readonly gap_reason: string;
}

/**
 * Converts a `REAL[]` column into the dense typed array the renderer consumes.
 *
 * The driver normally parses float arrays into numbers, but falls back to the
 * raw `{1,2,3}` literal when no parser is registered for the element type. Both
 * shapes are accepted so a driver upgrade cannot silently produce NaN depth.
 *
 * @param column - Value the driver produced for a `REAL[]` column.
 * @returns The quantities, in column order.
 * @throws TypeError when the column is neither an array nor an array literal.
 */
export function toQuantityArray(column: unknown): Float32Array {
    if (column instanceof Float32Array) {
        return column;
    }
    if (Array.isArray(column)) {
        return Float32Array.from(column as number[], Number);
    }
    if (typeof column === 'string') {
        return parseQuantityLiteral(column);
    }
    throw new TypeError(`Expected a REAL[] column, received ${typeof column}`);
}

/**
 * Builds one side of a depth ladder from its offset and quantity columns.
 *
 * @param lowestBucketIndex - Absolute index of the first quantity.
 * @param quantityColumn - Value the driver produced for the quantity column.
 * @returns The ladder for that side.
 */
export function toDepthLadder(lowestBucketIndex: number, quantityColumn: unknown): DepthLadder {
    return { lowestBucketIndex, quantities: toQuantityArray(quantityColumn) };
}

const COMMA = 44;
const CLOSING_BRACE = 125;

/**
 * Reads a `real[]` literal straight into a typed array.
 *
 * The driver's own parser builds an `Array` of boxed numbers first, and a window
 * of a few thousand frames carries a couple of million of them. Scanning the
 * literal once and writing into the array we actually want cuts the read of a
 * four-hour window from 630ms to 250ms, which is the query's own time.
 *
 * @param literal - The array literal, `{1.5,2.25,0}`.
 * @returns The quantities, in order.
 */
export function parseQuantityLiteral(literal: string): Float32Array {
    const length = literal.length;
    if (length <= 2) {
        return new Float32Array(0);
    }

    let count = 1;
    for (let index = 1; index < length - 1; index += 1) {
        if (literal.charCodeAt(index) === COMMA) {
            count += 1;
        }
    }

    const quantities = new Float32Array(count);
    let slot = 0;
    let start = 1;
    for (let index = 1; index < length; index += 1) {
        const code = literal.charCodeAt(index);
        if (code === COMMA || code === CLOSING_BRACE) {
            quantities[slot] = Number(literal.slice(start, index));
            slot += 1;
            start = index + 1;
        }
    }
    return quantities;
}

/**
 * Builds a depth frame from its row.
 *
 * @param row - A row of `liquidity_frame`.
 * @returns The frame, with both ladders decoded.
 */
export function toLiquidityFrame(row: LiquidityFrameRow): LiquidityFrame {
    return {
        capturedAtMs: row.captured_at.getTime(),
        bestBidPrice: row.best_bid_price,
        bestAskPrice: row.best_ask_price,
        bids: toDepthLadder(row.bid_lowest_bucket_index, row.bid_quantities),
        asks: toDepthLadder(row.ask_lowest_bucket_index, row.ask_quantities),
    };
}

/**
 * Builds an instrument descriptor from its row.
 *
 * @param row - A registry row joined with its recorded extent.
 * @returns The coverage, with instants as milliseconds.
 */
export function toInstrumentCoverage(row: InstrumentRow): InstrumentCoverage {
    return {
        instrumentSymbol: row.instrument_symbol,
        priceBucketSize: row.price_bucket_size,
        frameIntervalMs: row.frame_interval_ms,
        firstFrameAtMs: row.first_frame_at?.getTime() ?? null,
        lastFrameAtMs: row.last_frame_at?.getTime() ?? null,
    };
}

/**
 * Builds an execution cluster from its binned row.
 *
 * @param row - A grouped row of one of the execution grids.
 * @returns The cluster, on the grid the query asked for.
 */
export function toTradeCluster(row: TradeClusterRow): TradeCluster {
    return {
        executedAtMs: row.bucket_start.getTime(),
        priceBucketIndex: row.grouped_bucket_index,
        buyQuantity: row.buy_quantity,
        sellQuantity: row.sell_quantity,
        tradeCount: row.trade_count,
        largestTradeQuantity: row.largest_trade_quantity,
    };
}

/**
 * Builds a recording gap from its row.
 *
 * @param row - A row of `recording_gap`.
 * @returns The gap, with instants as milliseconds.
 */
export function toRecordingGap(row: RecordingGapRow): RecordingGap {
    return {
        gapStartedAtMs: row.gap_started_at.getTime(),
        gapEndedAtMs: row.gap_ended_at.getTime(),
        gapReason: row.gap_reason,
    };
}
