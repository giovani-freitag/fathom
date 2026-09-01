import { vi } from 'vitest';
import type { PostgresService } from '../../src/database/postgres/postgres-service.ts';

/** One row of either table, as the archive binds and reads it back. */
type Row = Record<string, unknown>;

export interface ChunkStoreMock {
    readonly service: PostgresService;
    /** How many rows each table holds, for asserting what a write produced. */
    count(table: 'block' | 'chunk'): number;
    rows(table: 'block' | 'chunk'): readonly Row[];
    /**
     * How many times a level's block was read back whole.
     *
     * Reading one costs a fifth of a second, so a recorder that reads before
     * every write spends more on reading than on recording. It has a reason to
     * read — another writer may have been in the block — and the cheap way to
     * know is the stamp the store leaves on a write.
     */
    blockReads(detailLevel: number): number;
    /**
     * How many times a level's block was written, rewrites included.
     *
     * The rows alone cannot say: a block still filling is written over in place,
     * so a level written once and a level written fifty times leave the same row
     * behind. How often it is written is exactly what a cadence decides.
     */
    writes(detailLevel: number): number;
    /**
     * Blanks the first columns of a level, as a level too young to hold them.
     *
     * Every level of the pyramid is built as the recording runs, so a coarse one
     * is always younger than the fine one under it, and one pruned to stay
     * inside the disk budget starts over from nothing. Its block still exists —
     * a block is addressed by a fixed grid — it simply carries no recording
     * where the finer level does.
     */
    forgetEarly(detailLevel: number, columns: number): void;
    /** Throws away every level above one, as a change to the fold would. */
    forgetLevelsAbove(detailLevel: number): void;
}

/**
 * The two chunk tables in memory, keyed the way the real unique indexes are.
 *
 * A spy that only records statements cannot answer a round trip, and the thing
 * worth testing about a store cut into squares is that a window put in comes
 * back out of the squares it was scattered across.
 */
export function createChunkStoreMock(): ChunkStoreMock {
    const blocks = new Map<string, Row>();
    const chunks = new Map<string, Row>();
    const blockWrites = new Map<number, number>();
    const blockReads = new Map<number, number>();
    /** Standing in for the transaction stamp Postgres leaves on every row. */
    const revisions = new Map<string, string>();
    let stamp = 0;

    /** Stores one block and stamps it, as an upsert returning `xmin` does. */
    const writeBlock = (parameters: readonly unknown[]): string => {
        const [symbol, level, startedAt, endedAt, interval, bucketSize, count, ratio, smallest, bids, asks] = parameters;
        const key = `${String(symbol)}:${String(level)}:${(startedAt as Date).getTime()}`;
        blockWrites.set(level as number, (blockWrites.get(level as number) ?? 0) + 1);
        blocks.set(key, {
            instrument_symbol: symbol, detail_level: level,
            started_at: startedAt, ended_at: endedAt,
            column_interval_ms: interval, price_bucket_size: bucketSize,
            column_count: count, step_ratio: ratio, smallest_quantity: smallest,
            best_bid_prices: bids, best_ask_prices: asks,
        });
        stamp += 1;
        const revision = String(stamp);
        revisions.set(key, revision);
        return revision;
    };

    const execute = vi.fn((statement: string, parameters: readonly unknown[] = []) => {
        if (statement.includes('liquidity_chunk')) {
            const [symbol, level, startedAt, lowest, count, low, high] = parameters;
            chunks.set(`${String(symbol)}:${String(level)}:${(startedAt as Date).getTime()}:${String(lowest)}`, {
                instrument_symbol: symbol, detail_level: level, started_at: startedAt,
                lowest_bucket_index: lowest, column_count: count,
                low_plane: low, high_plane: high,
            });
        }
        return Promise.resolve(1);
    });

    const selectRows = vi.fn((statement: string, parameters: readonly unknown[] = []) => {
        const [symbol] = parameters;
        if (statement.includes('INSERT INTO whole_book.liquidity_block')) {
            return Promise.resolve([{ revision: writeBlock(parameters) }]);
        }
        if (statement.includes('xmin::text AS revision')) {
            const [, level, startedAt] = parameters;
            const key = `${String(symbol)}:${String(level)}:${(startedAt as Date).getTime()}`;
            const revision = revisions.get(key);
            return Promise.resolve(revision === undefined ? [] : [{ revision }]);
        }
        if (statement.includes('AS started_at')) {
            const [, fromMs, toMs] = parameters;
            // The first instant each block holds a recording of, not where the
            // block opens: a block is addressed by a fixed grid and carries
            // empty places until the recording reaches it.
            const recorded = [...blocks.values()]
                .filter((row) => row['instrument_symbol'] === symbol && row['detail_level'] === 0
                    && (row['ended_at'] as Date) >= (fromMs as Date)
                    && (row['started_at'] as Date) <= (toMs as Date))
                .map((row) => {
                    const column = (row['best_bid_prices'] as number[]).findIndex((price) => price > 0);
                    return column < 0
                        ? null
                        : (row['started_at'] as Date).getTime() + column * (row['column_interval_ms'] as number);
                })
                .filter((one): one is number => one !== null);
            return Promise.resolve([{ started_at: recorded.length === 0 ? null : new Date(Math.min(...recorded)) }]);
        }
        if (statement.includes('column_interval_ms, price_bucket_size FROM')) {
            const finest = [...blocks.values()]
                .filter((row) => row['instrument_symbol'] === symbol && row['detail_level'] === 0);
            return Promise.resolve(finest.slice(-1));
        }
        if (statement.includes('AND started_at = $3::timestamptz')) {
            const [, level, startedAt] = parameters;
            blockReads.set(level as number, (blockReads.get(level as number) ?? 0) + 1);
            return Promise.resolve([...blocks.values()].filter((row) => (
                row['instrument_symbol'] === symbol && row['detail_level'] === level
                && (row['started_at'] as Date).getTime() === (startedAt as Date).getTime()
            )));
        }
        if (statement.includes('FROM whole_book.liquidity_block')) {
            const [, level, fromMs, toMs] = parameters;
            return Promise.resolve([...blocks.values()]
                .filter((row) => row['instrument_symbol'] === symbol && row['detail_level'] === level
                    && (row['ended_at'] as Date) >= (fromMs as Date)
                    && (row['started_at'] as Date) <= (toMs as Date))
                .sort((left, right) => (left['started_at'] as Date).getTime() - (right['started_at'] as Date).getTime()));
        }
        if (statement.includes('FROM whole_book.liquidity_chunk')) {
            const [, level, startedAt, wanted] = parameters;
            const wantedTimes = (startedAt as Date[]).map((one) => one.getTime());
            return Promise.resolve([...chunks.values()].filter((row) => (
                row['instrument_symbol'] === symbol && row['detail_level'] === level
                && wantedTimes.includes((row['started_at'] as Date).getTime())
                && (wanted === null || (wanted as number[]).includes(row['lowest_bucket_index'] as number))
            )));
        }
        return Promise.resolve([]);
    });

    return {
        service: { selectRows, execute } as unknown as PostgresService,
        count: (table) => (table === 'block' ? blocks.size : chunks.size),
        rows: (table) => [...(table === 'block' ? blocks : chunks).values()],
        writes: (detailLevel) => blockWrites.get(detailLevel) ?? 0,
        blockReads: (detailLevel) => blockReads.get(detailLevel) ?? 0,
        forgetLevelsAbove: (detailLevel) => {
            for (const [key, row] of [...blocks]) {
                if ((row['detail_level'] as number) > detailLevel) { blocks.delete(key); }
            }
            for (const [key, row] of [...chunks]) {
                if ((row['detail_level'] as number) > detailLevel) { chunks.delete(key); }
            }
        },
        forgetEarly: (detailLevel, columns) => {
            for (const row of blocks.values()) {
                if (row['detail_level'] !== detailLevel) {
                    continue;
                }
                // The columns that carry a recording, not the ones the fixed
                // grid leaves empty ahead of it: a block opens at its own start
                // whatever hour the recording reached it.
                const prices = row['best_bid_prices'] as number[];
                let forgotten = 0;
                for (let column = 0; column < prices.length && forgotten < columns; column += 1) {
                    if (prices[column]! > 0) {
                        prices[column] = 0;
                        forgotten += 1;
                    }
                }
            }
        },
    };
}
