import type { GapRecord, InstrumentRecord, TradeClusterRecord } from './indexed-db-record-mapping.ts';
import {
    type FrameWindowQuery,
    type ArchiveSource,
    HeatmapSourceError,
    type TradeClusterQuery,
    type TradeClusterResult,
} from '../../shared/core/heatmap-source.ts';
import type { IndexedDbService } from './indexed-db-service.ts';
import type { InstrumentCoverage } from '../../shared/core/api-contract.ts';
import type { LiquidityFrameWindow } from '../../shared/core/liquidity-frame.ts';
import type { RecordingGap } from '../../shared/core/recording-gap.ts';
import { ChunkArchiveService } from '../services/chunk-archive-service.ts';
import { IndexedDbChunkRowStore } from './indexed-db-chunk-row-store.ts';
import { STORES } from './browser-schema.ts';
import {
    toRecordingGap,
    toTradeCluster,
} from './indexed-db-record-mapping.ts';

export interface IndexedDbHeatmapSourceConfig {
    readonly database: IndexedDbService;
}

/**
 * The chart's read side when the page is its own collector.
 */
/** How far a contract's recording reaches, and where its price was last. */
export class IndexedDbHeatmapSource implements ArchiveSource {
    private readonly database: IndexedDbService;
    private readonly rows: IndexedDbChunkRowStore;
    private readonly chunks: ChunkArchiveService;

    constructor(config: IndexedDbHeatmapSourceConfig) {
        this.database = config.database;
        this.rows = new IndexedDbChunkRowStore({ database: config.database });
        this.chunks = new ChunkArchiveService({ rows: this.rows });
    }

    /**
     * Every instrument this page has recorded, with its extent.
     *
     * @returns Coverage per instrument.
     * @throws HeatmapSourceError when the archive cannot be read.
     */
    async fetchInstruments(): Promise<readonly InstrumentCoverage[]> {
        const registered = await this.read<InstrumentRecord>(STORES.instrumentRegistry, null);

        return Promise.all(registered.map(async (record) => {
            const coverage = await this.rows.readCoverage(record.instrumentSymbol);
            return {
                instrumentSymbol: record.instrumentSymbol,
                priceBucketSize: record.priceBucketSize,
                frameIntervalMs: record.frameIntervalMs,
                firstFrameAtMs: coverage?.firstFrameAtMs ?? null,
                lastFrameAtMs: coverage?.lastFrameAtMs ?? null,
                lastMidPrice: coverage?.lastMidPrice ?? null,
            };
        }));
    }

    /**
     * Frames covering a window, one per column.
     *
     * Out of the same two archives a server reads from, named the same way: the
     * squares of the whole book, or the band the recording keeps.
     *
     * The store named is the store answered from, with nothing behind it. A
     * page falling back to the band for the first seconds looked kinder and was
     * not: the window then held the band while the tail extending it held the
     * squares, the two disagree about the grid they are on, and the chart drew
     * the seconds it started with and never moved again. Measured on a cold
     * page, the recording ran for a minute while the drawn book only shrank.
     *
     * @param query - Instrument, half-open range, and how many columns fit.
     * @returns The frames, oldest first.
     * @throws HeatmapSourceError when the archive cannot be read.
     */
    async fetchFrameWindow(query: FrameWindowQuery): Promise<LiquidityFrameWindow> {
        return this.chunks.fetchWindow({
            instrumentSymbol: query.symbol,
            fromMs: query.fromMs,
            toMs: query.toMs,
            maxColumns: query.maxColumns,
            ...(query.priceBand === undefined ? {} : query.priceBand),
        });
    }

    /**
     * Executions in a window, on the same grid as the frames.
     *
     * @param query - Instrument and half-open range.
     * @returns The clusters and the grid they sit on.
     * @throws HeatmapSourceError when the archive cannot be read.
     */
    async fetchTradeClusters(query: TradeClusterQuery): Promise<TradeClusterResult> {
        const grid = await this.readGrid(query.symbol);
        const records = await this.read<TradeClusterRecord>(
            STORES.tradeCluster,
            IDBKeyRange.bound(
                [query.symbol, query.fromMs],
                [query.symbol, query.toMs, Number.POSITIVE_INFINITY],
                false,
                true,
            ),
        );

        return {
            clusters: records.map(toTradeCluster),
            priceBucketSize: grid?.priceBucketSize ?? 1,
            sampleIntervalMs: grid?.frameIntervalMs ?? 1,
        };
    }

    /**
     * Stretches in a window that were not recorded.
     *
     * @param query - Instrument and half-open range.
     * @returns The gaps overlapping the window.
     * @throws HeatmapSourceError when the archive cannot be read.
     */
    async fetchGaps(query: FrameWindowQuery): Promise<readonly RecordingGap[]> {
        const records = await this.read<GapRecord>(
            STORES.recordingGap,
            IDBKeyRange.bound([query.symbol], [query.symbol, query.toMs], false, true),
        );

        return records
            .filter((record) => record.gapEndedAtMs >= query.fromMs)
            .map(toRecordingGap);
    }

    private async readGrid(instrumentSymbol: string): Promise<InstrumentRecord | null> {
        const registered = await this.read<InstrumentRecord>(STORES.instrumentRegistry, null);
        return registered.find((record) => record.instrumentSymbol === instrumentSymbol) ?? null;
    }

    private async read<TRecord>(
        storeName: string,
        range: IDBKeyRange | null,
        limit?: number,
    ): Promise<TRecord[]> {
        try {
            return await this.database.readRange<TRecord>(storeName, range, limit);
        } catch (error) {
            throw new HeatmapSourceError('The local archive could not be read', 0, { cause: error });
        }
    }
}




