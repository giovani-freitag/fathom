import type {
    ChunkBlockAddress,
    ChunkBlockRange,
    ChunkBlockRow,
    ChunkBlockWrite,
    ChunkRowStore,
    ChunkSquareQuery,
    ChunkSquareRow,
    ChunkSquareWrite,
    FinestChunkGrid,
} from '../core/chunk-row-store.ts';
import { compressFillingPlane, compressPlane, decompressPlane } from '../services/tile-compression.ts';
import type { PostgresService } from './postgres-service.ts';

/** The columns a block is read back by, in the order the queries name them. */
interface BlockRecord {
    readonly started_at: Date;
    readonly column_interval_ms: number;
    readonly price_bucket_size: number;
    readonly column_count: number;
    readonly step_ratio: number;
    readonly smallest_quantity: number;
    readonly best_bid_prices: number[];
    readonly best_ask_prices: number[];
}

/** The columns a square is read back by. */
interface SquareRecord {
    readonly started_at: Date;
    readonly lowest_bucket_index: number;
    readonly column_count: number;
    readonly low_plane: Buffer;
    readonly high_plane: Buffer | null;
}

const BLOCK_COLUMNS = `started_at, column_interval_ms, price_bucket_size, column_count,
                       step_ratio, smallest_quantity, best_bid_prices, best_ask_prices`;

export interface PostgresChunkRowStoreConfig {
    readonly postgres: PostgresService;
}

/**
 * The squares of the whole book, kept as two hypertables.
 *
 * Planes are squeezed on the way in and opened on the way out, so nothing above
 * this handles compressed bytes. Brotli rather than gzip, and not by taste:
 * measured over a recorded book it stores a third smaller for the same reading
 * cost, and a plane is one byte per cell of a picture that repeats.
 */
export class PostgresChunkRowStore implements ChunkRowStore {
    private readonly config: PostgresChunkRowStoreConfig;

    constructor(config: PostgresChunkRowStoreConfig) {
        this.config = config;
    }

    async readBlock(at: ChunkBlockAddress): Promise<ChunkBlockRow | null> {
        const rows = await this.config.postgres.selectRows<BlockRecord>(
            `SELECT ${BLOCK_COLUMNS}
             FROM whole_book.liquidity_block
             WHERE instrument_symbol = $1 AND detail_level = $2 AND started_at = $3::timestamptz`,
            [at.instrumentSymbol, at.detailLevel, new Date(at.startedAtMs)],
        );
        const row = rows[0];
        return row === undefined ? null : toBlockRow(row);
    }

    async readBlocksWithin(range: ChunkBlockRange): Promise<readonly ChunkBlockRow[]> {
        const rows = await this.config.postgres.selectRows<BlockRecord>(
            `SELECT ${BLOCK_COLUMNS}
             FROM whole_book.liquidity_block
             WHERE instrument_symbol = $1 AND detail_level = $2
               AND ended_at >= $3::timestamptz AND started_at <= $4::timestamptz
             ORDER BY started_at`,
            [range.instrumentSymbol, range.detailLevel, new Date(range.fromMs), new Date(range.toMs)],
        );
        return rows.map(toBlockRow);
    }

    async readFinestReach(
        range: Omit<ChunkBlockRange, 'detailLevel'>,
    ): Promise<number | null> {
        // Nullable because the aggregate answers with a row holding nothing
        // when no block overlaps, rather than with no row at all.
        const rows = await this.config.postgres.selectRows<{ started_at: Date | null }>(
            `SELECT min(started_at + (column_interval_ms * (COALESCE(
                        (SELECT min(i) FROM generate_subscripts(best_bid_prices, 1) i
                         WHERE best_bid_prices[i] > 0), 1) - 1)) * interval '1 millisecond')
                    AS started_at
             FROM whole_book.liquidity_block
             WHERE instrument_symbol = $1 AND detail_level = 0
               AND ended_at >= $2::timestamptz AND started_at <= $3::timestamptz`,
            [range.instrumentSymbol, new Date(range.fromMs), new Date(range.toMs)],
        );
        return rows[0]?.started_at?.getTime() ?? null;
    }

    async readFinestGrid(instrumentSymbol: string): Promise<FinestChunkGrid | null> {
        const rows = await this.config.postgres.selectRows<{
            column_interval_ms: number; price_bucket_size: number;
        }>(
            `SELECT column_interval_ms, price_bucket_size FROM whole_book.liquidity_block
             WHERE instrument_symbol = $1 AND detail_level = 0
             ORDER BY started_at DESC LIMIT 1`,
            [instrumentSymbol],
        );
        const row = rows[0];
        return row === undefined
            ? null
            : { columnIntervalMs: row.column_interval_ms, priceBucketSize: row.price_bucket_size };
    }

    async readRevision(at: ChunkBlockAddress): Promise<string | null> {
        // Postgres stamps every version of a row with the transaction that
        // wrote it, so a writer that remembers its own stamp can tell whether
        // anyone has been in the block since -- for the cost of one row lookup,
        // without opening a byte of what is in it.
        const rows = await this.config.postgres.selectRows<{ revision: string }>(
            `SELECT xmin::text AS revision FROM whole_book.liquidity_block
             WHERE instrument_symbol = $1 AND detail_level = $2 AND started_at = $3::timestamptz`,
            [at.instrumentSymbol, at.detailLevel, new Date(at.startedAtMs)],
        );
        return rows[0]?.revision ?? null;
    }

    async writeBlock(write: ChunkBlockWrite): Promise<string | null> {
        const { row } = write;
        const stamped = await this.config.postgres.selectRows<{ revision: string }>(
            `INSERT INTO whole_book.liquidity_block (
                 instrument_symbol, detail_level, started_at, ended_at, column_interval_ms,
                 price_bucket_size, column_count, step_ratio, smallest_quantity,
                 best_bid_prices, best_ask_prices)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             ON CONFLICT (instrument_symbol, detail_level, started_at) DO UPDATE SET
                 ended_at = EXCLUDED.ended_at, column_count = EXCLUDED.column_count,
                 price_bucket_size = EXCLUDED.price_bucket_size,
                 best_bid_prices = EXCLUDED.best_bid_prices,
                 best_ask_prices = EXCLUDED.best_ask_prices
             RETURNING xmin::text AS revision`,
            [
                write.instrumentSymbol, write.detailLevel, new Date(row.startedAtMs),
                new Date(write.endedAtMs), row.columnIntervalMs, row.priceBucketSize,
                row.columnCount, row.stepRatio, row.smallestQuantity,
                [...row.bestBidPrices], [...row.bestAskPrices],
            ],
        );
        return stamped[0]?.revision ?? null;
    }

    async writeSquare(write: ChunkSquareWrite): Promise<void> {
        const { row } = write;
        // A block short of a whole one is still filling and will be written over
        // within seconds, so only the version that completes it is squeezed hard.
        const squeeze = write.isComplete ? compressPlane : compressFillingPlane;
        await this.config.postgres.execute(
            `INSERT INTO whole_book.liquidity_chunk (
                 instrument_symbol, detail_level, started_at, lowest_bucket_index,
                 column_count, low_plane, high_plane)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (instrument_symbol, detail_level, started_at, lowest_bucket_index)
             DO UPDATE SET column_count = EXCLUDED.column_count,
                 low_plane = EXCLUDED.low_plane, high_plane = EXCLUDED.high_plane`,
            [
                write.instrumentSymbol, write.detailLevel, new Date(row.startedAtMs),
                row.lowestBucketIndex, row.columnCount, squeeze(row.lowPlane),
                row.highPlane === null ? null : squeeze(row.highPlane),
            ],
        );
    }

    async readSquares(query: ChunkSquareQuery): Promise<readonly ChunkSquareRow[]> {
        const rows = await this.config.postgres.selectRows<SquareRecord>(
            `SELECT started_at, lowest_bucket_index, column_count, low_plane, high_plane
             FROM whole_book.liquidity_chunk
             WHERE instrument_symbol = $1 AND detail_level = $2
               AND started_at = ANY($3::timestamptz[])
               AND ($4::int[] IS NULL OR lowest_bucket_index = ANY($4::int[]))`,
            [
                query.instrumentSymbol, query.detailLevel,
                query.startedAtMs.map((at) => new Date(at)),
                query.lowestBucketIndexes === null ? null : [...query.lowestBucketIndexes],
            ],
        );
        return rows.map((row) => ({
            startedAtMs: row.started_at.getTime(),
            lowestBucketIndex: row.lowest_bucket_index,
            columnCount: row.column_count,
            lowPlane: decompressPlane(row.low_plane),
            highPlane: row.high_plane === null ? null : decompressPlane(row.high_plane),
        }));
    }
}

/** One stored block in the shape the archive above reasons in. */
function toBlockRow(record: BlockRecord): ChunkBlockRow {
    return {
        startedAtMs: record.started_at.getTime(),
        columnIntervalMs: record.column_interval_ms,
        priceBucketSize: record.price_bucket_size,
        columnCount: record.column_count,
        stepRatio: record.step_ratio,
        smallestQuantity: record.smallest_quantity,
        bestBidPrices: record.best_bid_prices,
        bestAskPrices: record.best_ask_prices,
    };
}
