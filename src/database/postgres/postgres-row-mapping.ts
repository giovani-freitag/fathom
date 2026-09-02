import type { RecordingGap } from '../../shared/core/recording-gap.ts';
import type { TradeCluster } from '../../shared/core/trade-cluster.ts';

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

const COMMA = 44;
const CLOSING_BRACE = 125;

/**
 * Converts a `REAL[]` column into the dense typed array the reader consumes.
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
 * Reads a Postgres `REAL[]` literal straight into a typed array.
 *
 * The driver's own parser is the single largest cost of reading a wide window,
 * and every `real[]` this project selects is a row of figures that is about to
 * become a typed array anyway.
 *
 * @param literal - The array literal as the wire carried it.
 * @returns The figures, in order.
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
