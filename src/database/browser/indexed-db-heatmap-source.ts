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
import {
    keepNewestBars,
    type PriceBar,
    type PriceBarQuery,
    type PriceBarWindow,
} from '../../shared/core/price-bar.ts';
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

    /**
     * Bars on a declared interval, grouped from the frames this page recorded.
     *
     * There is no pre-grouped grid here the way the server has one: a page holds
     * hours, not months, so folding the raw seconds costs less than keeping a
     * second copy of them current.
     *
     * @param query - Instrument, range, interval, and how much warm-up to read.
     * @returns The bars, oldest first, warm-up included at the front.
     * @throws HeatmapSourceError when the archive cannot be read.
     */
    async fetchPriceBars(query: PriceBarQuery): Promise<PriceBarWindow> {
        const grid = await this.readGrid(query.symbol);
        const frameIntervalMs = Math.max(1, grid?.frameIntervalMs ?? 1_000);
        const intervalMs = Math.max(frameIntervalMs, Math.floor(query.intervalMs));
        const warmupBars = Math.max(0, Math.floor(query.warmupBars));

        const drawnFromMs = alignDown(query.fromMs, intervalMs);
        const fromMs = drawnFromMs - warmupBars * intervalMs;
        const records = await this.read<FrameRecord>(
            STORES.liquidityFrame,
            IDBKeyRange.bound(
                [query.symbol, fromMs],
                [query.symbol, alignUp(query.toMs, intervalMs)],
                false,
                true,
            ),
        );

        const clusters = await this.read<TradeClusterRecord>(
            STORES.tradeCluster,
            IDBKeyRange.bound(
                [query.symbol, fromMs],
                [query.symbol, alignUp(query.toMs, intervalMs), Number.POSITIVE_INFINITY],
                false,
                true,
            ),
        );

        const bars = addVolume(keepNewestBars(foldRecordsIntoBars({
            records,
            intervalMs,
            expectedFrames: Math.max(1, Math.round(intervalMs / frameIntervalMs)),
            closedBeforeMs: Date.now() - intervalMs,
        })), clusters, intervalMs);

        return {
            instrumentSymbol: query.symbol,
            intervalMs,
            warmupBarsRequested: warmupBars,
            warmupBarsReturned: bars.filter((bar) => bar.openedAtMs < drawnFromMs).length,
            bars,
        };
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

interface BarFoldRequest {
    readonly records: readonly FrameRecord[];
    readonly intervalMs: number;
    readonly expectedFrames: number;
    readonly closedBeforeMs: number;
}

/**
 * Groups recorded frames into bars, leaving an unrecorded bucket out.
 */
function foldRecordsIntoBars(request: BarFoldRequest): PriceBar[] {
    const bars: PriceBar[] = [];
    let open: MutableBar | null = null;

    for (const record of request.records) {
        const midPrice = (record.bestBidPrice + record.bestAskPrice) / 2;
        const openedAtMs = alignDown(record.capturedAtMs, request.intervalMs);

        if (open === null || open.openedAtMs !== openedAtMs) {
            if (open !== null) {
                bars.push(sealBar(open, request));
            }
            open = {
                openedAtMs,
                openPrice: midPrice,
                highPrice: midPrice,
                lowPrice: midPrice,
                closePrice: midPrice,
                frameCount: 1,
                firstFrameAtMs: record.capturedAtMs,
                lastFrameAtMs: record.capturedAtMs,
            };
            continue;
        }

        open.highPrice = Math.max(open.highPrice, midPrice);
        open.lowPrice = Math.min(open.lowPrice, midPrice);
        open.closePrice = midPrice;
        open.frameCount += 1;
        open.lastFrameAtMs = record.capturedAtMs;
    }

    if (open !== null) {
        bars.push(sealBar(open, request));
    }
    return bars;
}

interface MutableBar {
    openedAtMs: number;
    openPrice: number;
    highPrice: number;
    lowPrice: number;
    closePrice: number;
    frameCount: number;
    firstFrameAtMs: number;
    lastFrameAtMs: number;
}

function sealBar(open: MutableBar, request: BarFoldRequest): PriceBar {
    return {
        ...open,
        closedAtMs: open.openedAtMs + request.intervalMs,
        buyVolume: 0,
        sellVolume: 0,
        tradeCount: 0,
        expectedFrames: request.expectedFrames,
        isClosed: open.openedAtMs <= request.closedBeforeMs,
    };
}

/**
 * Adds what traded in each bucket to the bars built from the book.
 *
 * Kept apart from the fold because the two come from different stores: the book
 * says where price was, and the trades say how much changed hands there.
 */
function addVolume(
    bars: readonly PriceBar[],
    clusters: readonly TradeClusterRecord[],
    intervalMs: number,
): PriceBar[] {
    const totals = new Map<number, { buy: number; sell: number; count: number }>();
    for (const cluster of clusters) {
        const openedAtMs = alignDown(cluster.executedAtMs, intervalMs);
        const running = totals.get(openedAtMs) ?? { buy: 0, sell: 0, count: 0 };
        running.buy += cluster.buyQuantity;
        running.sell += cluster.sellQuantity;
        running.count += cluster.tradeCount;
        totals.set(openedAtMs, running);
    }

    return bars.map((bar) => {
        const running = totals.get(bar.openedAtMs);
        return running === undefined ? bar : {
            ...bar,
            buyVolume: running.buy,
            sellVolume: running.sell,
            tradeCount: running.count,
        };
    });
}

function alignDown(instantMs: number, intervalMs: number): number {
    return Math.floor(instantMs / intervalMs) * intervalMs;
}

function alignUp(instantMs: number, intervalMs: number): number {
    return Math.ceil(instantMs / intervalMs) * intervalMs;
}
