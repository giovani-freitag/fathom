import type {
    BetweenRequest,
    FramesAfterRequest,
    LiveTailSource,
} from './live-tail.ts';
import type { LiquidityFrameWindow } from './liquidity-frame.ts';
import type { RecordingGap } from './recording-gap.ts';
import type { TradeCluster } from './trade-cluster.ts';

/** One window of depth, in the terms every store answers in. */
export interface StoredDepthWindowRequest {
    readonly instrumentSymbol: string;
    readonly fromMs: number;
    readonly toMs: number;
    readonly maxColumns: number;
    /** The prices on screen, for the stores that can narrow a read by them. */
    readonly lowPrice?: number;
    readonly highPrice?: number;
}

export interface StoredDepthTailSourceConfig {
    /** Reads a window out of the one store this tail speaks for. */
    readonly readWindow: (request: StoredDepthWindowRequest) => Promise<LiquidityFrameWindow>;
    /**
     * Where executions and holes come from.
     *
     * Neither is kept per store — there is one of each — so sharing them is not
     * mixing two answers into one. Depth is the only thing the stores keep their
     * own copy of, and it is the only thing this class redirects.
     */
    readonly rest: LiveTailSource;
    readonly readNowMs: () => number;
}

/**
 * A tail that streams depth out of one named store and nothing else.
 *
 * A tail extends the window the chart is already drawing, so it has to come out
 * of the store that window came from. Fed from another, the two disagree about
 * what they hold: the recording keeps a band around the price and the squares
 * keep the whole book, so the prices inside the band go on while the ones
 * outside it stop at the last written block — which draws as a row of teeth
 * along the live edge.
 */
export class StoredDepthTailSource implements LiveTailSource {
    private readonly config: StoredDepthTailSourceConfig;

    constructor(config: StoredDepthTailSourceConfig) {
        this.config = config;
    }

    /**
     * The instants this store recorded since the reader's last one.
     *
     * @param request - The instrument, the reader's place, and how many to take.
     * @returns The instants after that place, oldest first.
     */
    fetchFramesAfter(request: FramesAfterRequest): Promise<LiquidityFrameWindow> {
        // Strictly after: the reader already holds the instant it named, and a
        // window that included it would be discarded on arrival anyway.
        const fromMs = request.afterMs + 1;
        return this.config.readWindow({
            instrumentSymbol: request.symbol,
            fromMs,
            toMs: this.reachOf(fromMs, request),
            maxColumns: request.maxFrames,
            ...(request.lowPrice === undefined ? {} : { lowPrice: request.lowPrice }),
            ...(request.highPrice === undefined ? {} : { highPrice: request.highPrice }),
        });
    }

    /**
     * How far one pass reads, which is never further than it can answer whole.
     *
     * These stores read a stretch onto a budget of drawn columns: asked for
     * more instants than the budget, they fold the stretch down to fit, which is
     * right for a window and wrong for a tail. A tail moves its cursor to the
     * newest instant it delivered, so everything folded away between them is
     * never offered again — measured on a reader twenty minutes behind, one
     * instant in twelve arrived and the chart drew a column every twelfth second
     * with nothing between them. Reading a shorter stretch instead leaves the
     * rest for the next pass, which is a slower catch-up and a complete one.
     */
    private reachOf(fromMs: number, request: FramesAfterRequest): number {
        const nowMs = this.config.readNowMs();
        if (request.frameIntervalMs === undefined || !(request.frameIntervalMs > 0)) {
            return nowMs;
        }
        return Math.min(nowMs, fromMs + request.maxFrames * request.frameIntervalMs);
    }

    fetchTradeClustersBetween(request: BetweenRequest): Promise<readonly TradeCluster[]> {
        return this.config.rest.fetchTradeClustersBetween(request);
    }

    fetchGapsBetween(request: BetweenRequest): Promise<readonly RecordingGap[]> {
        return this.config.rest.fetchGapsBetween(request);
    }
}
