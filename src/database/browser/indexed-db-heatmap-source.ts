import type { FrameRecord, GapRecord, InstrumentRecord, TradeClusterRecord } from './indexed-db-record-mapping.ts';
import {
    type FrameWindowQuery,
    type HeatmapSource,
    HeatmapSourceError,
    type TradeClusterQuery,
    type TradeClusterResult,
} from '../../shared/core/heatmap-source.ts';
import { foldFramesIntoColumns, INSTANTS_PER_COLUMN } from '../core/frame-aggregation.ts';
import type { IndexedDbService } from './indexed-db-service.ts';
import type { InstrumentCoverage } from '../../shared/core/api-contract.ts';
import type { LiquidityFrameWindow } from '../../shared/core/liquidity-frame.ts';
import type { RecordingGap } from '../../shared/core/recording-gap.ts';
import { STORES } from './browser-schema.ts';
import {
    toLiquidityFrame,
    toRecordingGap,
    toTradeCluster,
} from './indexed-db-record-mapping.ts';

export interface IndexedDbHeatmapSourceConfig {
    readonly database: IndexedDbService;
}

/**
 * The chart's read side when the page is its own collector.
 *
 * Mirrors `LiquidityQueryService` method for method, including the folding of
 * several probed instants into each column: a page and a gateway must draw the
 * same picture from the same recording, or the demo teaches something the real
 * thing does not do.
 */
export class IndexedDbHeatmapSource implements HeatmapSource {
    private readonly database: IndexedDbService;

    constructor(config: IndexedDbHeatmapSourceConfig) {
        this.database = config.database;
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
            const extent = await this.readExtent(record.instrumentSymbol);
            return {
                instrumentSymbol: record.instrumentSymbol,
                priceBucketSize: record.priceBucketSize,
                frameIntervalMs: record.frameIntervalMs,
                firstFrameAtMs: extent.firstFrameAtMs,
                lastFrameAtMs: extent.lastFrameAtMs,
            };
        }));
    }

    /**
     * Frames covering a window, one per column.
     *
     * @param query - Instrument, half-open range, and how many columns fit.
     * @returns The frames, oldest first.
     * @throws HeatmapSourceError when the archive cannot be read.
     */
    async fetchFrameWindow(query: FrameWindowQuery): Promise<LiquidityFrameWindow> {
        const grid = await this.readGrid(query.symbol);
        const sampleIntervalMs = Math.max(
            resolveSampleInterval(query),
            grid?.frameIntervalMs ?? 1,
        );

        const records = await this.read<FrameRecord>(
            STORES.liquidityFrame,
            rangeOver(query),
        );
        const probed = keepEvery(records, sampleIntervalMs / INSTANTS_PER_COLUMN);

        return {
            priceBucketSize: grid?.priceBucketSize ?? 1,
            sampleIntervalMs,
            frames: foldFramesIntoColumns(probed.map(toLiquidityFrame), sampleIntervalMs),
        };
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
     * A gap that began before the window but ended inside it still describes a
     * hole on screen, so the range cannot be a simple bound on where it started.
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

    private async readExtent(
        instrumentSymbol: string,
    ): Promise<{ firstFrameAtMs: number | null; lastFrameAtMs: number | null }> {
        const range = IDBKeyRange.bound(
            [instrumentSymbol],
            [instrumentSymbol, Number.POSITIVE_INFINITY],
        );
        const oldest = await this.read<FrameRecord>(STORES.liquidityFrame, range, 1);
        const newest = await this.readNewest(range);

        return {
            firstFrameAtMs: oldest[0]?.capturedAtMs ?? null,
            lastFrameAtMs: newest?.capturedAtMs ?? null,
        };
    }

    private async readNewest(range: IDBKeyRange): Promise<FrameRecord | null> {
        let found: FrameRecord | null = null;
        try {
            await this.database.transact([STORES.liquidityFrame], 'readonly', ([frames]) => {
                const request = frames!.openCursor(range, 'prev');
                request.onsuccess = () => {
                    const cursor = request.result;
                    found = cursor === null ? null : (cursor.value as FrameRecord);
                };
            });
        } catch (error) {
            throw new HeatmapSourceError('The local archive could not be read', 0, { cause: error });
        }
        return found;
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

function rangeOver(query: FrameWindowQuery): IDBKeyRange {
    return IDBKeyRange.bound(
        [query.symbol, query.fromMs],
        [query.symbol, query.toMs],
        false,
        true,
    );
}

/**
 * Thins records down to roughly one per interval, keeping the first of each.
 *
 * The engine has no equivalent of the gateway's `DISTINCT ON` over a bucket, so
 * the same choice is made here: the first record of each interval, which is what
 * keeps a column anchored to a real instant rather than an average of two.
 */
function keepEvery<TRecord extends { capturedAtMs: number }>(
    records: readonly TRecord[],
    intervalMs: number,
): TRecord[] {
    if (intervalMs <= 1) {
        return [...records];
    }

    const kept: TRecord[] = [];
    let lastBucket: number | null = null;
    for (const record of records) {
        const bucket = Math.floor(record.capturedAtMs / intervalMs);
        if (bucket !== lastBucket) {
            kept.push(record);
            lastBucket = bucket;
        }
    }
    return kept;
}

function resolveSampleInterval(query: FrameWindowQuery): number {
    const rangeMs = Math.max(1, query.toMs - query.fromMs);
    return Math.max(1, Math.ceil(rangeMs / Math.max(1, query.maxColumns)));
}
