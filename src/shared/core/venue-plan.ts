/**
 * What a venue can and cannot do, said by whoever connected to it.
 *
 * The other half of the idea an indicator already follows: what the host has to
 * know is said by the one who knows it, before anything is fetched or drawn.
 */

/** How trustworthy the ordering of one venue's book updates is. */
export type BookGrade =
    /** Every update names the one before it. The strongest check there is. */
    | 'linked'
    /** Every update covers a span, and the spans have to meet. */
    | 'ranged'
    /** Every update is one past the last. Weaker, but checkable. */
    | 'stepped'
    /** Nothing in the update says where it sits. Nothing is checkable. */
    | 'unsequenced';

/** Whose clock an event carries. */
export type EventClock =
    /** The venue stamped it. */
    | 'venue'
    /** Nothing stamped it, so the engine stamps arrival and counts that it did. */
    | 'arrival';

/** Whether the tape says which side crossed the spread. */
export type TapeSiding = 'sided' | 'unsided';

/**
 * What the venue publishes of the resting book.
 *
 * Null on a venue that publishes none. The heatmap is then not offered for that
 * instrument at all — not offered and drawn black, because black already means
 * a price nothing rests at, and reusing it for "nobody said" is the invention
 * the gap ledger exists to prevent.
 */
export interface BookCapability {
    readonly grade: BookGrade;
    /**
     * Levels published per side, or every one of them.
     *
     * The most consequential line in the declaration. In a whole ladder an
     * absent price means nothing rests there; in a feed of fifty it means
     * nobody said. It also changes how the mirror is kept: a windowed feed
     * never sends a removal for a level that merely fell out of the window, so
     * the engine trims to this rank after every update. Without the trim, a
     * level a fast move pushed past the edge stands in the recording for hours
     * at the size it last had — a solid shelf that stopped existing when the
     * move started.
     */
    readonly levelsPerSide: number | 'all';
    /** How often the venue publishes at its fastest, which floors the frame clock. */
    readonly publishIntervalMs: number;
    readonly clock: EventClock;
}

/**
 * What the venue publishes of what actually traded.
 *
 * Null where it publishes nothing.
 */
export interface TapeCapability {
    readonly siding: TapeSiding;
    readonly clock: EventClock;
    /**
     * Whether prints carry an id that survives a replay.
     *
     * A resubscribe replays the last prints on several venues, and without an
     * id the engine cannot tell a replayed print from a new one — so the open
     * bucket double-counts while the closed ones vanish under the archive's own
     * conflict rule, over- and under-counting in the same breath.
     */
    readonly hasStableIds: boolean;
}

/**
 * One bar width the venue serves, and the phase its buckets open on.
 *
 * A pair rather than a number because of the anchor. A width alone assumes
 * every bucket opens on the epoch, and no venue's weekly bar starts on a
 * Thursday, which is where the epoch puts one. A width with the wrong phase
 * folds bars into a day whose boundary is hours out, silently, inside the
 * settled-session walk every multi-timeframe reading goes through.
 */
export interface BarRung {
    readonly widthMs: number;
    /** Milliseconds past the epoch that a bucket of this width opens on. */
    readonly anchorMs: number;
}

/**
 * What the venue serves of the past, and at which widths.
 *
 * Null where it serves none, and the engine then folds every bar itself out of
 * what it is recording.
 */
export interface BarCapability {
    /** Widths served. A rung not here is dropped, not raised. */
    readonly rungs: readonly BarRung[];
    /** Bars one request may return, which is the venue's own cap. */
    readonly barsPerRequest: number;
    readonly hasVolume: boolean;
    /**
     * Whether the candle splits its volume by the side that crossed.
     *
     * False is the ordinary case. One venue of any size publishes it, which is
     * why five shipped readings quietly assume every venue does — and why a
     * tape that names the aggressor buys those readings nothing over history,
     * where the bars come from here.
     */
    readonly hasBuyVolume: boolean;
    /**
     * Whether the candle counts its prints.
     *
     * Zero is a real answer everywhere else here — a bucket nobody traded in is
     * a quiet bucket — so a venue publishing no count has to say so rather than
     * have zero written across its whole history.
     */
    readonly hasTradeCount: boolean;
}

/**
 * Everything a venue can and cannot do, in the connector's own words.
 *
 * Every field is required and every capability is `T | null`. There is no
 * optional property here on purpose: an author has to write `null` to say no,
 * and writing it is the moment they read what the engine does instead. A
 * forgotten flag defaulting to yes is a connector that lies into an archive
 * that cannot be written twice; one defaulting to no is a chart quietly drawing
 * less than it could, for ever, with nobody told why.
 */
export interface VenueDeclaration {
    readonly book: BookCapability | null;
    readonly tape: TapeCapability | null;
    readonly bars: BarCapability | null;
}

/**
 * A fact about the venue that a reading cannot be computed without.
 *
 * The same idea as an indicator naming the rungs it reads, one level up.
 */
export type VenueFact =
    /** Resting size per price, at all. */
    | 'book'
    /** Every resting price, not a window onto the nearest few. */
    | 'wholeBook'
    /** What actually traded. */
    | 'tape'
    /** How much traded in a bar, either side of the spread. */
    | 'volume'
    /** Volume split by the side that crossed the spread. */
    | 'takerSplit'
    /** How many prints made a bar. */
    | 'tradeCount';

/**
 * Which of those facts a venue actually supplies.
 *
 * The taker split is read off the bars rather than off the tape. Five of the
 * shipped readings compute over the drawn bars, and outside the shipped venue
 * no candle endpoint carries a split — so a sided tape grants the fact only
 * where the bars are folded from that tape. Granting it off the tape alone
 * would draw cumulative delta correct over the collector's uptime and blank
 * before it, with the seam moving on every restart.
 *
 * @param declaration - What the connector declared.
 * @returns The facts a reading may rely on.
 */
export function readVenueFacts(declaration: VenueDeclaration): ReadonlySet<VenueFact> {
    const held = new Set<VenueFact>();

    if (declaration.book !== null) {
        held.add('book');
        if (declaration.book.levelsPerSide === 'all') {
            held.add('wholeBook');
        }
    }
    if (declaration.tape !== null) {
        held.add('tape');
    }

    const isSized = declaration.bars === null ? declaration.tape !== null : declaration.bars.hasVolume;
    if (isSized) {
        held.add('volume');
    }

    const isSplitInBars = declaration.bars === null
        ? declaration.tape?.siding === 'sided'
        : declaration.bars.hasBuyVolume;
    if (isSplitInBars === true) {
        held.add('takerSplit');
    }

    const isCounted = declaration.bars === null
        ? declaration.tape !== null
        : declaration.bars.hasTradeCount;
    if (isCounted) {
        held.add('tradeCount');
    }

    return held;
}

/**
 * The facts a reading asked for that the venue does not supply.
 *
 * @param needed - What the reading declared it reads.
 * @param offered - What the venue was found to supply.
 * @returns The shortfall, in the order the reading named it.
 */
export function findMissingFacts(
    needed: readonly VenueFact[],
    offered: ReadonlySet<VenueFact>,
): readonly VenueFact[] {
    return needed.filter((fact) => !offered.has(fact));
}
