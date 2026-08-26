import type { InstrumentCoverage } from '../../shared/core/api-contract.ts';
import type { ChartViewport, ViewportBounds } from './chart-viewport.ts';
import { type ChartDataset, newestFrameTimestamp } from './chart-dataset.ts';

const MINIMUM_SPAN_MS = 5_000;
const MAXIMUM_SPAN_MS = 90 * 24 * 60 * 60 * 1_000;

/** Fraction of mid price shown on first load, where the working book actually is. */
const INITIAL_PRICE_RANGE_RATIO = 0.004;

/** A price span narrower than this many buckets stops being a chart. */
const MINIMUM_PRICE_BUCKETS = 4;

export interface BoundsRequest {
    readonly instrument: InstrumentCoverage | undefined;
    readonly priceBucketSize: number;
    readonly nowMs: number;
}

/**
 * The limits a viewport is never allowed past.
 *
 * @param request - The instrument's recorded extent, the price grid, and the clock.
 * @returns Bounds for `clampViewport`.
 */
export function resolveViewportBounds(request: BoundsRequest): ViewportBounds {
    return {
        earliestMs: request.instrument?.firstFrameAtMs ?? 0,
        // The tail may be seconds ahead of the newest frame the viewer holds, so
        // the edge follows the clock rather than the data.
        latestMs: Math.max(request.nowMs, request.instrument?.lastFrameAtMs ?? 0),
        minimumSpanMs: MINIMUM_SPAN_MS,
        maximumSpanMs: MAXIMUM_SPAN_MS,
        minimumPriceSpan: request.priceBucketSize * MINIMUM_PRICE_BUCKETS,
    };
}

/**
 * Slides the right edge onto the newest frame, keeping the span.
 *
 * @param viewport - The viewport to advance.
 * @param dataset - The window holding the newest frame.
 * @returns The advanced viewport, or the original when nothing is newer.
 */
export function followLiveEdge(viewport: ChartViewport, dataset: ChartDataset): ChartViewport {
    const newestMs = newestFrameTimestamp(dataset);
    if (newestMs === null || newestMs <= viewport.toMs) {
        return viewport;
    }
    return { ...viewport, fromMs: viewport.fromMs + (newestMs - viewport.toMs), toMs: newestMs };
}

/**
 * Recentres the price axis once the book has left the screen entirely.
 *
 * @param viewport - The viewport to correct.
 * @param dataset - The window holding the newest touch.
 * @returns The recentred viewport, or the original when the touch is on screen.
 */
export function followTouchPrice(viewport: ChartViewport, dataset: ChartDataset): ChartViewport {
    const newestFrame = dataset.frames[dataset.frames.length - 1];
    if (newestFrame === undefined) {
        return viewport;
    }

    const touchPrice = (newestFrame.bestBidPrice + newestFrame.bestAskPrice) / 2;
    if (touchPrice >= viewport.lowPrice && touchPrice <= viewport.highPrice) {
        return viewport;
    }

    const halfSpan = (viewport.highPrice - viewport.lowPrice) / 2;
    return { ...viewport, lowPrice: touchPrice - halfSpan, highPrice: touchPrice + halfSpan };
}

/** Clear space above and below a price range framed on the price itself. */
const PRICE_FRAME_PADDING = 0.15;

/**
 * Frames the price axis on what is being drawn, for the first window of a session.
 *
 * A band wide enough to hold the book is the right band while the book is being
 * drawn: it is what the map needs, and the price sits inside it. It is the wrong
 * band once the book is off, because the price is then the only thing on the
 * axis and a band four times its travel leaves every candle a sliver.
 *
 * @param viewport - The viewport to frame.
 * @param dataset - The window holding the newest touch and the bars.
 * @param isDepthVisible - Whether the book is being drawn.
 * @returns The framed viewport, or the original when nothing is loaded.
 */
export function frameOnBook(
    viewport: ChartViewport,
    dataset: ChartDataset,
    isDepthVisible = true,
): ChartViewport {
    const framedOnPrice = isDepthVisible ? null : frameOnBars(viewport, dataset);
    if (framedOnPrice !== null) {
        return framedOnPrice;
    }

    const newestFrame = dataset.frames[dataset.frames.length - 1];
    if (newestFrame === undefined) {
        return viewport;
    }

    const midPrice = (newestFrame.bestBidPrice + newestFrame.bestAskPrice) / 2;
    const halfRange = midPrice * INITIAL_PRICE_RANGE_RATIO;
    return { ...viewport, lowPrice: midPrice - halfRange, highPrice: midPrice + halfRange };
}

/**
 * The band the bars themselves cover, with head-room.
 */
function frameOnBars(viewport: ChartViewport, dataset: ChartDataset): ChartViewport | null {
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (const bar of dataset.bars.bars) {
        low = Math.min(low, bar.lowPrice);
        high = Math.max(high, bar.highPrice);
    }

    if (low > high) {
        return null;
    }
    // A window where price never moved would otherwise frame onto nothing.
    const padding = Math.max((high - low) * PRICE_FRAME_PADDING, high * Number.EPSILON, 1e-8);
    return { ...viewport, lowPrice: low - padding, highPrice: high + padding };
}

/**
 * Stored price buckets per returned execution bucket.
 *
 * @param viewport - The visible price range.
 * @param priceBucketSize - Height of one stored bucket.
 * @returns How many stored buckets each returned bucket should cover.
 */
export function resolveTradePriceGroupSize(
    viewport: ChartViewport,
    priceBucketSize: number,
): number {
    const priceSpan = viewport.highPrice - viewport.lowPrice;
    if (priceSpan <= 0 || priceBucketSize <= 0) {
        return 1;
    }
    return Math.max(1, Math.round((priceSpan / priceBucketSize) / 220));
}

/**
 * How much history exists for an instrument.
 *
 * @param instruments - Everything the archive reports.
 * @param instrumentSymbol - The contract on screen, if one is chosen.
 * @returns Milliseconds between the first and newest recorded frame.
 */
export function resolveRecordedSpanMs(
    instruments: readonly InstrumentCoverage[],
    instrumentSymbol: string | null,
): number {
    const instrument = instruments.find(
        (candidate) => candidate.instrumentSymbol === instrumentSymbol,
    );
    if (instrument?.firstFrameAtMs == null || instrument.lastFrameAtMs == null) {
        return 0;
    }
    return Math.max(0, instrument.lastFrameAtMs - instrument.firstFrameAtMs);
}
