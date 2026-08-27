import type { PriceBar, PriceBarWindow } from '../../../src/shared/core/price-bar.ts';
import { DEFAULT_FLOOR_PERCENTILE } from '../../../src/app/indicators/book/book.ts';
import { EMPTY_BAR_WINDOW } from '../../../src/shared/core/price-bar.ts';
import type { LiquidityFrame } from '../../../src/shared/core/liquidity-frame.ts';
import type { TradeCluster } from '../../../src/shared/core/trade-cluster.ts';
import { describe, expect, it } from 'vitest';
import {
    appendClusters,
    appendFrames,
    DEFAULT_SATURATION_PERCENTILE,
    type ChartDataset,
    EMPTY_DATASET,
    foldFramesIntoBars,
    newestFrameTimestamp,
    recutDataset,
    replaceDataset,
} from '../../../src/app/core/chart-dataset.ts';

function buildFrame(capturedAtMs: number): LiquidityFrame {
    return {
        capturedAtMs,
        bestBidPrice: 100,
        bestAskPrice: 101,
        bids: { lowestBucketIndex: 9, quantities: Float32Array.from([1, 2]) },
        asks: { lowestBucketIndex: 10, quantities: Float32Array.from([3]) },
    };
}

function buildDataset(...capturedAtMs: number[]) {
    return replaceDataset({
        instrumentSymbol: 'BTCUSDT',
        window: { priceBucketSize: 10, sampleIntervalMs: 1_000, frames: capturedAtMs.map(buildFrame) },
        clusters: [],
        clusterPriceBucketSize: 10,
        clusterIntervalMs: 1_000,
        gaps: [],
        bars: EMPTY_BAR_WINDOW,
        previousRevision: 0,
        floorPercentile: DEFAULT_FLOOR_PERCENTILE,
        saturationPercentile: DEFAULT_SATURATION_PERCENTILE,
    });
}

describe('replaceDataset', () => {
    it('advances the revision so a renderer can invalidate its cache', () => {
        expect(buildDataset(1_000).revision).toBe(1);
    });

    it('derives a saturation quantity from the loaded window', () => {
        expect(buildDataset(1_000).saturationQuantity).toBeGreaterThan(0);
    });

    it('never samples finer than one millisecond', () => {
        const dataset = replaceDataset({
            instrumentSymbol: 'BTCUSDT',
            window: { priceBucketSize: 10, sampleIntervalMs: 0, frames: [] },
            clusters: [],
            clusterPriceBucketSize: 10,
            clusterIntervalMs: 1_000,
            gaps: [],
            bars: EMPTY_BAR_WINDOW,
            previousRevision: 0,
            floorPercentile: DEFAULT_FLOOR_PERCENTILE,
            saturationPercentile: DEFAULT_SATURATION_PERCENTILE,
        });

        expect(dataset.sampleIntervalMs).toBe(1);
    });
});

describe('appendFrames', () => {
    it('extends the window with frames newer than the last loaded one', () => {
        const dataset = buildDataset(1_000, 2_000);

        const extended = appendFrames(dataset, [buildFrame(3_000)]);

        expect(extended.frames.map((frame) => frame.capturedAtMs)).toEqual([1_000, 2_000, 3_000]);
    });

    it('drops a frame the window already holds', () => {
        const dataset = buildDataset(1_000, 2_000);

        const extended = appendFrames(dataset, [buildFrame(2_000)]);

        expect(extended.frames.length).toBe(2);
    });

    it('returns the same snapshot when nothing was new', () => {
        const dataset = buildDataset(1_000);

        expect(appendFrames(dataset, [buildFrame(1_000)])).toBe(dataset);
    });

    it('returns the same snapshot when handed no frames', () => {
        const dataset = buildDataset(1_000);

        expect(appendFrames(dataset, [])).toBe(dataset);
    });

    it('advances the revision when it did extend', () => {
        const dataset = buildDataset(1_000);

        expect(appendFrames(dataset, [buildFrame(2_000)]).revision).toBe(dataset.revision + 1);
    });

    it('holds the saturation quantity steady across a streamed frame', () => {
        const dataset = buildDataset(1_000);

        expect(appendFrames(dataset, [buildFrame(2_000)]).saturationQuantity)
            .toBe(dataset.saturationQuantity);
    });
});

describe('appendClusters', () => {
    /** One cell of the execution grid. */
    function buildCell(
        executedAtMs: number,
        priceBucketIndex: number,
        buyQuantity: number,
    ): TradeCluster {
        return {
            executedAtMs,
            priceBucketIndex,
            buyQuantity,
            sellQuantity: 0,
            tradeCount: 1,
            largestTradeQuantity: buyQuantity,
        };
    }

    /** A dataset already holding one cell of the newest bucket. */
    function buildHolding(...cells: TradeCluster[]) {
        return { ...EMPTY_DATASET, clusters: cells };
    }

    it('drops a cluster older than the newest bucket it holds', () => {
        const dataset = buildHolding(buildCell(2_000, 10, 1));

        expect(appendClusters(dataset, [buildCell(1_000, 10, 1)])).toBe(dataset);
    });

    it('takes the fuller reading of a bucket that is still filling', () => {
        // The tail re-reads the newest bucket every pass because it is still
        // filling. Skipped as already known, it stays frozen at whatever had
        // landed the first time, and every live bucket ends up under-reported.
        const dataset = buildHolding(buildCell(2_000, 10, 1));

        const extended = appendClusters(dataset, [buildCell(2_000, 10, 7)]);

        expect(extended.clusters).toEqual([buildCell(2_000, 10, 7)]);
    });

    it('takes a price the newest bucket had not traded at yet', () => {
        const dataset = buildHolding(buildCell(2_000, 10, 1));

        const extended = appendClusters(dataset, [buildCell(2_000, 10, 1), buildCell(2_000, 11, 4)]);

        expect(extended.clusters).toHaveLength(2);
    });

    it('leaves the buckets before the newest one alone', () => {
        const dataset = buildHolding(buildCell(1_000, 10, 1), buildCell(2_000, 10, 1));

        const extended = appendClusters(dataset, [buildCell(2_000, 10, 7)]);

        expect(extended.clusters[0]).toEqual(buildCell(1_000, 10, 1));
    });

    it('appends a bucket newer than everything it holds', () => {
        const dataset = buildHolding(buildCell(2_000, 10, 1));

        const extended = appendClusters(dataset, [buildCell(3_000, 10, 4)]);

        expect(extended.clusters).toEqual([buildCell(2_000, 10, 1), buildCell(3_000, 10, 4)]);
    });
});

describe('newestFrameTimestamp', () => {
    it('reports nothing for an empty dataset', () => {
        expect(newestFrameTimestamp(EMPTY_DATASET)).toBeNull();
    });

    it('reports the last frame in capture order', () => {
        expect(newestFrameTimestamp(buildDataset(1_000, 5_000))).toBe(5_000);
    });
});

describe('appendClusters onto a grouped price grid', () => {
    function buildGroupedDataset() {
        return replaceDataset({
            instrumentSymbol: 'BTCUSDT',
            window: { priceBucketSize: 10, sampleIntervalMs: 1_000, frames: [buildFrame(1_000)] },
            clusters: [],
            clusterPriceBucketSize: 50,
            clusterIntervalMs: 60_000,
            gaps: [],
            bars: EMPTY_BAR_WINDOW,
            previousRevision: 0,
            floorPercentile: DEFAULT_FLOOR_PERCENTILE,
            saturationPercentile: DEFAULT_SATURATION_PERCENTILE,
        });
    }

    it('re-bins a streamed cluster onto the grid the window is using', () => {
        const dataset = buildGroupedDataset();

        const extended = appendClusters(dataset, [{
            executedAtMs: 5_000,
            priceBucketIndex: 7_894,
            buyQuantity: 1,
            sellQuantity: 0,
            tradeCount: 1,
            largestTradeQuantity: 1,
        }]);

        expect(extended.clusters[0]?.priceBucketIndex).toBe(1_578);
    });

    it('leaves the index alone when the window is on the stored grid', () => {
        const dataset = buildDataset(1_000);

        const extended = appendClusters(dataset, [{
            executedAtMs: 5_000,
            priceBucketIndex: 7_894,
            buyQuantity: 1,
            sellQuantity: 0,
            tradeCount: 1,
            largestTradeQuantity: 1,
        }]);

        expect(extended.clusters[0]?.priceBucketIndex).toBe(7_894);
    });

    it('carries the cluster time grid through', () => {
        expect(buildGroupedDataset().clusterIntervalMs).toBe(60_000);
    });
});

describe('replaceDataset saturation stability', () => {
    function buildWith(quantity: number, previousSaturationQuantity?: number) {
        const touchBucket = 100;
        const frame: LiquidityFrame = {
            capturedAtMs: 1_000,
            bestBidPrice: 1_000,
            bestAskPrice: 1_001,
            bids: { lowestBucketIndex: touchBucket - 1, quantities: Float32Array.from([quantity]) },
            asks: { lowestBucketIndex: touchBucket, quantities: Float32Array.from([quantity]) },
        };
        return replaceDataset({
            instrumentSymbol: 'BTCUSDT',
            window: { priceBucketSize: 10, sampleIntervalMs: 1_000, frames: [frame] },
            clusters: [],
            clusterPriceBucketSize: 10,
            clusterIntervalMs: 1_000,
            gaps: [],
            bars: EMPTY_BAR_WINDOW,
            previousRevision: 0,
            floorPercentile: DEFAULT_FLOOR_PERCENTILE,
            saturationPercentile: DEFAULT_SATURATION_PERCENTILE,
            ...(previousSaturationQuantity === undefined ? {} : { previousSaturationQuantity }),
        });
    }

    it('adopts the measured value on the first window', () => {
        expect(buildWith(100).saturationQuantity).toBe(100);
    });

    it('holds the previous value through a small drift', () => {
        expect(buildWith(110, 100).saturationQuantity).toBe(100);
    });

    it('adopts a genuinely different value', () => {
        expect(buildWith(400, 100).saturationQuantity).toBe(400);
    });

    it('adapts away from the empty placeholder', () => {
        expect(buildWith(300, 1).saturationQuantity).toBe(300);
    });
});

describe('recutDataset', () => {
    /** A hundred distinct sizes, so the percentiles have somewhere to move. */
    function buildSpreadDataset() {
        const quantities = Float32Array.from({ length: 100 }, (_unused, index) => index + 1);
        return replaceDataset({
            instrumentSymbol: 'BTCUSDT',
            window: {
                priceBucketSize: 10,
                sampleIntervalMs: 1_000,
                frames: [{
                    capturedAtMs: 1_000,
                    bestBidPrice: 100,
                    bestAskPrice: 101,
                    bids: { lowestBucketIndex: 0, quantities },
                    asks: { lowestBucketIndex: 100, quantities },
                }],
            },
            clusters: [],
            clusterPriceBucketSize: 10,
            clusterIntervalMs: 1_000,
            gaps: [],
            bars: EMPTY_BAR_WINDOW,
            previousRevision: 0,
            floorPercentile: DEFAULT_FLOOR_PERCENTILE,
            saturationPercentile: DEFAULT_SATURATION_PERCENTILE,
        });
    }

    it('raises the floor when the reader asks for a higher cut', () => {
        const dataset = buildSpreadDataset();

        const recut = recutDataset(dataset, 0.8, DEFAULT_SATURATION_PERCENTILE);

        expect(recut.floorQuantity).toBeGreaterThan(dataset.floorQuantity);
    });

    it('lowers the hot end when the upper cut comes down', () => {
        const dataset = buildSpreadDataset();

        const recut = recutDataset(dataset, DEFAULT_FLOOR_PERCENTILE, 0.6);

        expect(recut.saturationQuantity).toBeLessThan(dataset.saturationQuantity);
    });

    it('ignores the hysteresis, because the reader is watching for the change', () => {
        const dataset = buildSpreadDataset();

        const recut = recutDataset(dataset, 0.45, DEFAULT_SATURATION_PERCENTILE);

        expect(recut.floorQuantity).not.toBe(dataset.floorQuantity);
    });

    it('never lets the floor swallow the whole ramp', () => {
        const dataset = buildSpreadDataset();

        const recut = recutDataset(dataset, 0.9, DEFAULT_SATURATION_PERCENTILE);

        expect(recut.floorQuantity).toBeLessThan(recut.saturationQuantity);
    });

    it('advances the revision so the field repaints', () => {
        const dataset = buildSpreadDataset();

        expect(recutDataset(dataset, 0.6, 0.99).revision).toBe(dataset.revision + 1);
    });

    it('keeps the frames it was handed', () => {
        const dataset = buildSpreadDataset();

        expect(recutDataset(dataset, 0.6, 0.99).frames).toBe(dataset.frames);
    });
});

describe('foldFramesIntoBars', () => {
    const INTERVAL_MS = 60_000;

    function buildWindow(bars: PriceBar[]): PriceBarWindow {
        return {
            instrumentSymbol: 'BTCUSDT',
            intervalMs: INTERVAL_MS,
            warmupBarsRequested: 0,
            warmupBarsReturned: 0,
            bars,
        };
    }

    function buildBar(openedAtMs: number, lastFrameAtMs: number): PriceBar {
        return {
            openedAtMs,
            closedAtMs: openedAtMs + INTERVAL_MS,
            openPrice: 100, highPrice: 100, lowPrice: 100, closePrice: 100,
            buyVolume: 0, sellVolume: 0, tradeCount: 0,
            expectedFrames: 60, frameCount: 1, isClosed: false,
            firstFrameAtMs: openedAtMs, lastFrameAtMs,
        };
    }

    function buildMidFrame(capturedAtMs: number, midPrice: number): LiquidityFrame {
        return {
            capturedAtMs,
            bestBidPrice: midPrice - 0.5,
            bestAskPrice: midPrice + 0.5,
            bids: { lowestBucketIndex: 9, quantities: Float32Array.from([1]) },
            asks: { lowestBucketIndex: 10, quantities: Float32Array.from([1]) },
        };
    }

    it('extends the bar a frame belongs to rather than waiting for a refetch', () => {
        // A refetch is only scheduled by a gesture, so without this an idle
        // chart shows bars minutes behind a depth field current to the second.
        const window = buildWindow([buildBar(60_000, 60_000)]);

        const folded = foldFramesIntoBars(window, [buildMidFrame(61_000, 130)]);

        expect(folded.bars).toHaveLength(1);
        expect(folded.bars[0]).toMatchObject({ highPrice: 130, closePrice: 130, frameCount: 2 });
    });

    it('opens the next bar when a frame crosses the boundary', () => {
        const window = buildWindow([buildBar(60_000, 119_000)]);

        const folded = foldFramesIntoBars(window, [buildMidFrame(120_000, 90)]);

        expect(folded.bars.map((bar) => bar.openedAtMs)).toEqual([60_000, 120_000]);
    });

    it('ignores a second the bars already hold', () => {
        const window = buildWindow([buildBar(60_000, 90_000)]);

        expect(foldFramesIntoBars(window, [buildMidFrame(90_000, 500)])).toBe(window);
    });

    it('keys on the newest frame the bars were built from, not on the loaded columns', () => {
        // On a wide window the loaded frames are averaged columns; keying on
        // those would fold the newest column into the bar a second time.
        const window = buildWindow([buildBar(60_000, 115_000)]);

        const folded = foldFramesIntoBars(window, [
            buildMidFrame(110_000, 999),
            buildMidFrame(118_000, 130),
        ]);

        expect(folded.bars[0]?.highPrice).toBe(130);
    });
});

describe('appendClusters volume', () => {
    const INTERVAL_MS = 60_000;

    function buildCluster(executedAtMs: number, buyQuantity: number, sellQuantity: number): TradeCluster {
        return {
            executedAtMs,
            priceBucketIndex: 1,
            buyQuantity,
            sellQuantity,
            tradeCount: 3,
            largestTradeQuantity: buyQuantity,
        };
    }

    function buildDataset(isClosed: boolean): ChartDataset {
        const bar: PriceBar = {
            openedAtMs: 60_000,
            closedAtMs: 60_000 + INTERVAL_MS,
            openPrice: 100, highPrice: 100, lowPrice: 100, closePrice: 100,
            buyVolume: 5, sellVolume: 1, tradeCount: 10,
            expectedFrames: 60, frameCount: 60, isClosed,
            firstFrameAtMs: 60_000, lastFrameAtMs: 119_000,
        };
        return {
            ...EMPTY_DATASET,
            bars: { instrumentSymbol: 'BTCUSDT', intervalMs: INTERVAL_MS, warmupBarsRequested: 0, warmupBarsReturned: 0, bars: [bar] },
        };
    }

    it('brings the bar still being built up to date with what just traded', () => {
        const dataset = buildDataset(false);

        const next = appendClusters(dataset, [buildCluster(90_000, 2, 3)]);

        expect(next.bars.bars[0]?.buyVolume).toBe(7);
        expect(next.bars.bars[0]?.sellVolume).toBe(4);
    });

    it('leaves a closed bar with what the archive counted for it', () => {
        // A cluster arriving late for a bar the archive already answered for
        // would otherwise be counted a second time.
        const dataset = buildDataset(true);

        const next = appendClusters(dataset, [buildCluster(90_000, 2, 3)]);

        expect(next.bars.bars[0]?.buyVolume).toBe(5);
    });

    it('ignores what traded outside the bar being built', () => {
        const dataset = buildDataset(false);

        const next = appendClusters(dataset, [buildCluster(500_000, 2, 3)]);

        expect(next.bars.bars[0]?.buyVolume).toBe(5);
    });

    it('counts a bucket read again only once towards the bar', () => {
        // Each arrival carries a bucket's running total, not what changed since
        // the last pass, so a bucket the tail re-reads while it fills would add
        // its whole volume to the bar again on every pass.
        const dataset = buildDataset(false);
        const afterFirstPass = appendClusters(dataset, [buildCluster(90_000, 2, 3)]);

        const afterSecondPass = appendClusters(afterFirstPass, [buildCluster(90_000, 2, 3)]);

        expect(afterSecondPass.bars.bars[0]?.buyVolume).toBe(7);
    });
});

describe('foldFramesIntoBars sealing', () => {
    const INTERVAL_MS = 60_000;

    function buildLiveWindow(): PriceBarWindow {
        return { instrumentSymbol: 'BTCUSDT', intervalMs: INTERVAL_MS, warmupBarsRequested: 0, warmupBarsReturned: 0, bars: [] };
    }

    function buildTick(capturedAtMs: number, midPrice: number): LiquidityFrame {
        return {
            capturedAtMs,
            bestBidPrice: midPrice, bestAskPrice: midPrice,
            priceBucketIndex: 0, bidQuantities: [], askQuantities: [],
        } as unknown as LiquidityFrame;
    }

    it('closes the bucket behind it once a new one opens', () => {
        // Nothing more can belong to a bucket whose time is over. Left open it
        // reads as still being built for the rest of the session, and is drawn
        // hollow beside bars no more finished than it is.
        const window = foldFramesIntoBars(buildLiveWindow(), [
            buildTick(0, 100),
            buildTick(30_000, 101),
            buildTick(60_000, 102),
        ]);

        expect(window.bars.map((bar) => bar.isClosed)).toEqual([true, false]);
    });

    it('leaves the bucket still being filled open', () => {
        const window = foldFramesIntoBars(buildLiveWindow(), [buildTick(0, 100), buildTick(1_000, 101)]);

        expect(window.bars).toHaveLength(1);
        expect(window.bars[0]?.isClosed).toBe(false);
    });
});
