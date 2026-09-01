import { clipToRegion, type FrameRegion, mergeFrameWindows } from '../../shared/core/frame-merge.ts';
import type { LiquidityFrameWindow } from '../../shared/core/liquidity-frame.ts';

/**
 * How many readings are kept before the oldest is let go.
 *
 * Enough that a reader who walks back over a stretch and forward again finds it
 * still there, which is the gesture a chart is used with more than any other.
 * Each is a window of a few megabytes, so this is tens of megabytes at worst.
 */
const KEPT_READINGS = 8;

/**
 * How much of what is being asked for must already be held to be worth keeping.
 *
 * Below this the pieces cost more round trips than one whole read, and a reader
 * who has jumped somewhere else entirely is better served by asking once.
 */
const LEAST_WORTHWHILE_OVERLAP = 0.2;

/** One reading, and the instants and prices it covers. */
interface Reading {
    readonly key: string;
    readonly region: FrameRegion;
    readonly window: LiquidityFrameWindow;
    /** When it was last useful, for deciding which to let go. */
    usedAt: number;
}

/** What a reader wants, and what of it is already held. */
export interface CachePlan {
    /** The part already held, clipped to what was asked for. */
    readonly held: LiquidityFrameWindow | null;
    /**
     * The stretches still to be read.
     *
     * At most three, and usually one: the instants ahead of what is held, the
     * instants behind it, and the prices beside it over the instants shared
     * with it. A drag across and up needs two of them — the stretch of time
     * that came into view over the whole band, and the stretch of prices that
     * came into view over the time that did not move.
     */
    readonly missing: readonly FrameRegion[];
}

/**
 * What the reader has already been given, kept so it is not asked for twice.
 *
 * The archive is cut into squares addressed on a fixed grid, and every read of
 * it lands on that grid whatever else it asked for. That is what makes one
 * reading usable inside the next: a reader who drags half a screen across has
 * half of what it is about to ask for, and one who walks back over a stretch it
 * has already seen has all of it.
 *
 * Kept as whole readings rather than as squares of their own. A reading is what
 * the gateway answers and what the chart draws, so keeping them in that shape
 * costs no conversion either way; what a square grid would buy over it is a
 * tighter fit at the edges, and the edges are the small part.
 */
export class WindowCache {
    private readings: Reading[] = [];
    private clock = 0;

    /**
     * What of a wanted region is already held, and what is left to read.
     *
     * @param key - What must match for two readings to be the same picture.
     * @param wanted - The instants and prices being asked for.
     * @returns The part held and the stretches still missing.
     */
    plan(key: string, wanted: FrameRegion): CachePlan {
        const best = this.bestFor(key, wanted);
        if (best === null) {
            return { held: null, missing: [wanted] };
        }
        best.usedAt = this.tick();
        return {
            held: clipToRegion(best.window, wanted),
            missing: missingRegions(best.region, wanted),
        };
    }

    /**
     * Keeps a reading, replacing whatever it wholly covers.
     *
     * @param key - What must match for two readings to be the same picture.
     * @param region - The instants and prices it covers.
     * @param window - The reading itself.
     */
    keep(key: string, region: FrameRegion, window: LiquidityFrameWindow): void {
        // A reading that covers an older one entirely makes it dead weight, and
        // a cache of nested readings answers no question the outer one does not.
        this.readings = this.readings.filter(
            (reading) => reading.key !== key || !covers(region, reading.region),
        );
        this.readings.push({ key, region, window, usedAt: this.tick() });
        if (this.readings.length > KEPT_READINGS) {
            this.readings.sort((left, right) => left.usedAt - right.usedAt);
            this.readings.shift();
        }
    }

    /** Forgets everything, for a reader that has changed what it is looking at. */
    clear(): void {
        this.readings = [];
    }

    /** The reading that covers most of what is wanted, or null when none is worth it. */
    private bestFor(key: string, wanted: FrameRegion): Reading | null {
        let best: Reading | null = null;
        let bestShare = LEAST_WORTHWHILE_OVERLAP;
        for (const reading of this.readings) {
            if (reading.key !== key) {
                continue;
            }
            const share = sharedShare(reading.region, wanted);
            if (share > bestShare) {
                best = reading;
                bestShare = share;
            }
        }
        return best;
    }

    private tick(): number {
        this.clock += 1;
        return this.clock;
    }
}

/** How much of what is wanted a reading already covers, as a share of its area. */
function sharedShare(held: FrameRegion, wanted: FrameRegion): number {
    const overlapMs = Math.min(held.toMs, wanted.toMs) - Math.max(held.fromMs, wanted.fromMs);
    const overlapPrice = Math.min(held.highPrice, wanted.highPrice)
        - Math.max(held.lowPrice, wanted.lowPrice);
    if (overlapMs <= 0 || overlapPrice <= 0) {
        return 0;
    }
    const wholeMs = Math.max(1, wanted.toMs - wanted.fromMs);
    const wholePrice = Math.max(Number.EPSILON, wanted.highPrice - wanted.lowPrice);
    return (overlapMs / wholeMs) * (overlapPrice / wholePrice);
}

/** Whether one region holds every instant and price of another. */
function covers(outer: FrameRegion, inner: FrameRegion): boolean {
    return outer.fromMs <= inner.fromMs && outer.toMs >= inner.toMs
        && outer.lowPrice <= inner.lowPrice && outer.highPrice >= inner.highPrice;
}

/**
 * The stretches of a wanted region a held one does not reach.
 *
 * Cut so that no two of them overlap: the instants outside the held stretch are
 * taken over the whole band, and the prices outside the held band only over the
 * instants that were inside it. Cut the other way round they would share their
 * corners, and a corner asked for twice is paid for twice.
 */
function missingRegions(held: FrameRegion, wanted: FrameRegion): readonly FrameRegion[] {
    const missing: FrameRegion[] = [];
    if (wanted.fromMs < held.fromMs) {
        missing.push({ ...wanted, toMs: Math.min(held.fromMs, wanted.toMs) });
    }
    if (wanted.toMs > held.toMs) {
        missing.push({ ...wanted, fromMs: Math.max(held.toMs, wanted.fromMs) });
    }

    const sharedFromMs = Math.max(held.fromMs, wanted.fromMs);
    const sharedToMs = Math.min(held.toMs, wanted.toMs);
    if (sharedToMs <= sharedFromMs) {
        return missing;
    }
    if (wanted.lowPrice < held.lowPrice) {
        missing.push({
            fromMs: sharedFromMs,
            toMs: sharedToMs,
            lowPrice: wanted.lowPrice,
            highPrice: Math.min(held.lowPrice, wanted.highPrice),
        });
    }
    if (wanted.highPrice > held.highPrice) {
        missing.push({
            fromMs: sharedFromMs,
            toMs: sharedToMs,
            lowPrice: Math.max(held.highPrice, wanted.lowPrice),
            highPrice: wanted.highPrice,
        });
    }
    return missing;
}

/**
 * One window built from what was held and the stretches just read.
 *
 * @param pieces - What was held and what came back, in any order.
 * @param wanted - The region the reader asked for.
 * @returns The window over that region, or null when the pieces disagree about
 *          the grid and so cannot be one picture.
 */
export function assembleWindow(
    pieces: readonly (LiquidityFrameWindow | null)[],
    wanted: FrameRegion,
): LiquidityFrameWindow | null {
    const carried = pieces.filter((piece): piece is LiquidityFrameWindow => piece !== null);
    const merged = mergeFrameWindows(carried);
    return merged === null ? null : clipToRegion(merged, wanted);
}
