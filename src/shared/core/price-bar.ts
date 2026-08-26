/**
 * One open-high-low-close bar of the recorded book mid, carrying what built it.
 *
 * Book mid rather than traded price is a choice, not a limit: a traded close is
 * derivable from the execution grid to within a hundredth of a percent. The mid
 * is what the recording is *of*, so it is what a bar of it should say.
 */
export interface PriceBar {
    /** Bucket edges. Always aligned; a bucket the query range clipped is never emitted. */
    readonly openedAtMs: number;
    readonly closedAtMs: number;
    readonly openPrice: number;
    readonly highPrice: number;
    readonly lowPrice: number;
    readonly closePrice: number;
    /** Frames a wholly recorded bucket of this width holds, from the instrument's grid. */
    /**
     * What traded inside the bucket, by which side crossed the spread.
     *
     * Zero is a real answer: a bucket the book was recorded through with nobody
     * trading is a quiet bucket, not a missing one.
     */
    readonly buyVolume: number;
    readonly sellVolume: number;
    readonly tradeCount: number;
    readonly expectedFrames: number;
    /** Frames that actually landed. Below `expectedFrames` on a closed bar, the bar is partial. */
    readonly frameCount: number;
    /**
     * False while the bucket can still grow.
     *
     * Without it, a short `frameCount` conflates two different facts: a bucket
     * the collector missed seconds of, and one that has simply not finished.
     */
    readonly isClosed: boolean;
    /** Later than `openedAtMs` when a gap straddles the bar's opening. */
    readonly firstFrameAtMs: number;
    readonly lastFrameAtMs: number;
}

/** A run of bars on one declared interval, oldest first. Absent buckets are omitted. */
export interface PriceBarWindow {
    readonly instrumentSymbol: string;
    /** Declared by the caller and honoured exactly; no surface width may influence it. */
    readonly intervalMs: number;
    readonly warmupBarsRequested: number;
    /** What the archive could supply. Below the request, the output is still converging. */
    readonly warmupBarsReturned: number;
    readonly bars: readonly PriceBar[];
}

export interface PriceBarQuery {
    readonly symbol: string;
    readonly fromMs: number;
    readonly toMs: number;
    readonly intervalMs: number;
    /** Bars before `fromMs`, at the same interval. Costs rows, never columns. */
    readonly warmupBars: number;
}

/** A window that holds nothing, for a chart that has not loaded one yet. */
export const EMPTY_BAR_WINDOW: PriceBarWindow = {
    instrumentSymbol: '',
    intervalMs: 1_000,
    warmupBarsRequested: 0,
    warmupBarsReturned: 0,
    bars: [],
};

/** How much of a bar's own width was recorded, and whether that is settled yet. */
export type BarCompleteness = 'forming' | 'partial' | 'whole';

/**
 * Reads a bar's completeness off what built it.
 *
 * @param bar - The bar to classify.
 * @returns Which of the three states it is in.
 */
export function classifyBar(bar: PriceBar): BarCompleteness {
    if (!bar.isClosed) {
        return 'forming';
    }
    return bar.frameCount < bar.expectedFrames ? 'partial' : 'whole';
}

/**
 * Bars are budgeted by what they scan and what they emit, never by the range asked for.
 *
 * A range is free to name a century; what it costs is bounded by the recording
 * that actually overlaps it.
 */
export const BAR_BUDGET = {
    maximumSourceFrames: 180_000,
    maximumBars: 2_000,
} as const;
