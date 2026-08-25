import type { LiquidityFrame } from '../../shared/core/liquidity-frame.ts';

/** Narrowest a candle can be drawn and still read as a body with wicks. */
const MINIMUM_CANDLE_WIDTH_PX = 7;

/** One open-high-low-close bar, derived from the frames inside one time bin. */
export interface Candle {
    readonly openedAtMs: number;
    readonly closedAtMs: number;
    readonly openPrice: number;
    readonly highPrice: number;
    readonly lowPrice: number;
    readonly closePrice: number;
}

export interface CandleSeriesRequest {
    readonly frames: readonly LiquidityFrame[];
    readonly fromMs: number;
    readonly toMs: number;
    readonly plotWidthPx: number;
    /** Spacing the frames were sampled at, which no bin may be finer than. */
    readonly sampleIntervalMs: number;
}

/**
 * Turns recorded frames into candles wide enough to read.
 *
 * The bin is chosen from the surface rather than fixed, so zooming changes how
 * much each candle summarises instead of leaving a row of one-pixel slivers.
 *
 * @param request - The frames in view and the surface they must fit.
 * @returns The candles, oldest first.
 */
export function buildCandleSeries(request: CandleSeriesRequest): readonly Candle[] {
    const binMs = chooseBinMs(request);
    if (binMs <= 0 || request.frames.length === 0) {
        return [];
    }

    const candles: Candle[] = [];
    let open: OpenCandle | null = null;

    for (const frame of request.frames) {
        const midPrice = (frame.bestBidPrice + frame.bestAskPrice) / 2;
        if (midPrice <= 0) {
            continue;
        }

        const binStartMs = Math.floor(frame.capturedAtMs / binMs) * binMs;
        if (open === null || open.binStartMs !== binStartMs) {
            if (open !== null) {
                candles.push(sealCandle(open, binMs));
            }
            open = {
                binStartMs,
                openPrice: midPrice,
                highPrice: midPrice,
                lowPrice: midPrice,
                closePrice: midPrice,
            };
            continue;
        }

        open.highPrice = Math.max(open.highPrice, midPrice);
        open.lowPrice = Math.min(open.lowPrice, midPrice);
        open.closePrice = midPrice;
    }

    if (open !== null) {
        candles.push(sealCandle(open, binMs));
    }
    return candles;
}

/**
 * How much time one candle covers on the current surface.
 *
 * @param request - The frames in view and the surface they must fit.
 * @returns The bin width in milliseconds, never finer than the recording.
 */
export function chooseBinMs(request: CandleSeriesRequest): number {
    const spanMs = request.toMs - request.fromMs;
    if (spanMs <= 0 || request.plotWidthPx <= 0) {
        return 0;
    }

    const msPerPixel = spanMs / request.plotWidthPx;
    const wanted = msPerPixel * MINIMUM_CANDLE_WIDTH_PX;
    const floor = Math.max(1, request.sampleIntervalMs);

    return Math.max(floor, Math.ceil(wanted / floor) * floor);
}

interface OpenCandle {
    binStartMs: number;
    openPrice: number;
    highPrice: number;
    lowPrice: number;
    closePrice: number;
}

function sealCandle(open: OpenCandle, binMs: number): Candle {
    return {
        openedAtMs: open.binStartMs,
        closedAtMs: open.binStartMs + binMs,
        openPrice: open.openPrice,
        highPrice: open.highPrice,
        lowPrice: open.lowPrice,
        closePrice: open.closePrice,
    };
}
