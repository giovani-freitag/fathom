import type { ChunkArchiveService, ChunkColumn } from './chunk-archive-service.ts';
import {
    COLUMNS_PER_CHUNK,
    columnsPerCell,
    LEVEL_COUNT,
    LEVEL_FACTOR,
    toColumnIndex,
} from '../../shared/codec/chunk-grid.ts';
import type { LiquidityFrame } from '../../shared/core/liquidity-frame.ts';
import { LARGEST_STEP, quantiseQuantity, type QuantityScale } from '../../shared/codec/tile-codec.ts';

/**
 * How many new columns a block still filling gathers before it is written again.
 *
 * The same reason the other stores hold back: repacking a growing block on
 * every instant is work on the path the recording runs on, and it was measured
 * making the recording clock miss instants.
 */
const COLUMNS_BETWEEN_REWRITES = 16;

/**
 * How long a coarse level may hold what it has gathered.
 *
 * Counted in time rather than in columns, because a column means something
 * different on every level: sixty-four of them is a minute at the finest and
 * four and a half hours at the coarsest, and a level written that seldom is one
 * a reader zooming out is answered from with nothing. A minute is a pixel on
 * every window those levels are read for.
 */
const COARSE_MS_BETWEEN_REWRITES = 60_000;

/**
 * A column of a block that nothing was recorded for.
 *
 * A block is addressed by where it sits, so its columns have to sit where they
 * belong in it, and one nobody recorded still takes its place. Nought for a
 * touch price is what says so: no book ever had one.
 */
const UNRECORDED_COLUMN: ChunkColumn = {
    bestBidPrice: 0, bestAskPrice: 0, steps: new Map<number, number>(),
};

/**
 * The scale every size in this store is placed on.
 *
 * Written down once and handed to the archive with the block, so that what the
 * sizes were placed on and what the block says they were placed on cannot be
 * two different numbers.
 */
const QUANTITY_SCALE_FLOOR = 0.0001;

export interface ChunkTileRecorderConfig {
    readonly archive: ChunkArchiveService;
    readonly priceRangeRatio: number;
    /** What one instant of the finest level covers. */
    readonly intervalMs: number;
    readonly stepRatio: number;
    readonly onWriteFailed?: (instrumentSymbol: string, reason: unknown) => void;
}

/** How one contract's whole book is framed, and who receives it. */
export interface ChunkRecording {
    readonly priceRangeRatio: number;
    readonly resolveBucketSize: (midPrice: number) => number;
    readonly intervalMs: number;
    readonly combine: 'sum' | 'largest';
    readonly onFrame: (frame: LiquidityFrame, priceBucketSize: number) => void;
}

/** One column being handed to a level, and when it happened. */
interface ColumnHandOver {
    readonly instrumentSymbol: string;
    readonly detailLevel: number;
    readonly column: ChunkColumn;
    readonly capturedAtMs: number;
}

/** One block being picked back up, and the level picking it up. */
interface BlockPickUp {
    readonly instrumentSymbol: string;
    readonly detailLevel: number;
    readonly level: Level;
    readonly startedAtMs: number;
}

/** One level being written out, and whether its block is finished. */
interface LevelWrite {
    readonly instrumentSymbol: string;
    readonly detailLevel: number;
    readonly level: Level;
    readonly isComplete: boolean;
}

/** One stored column of the finest level, offered back to the fold. */
export interface ColumnReplay {
    readonly instrumentSymbol: string;
    readonly priceBucketSize: number;
    readonly column: ChunkColumn;
    readonly capturedAtMs: number;
}

/** One column on its way into the column of the level above it. */
interface ColumnFold {
    readonly instrumentSymbol: string;
    readonly detailLevel: number;
    readonly columnIndex: number;
    readonly column: ChunkColumn;
}

/** One level's place: the block it is filling and what is folding into it. */
interface Level {
    /** The block being filled, or null before the first instant of one. */
    blockIndex: number | null;
    columns: ChunkColumn[];
    writtenColumns: number;
    /**
     * The stamp this recorder's own last write of the block left behind.
     *
     * Null before it has written one. What is stored carrying a different stamp
     * is what somebody else put there.
     */
    revision: string | null;
    /**
     * The column of the level above that is being built, and which one it is.
     *
     * Kept by the index the grid gives it rather than by how many children have
     * arrived. Counting arrivals means the group boundary is set by whatever
     * second the recording started on and moved again by every instant it drops:
     * measured, a level reproduced its own children shifted by one column in
     * five hundred and eleven of five hundred and twelve, and at the coarsest
     * level by three minutes of a four minute cell.
     */
    folding: { parentIndex: number; column: ChunkColumn } | null;
    /** The read that is picking a stored block back up, while it is running. */
    resuming: Promise<void> | null;
    /**
     * The writes of this level, one after another.
     *
     * A block is written whole and replaces what was there, so two writes in
     * the air together race: the one that finishes last wins, and it may be the
     * one holding fewer columns. Measured against the frame table, that lost
     * fourteen instants of a twenty minute window — whole columns, at times
     * that looked random because they were whichever write happened to lose.
     */
    writing: Promise<void>;
}

/**
 * Keeps the whole book as fixed squares, and every coarser level above it.
 *
 * Nothing here is recorded twice. Level nought holds the instants as they came;
 * every level above it is the largest of four instants of the one below, at the
 * prices they were already resting at, which is exact rather than approximate
 * because largest is associative. The levels exist so that a reader opening a month is handed a
 * few thousand columns instead of two and a half million — measured, three
 * tenths of a second instead of five and a half minutes — and they can be
 * dropped and rebuilt at any time, because none of them is a source of truth.
 *
 * A coarse level fills sixteen, then two hundred and fifty-six times slower
 * than the one below, so it is written only when a block completes. Rewriting
 * it as it fills would cost thirteen percent more for a live edge nobody
 * watching a month can see.
 */
export class ChunkTileRecorder {
    private readonly config: ChunkTileRecorderConfig;
    private readonly levels = new Map<string, Level[]>();
    private readonly bucketSizes = new Map<string, number>();
    /**
     * The instants of each contract, taken one after another.
     *
     * Taking them in parallel let two cross a block boundary together: both see
     * the old block, both close it, and the second clears the columns the first
     * had already started filling — measured, a blank first column in thirty of
     * three hundred and thirty-six blocks, over a second the frame table holds.
     */
    private readonly accepting = new Map<string, Promise<void>>();

    constructor(config: ChunkTileRecorderConfig) {
        this.config = config;
    }

    /**
     * The framing one contract's whole book is recorded under.
     *
     * @param instrumentSymbol - The contract the frames will belong to.
     * @param priceBucketSize - The grid that contract is recorded on.
     * @returns What the recorder needs to build and deliver them.
     */
    buildRecording(instrumentSymbol: string, priceBucketSize: number): ChunkRecording {
        return {
            priceRangeRatio: this.config.priceRangeRatio,
            resolveBucketSize: () => priceBucketSize,
            intervalMs: this.config.intervalMs,
            combine: 'sum',
            onFrame: (frame, grid) => { this.accept(instrumentSymbol, frame, grid); },
        };
    }

    /**
     * Resolves once every write already queued has run.
     *
     * The writes are queued behind one another and left unawaited, so that a
     * slow archive never holds up the capture. Anyone who needs to know the
     * archive has caught up — a shutdown, a reader about to measure it — has to
     * be able to ask.
     */
    async settled(): Promise<void> {
        // Twice over: taking an instant queues the write of a level, and that
        // write's own folding queues one on the level above it.
        for (let pass = 0; pass < 2; pass += 1) {
            await Promise.all([...this.accepting.values()]);
            await Promise.all([...this.levels.values()]
                .flatMap((levels) => levels.map((level) => level.writing)));
        }
    }

    /**
     * Writes out every block still filling, whatever it has gathered.
     */
    async flush(): Promise<void> {
        // The instants are taken one after another and left unawaited, so there
        // may be some still waiting their turn. Written out without them, the
        // block replaces what is stored with less than it holds.
        await this.settled();
        const pending = [...this.levels];
        for (const [instrumentSymbol, levels] of pending) {
            for (const [detailLevel, level] of levels.entries()) {
                await this.store({ instrumentSymbol, detailLevel, level, isComplete: false });
            }
        }
    }

    /** Takes one whole-book instant onto the finest level. */
    private accept(
        instrumentSymbol: string,
        frame: LiquidityFrame,
        priceBucketSize: number,
    ): void {
        if (this.bucketSizes.get(instrumentSymbol) !== priceBucketSize) {
            this.levels.set(instrumentSymbol, buildLevels());
            this.bucketSizes.set(instrumentSymbol, priceBucketSize);
        }

        const queued = (this.accepting.get(instrumentSymbol) ?? Promise.resolve())
            .then(() => this.offer({
                instrumentSymbol,
                detailLevel: 0,
                column: toColumn(frame, this.config.stepRatio),
                capturedAtMs: frame.capturedAtMs,
            }));
        this.accepting.set(instrumentSymbol, queued.catch(() => undefined));
    }

    /**
     * Offers one column to a level, folding it upward when four have gathered.
     */
    private async offer(handOver: ColumnHandOver): Promise<void> {
        const { instrumentSymbol, detailLevel, column, capturedAtMs } = handOver;
        if (detailLevel >= LEVEL_COUNT) {
            return;
        }
        const levels = this.levels.get(instrumentSymbol) ?? buildLevels();
        this.levels.set(instrumentSymbol, levels);
        const level = levels[detailLevel]!;

        const columnIntervalMs = this.config.intervalMs * columnsPerCell(detailLevel);
        const columnIndex = toColumnIndex(detailLevel, capturedAtMs, this.config.intervalMs);
        const blockIndex = Math.floor(columnIndex / COLUMNS_PER_CHUNK);
        if (level.blockIndex !== null && level.blockIndex !== blockIndex) {
            await this.store({ instrumentSymbol, detailLevel, level, isComplete: true });
            level.columns = [];
            level.writtenColumns = 0;
        }
        if (level.blockIndex !== blockIndex) {
            level.blockIndex = blockIndex;
            // Picked back up rather than started over. A block is written whole,
            // so a recorder that began from an empty one would replace what is
            // stored with what it has gathered since — and a block of the
            // coarsest level spans six days.
            level.resuming = this.resume({
                instrumentSymbol,
                detailLevel,
                level,
                startedAtMs: blockIndex * COLUMNS_PER_CHUNK * columnIntervalMs,
            });
        }
        await level.resuming;
        // Placed where it belongs in the block, not after whatever came before.
        // A recording that starts halfway through a block, or one that misses an
        // instant, would otherwise shift every column after it: the reader dates
        // a column by its position, so a column out of place is a column drawn
        // at a time it never happened.
        const withinBlock = columnIndex - blockIndex * COLUMNS_PER_CHUNK;
        while (level.columns.length < withinBlock) {
            level.columns.push(UNRECORDED_COLUMN);
        }
        level.columns[withinBlock] = column;

        // Every level is written as it fills, coarse ones included. Held back
        // until their block completed they would be empty for the hours one
        // takes, and a reader zooming out would be answered with nothing at all.
        if (level.columns.length - level.writtenColumns
            >= columnsBetweenRewrites(detailLevel, columnIntervalMs)) {
            await this.store({ instrumentSymbol, detailLevel, level, isComplete: false });
        }

        await this.foldUpward({ instrumentSymbol, detailLevel, columnIndex, column });
    }

    /**
     * Rebuilds the levels above the finest from a column already recorded.
     *
     * Every level above the finest is derived, so a change to how they fold
     * leaves what is stored wrong until it is built again — and it is built as
     * the recording runs, which means a day of history waits a day to be worth
     * reading. This walks the finest level back through the same fold, so the
     * levels above it are what they would have been.
     *
     * @param replay - The contract, its grid, one stored column and its instant.
     */
    async replay(replay: ColumnReplay): Promise<void> {
        const { instrumentSymbol, priceBucketSize } = replay;
        if (this.bucketSizes.get(instrumentSymbol) !== priceBucketSize) {
            this.levels.set(instrumentSymbol, buildLevels());
            this.bucketSizes.set(instrumentSymbol, priceBucketSize);
        }
        // Straight to the fold, never to the store: the finest level is the
        // recording itself and rewriting it from a read of itself could only
        // ever lose something.
        await this.foldUpward({
            instrumentSymbol,
            detailLevel: 0,
            columnIndex: toColumnIndex(0, replay.capturedAtMs, this.config.intervalMs),
            column: replay.column,
        });
    }

    /**
     * Merges one column into the column of the level above that covers it.
     *
     * Handed up as soon as that column changes — so a cell always holds the
     * instants its own address covers, and the live edge is never held back
     * waiting for a group to fill.
     */
    private async foldUpward(fold: ColumnFold): Promise<void> {
        const { instrumentSymbol, detailLevel, columnIndex, column } = fold;
        const levels = this.levels.get(instrumentSymbol) ?? buildLevels();
        this.levels.set(instrumentSymbol, levels);
        const level = levels[detailLevel]!;

        const parentIndex = Math.floor(columnIndex / LEVEL_FACTOR);
        const held = level.folding?.parentIndex === parentIndex ? level.folding.column : null;
        level.folding = { parentIndex, column: mergeColumns(held, column) };
        await this.handUp(instrumentSymbol, detailLevel, level.folding);
    }

    /**
     * Offers a level's column to the level above, at the instant it addresses.
     */
    private async handUp(
        instrumentSymbol: string,
        detailLevel: number,
        folding: { parentIndex: number; column: ChunkColumn },
    ): Promise<void> {
        await this.offer({
            instrumentSymbol,
            detailLevel: detailLevel + 1,
            column: folding.column,
            // The first instant of the parent's own cell, so the level above
            // addresses it by the grid rather than by when it happened to hear.
            capturedAtMs: folding.parentIndex
                * this.config.intervalMs * columnsPerCell(detailLevel + 1),
        });
    }

    /**
     * Fills a level's block with what is already stored for it.
     *
     * Once per block: everything after it is gathered in memory and written over
     * the top. A read that fails leaves the block empty, which loses what was
     * stored — the alternative is refusing to record at all, which loses more.
     */
    private async resume(pick: BlockPickUp): Promise<void> {
        const { level } = pick;
        try {
            const stored = await this.config.archive.readBlock({
                instrumentSymbol: pick.instrumentSymbol,
                detailLevel: pick.detailLevel,
                startedAtMs: pick.startedAtMs,
            });
            level.revision = await this.config.archive.readBlockRevision({
                instrumentSymbol: pick.instrumentSymbol,
                detailLevel: pick.detailLevel,
                startedAtMs: pick.startedAtMs,
            });
            if (stored.length > level.columns.length) {
                // Whatever arrived while the read was running stays where it is.
                for (let column = 0; column < stored.length; column += 1) {
                    if (level.columns[column] === undefined) {
                        level.columns[column] = stored[column]!;
                    }
                }
            }
            level.writtenColumns = level.columns.length;
        } catch (reason) {
            this.config.onWriteFailed?.(pick.instrumentSymbol, reason);
        }
    }

    /** Stores what a level has gathered, letting the recording carry on if it will not. */
    private store(write: LevelWrite): Promise<void> {
        // Queued behind whatever this level is already writing, and over a copy
        // of the columns: a block is written whole, so two writes racing let the
        // slower one put back a block missing everything the faster one added.
        const queued = write.level.writing.then(() => this.storeNow(write));
        write.level.writing = queued.catch(() => undefined);
        return queued;
    }

    /**
     * What a block holds once what is stored is laid under what was gathered.
     *
     * A block is written whole, so a recorder that writes only what it gathered
     * replaces everything another writer has put there since it picked the
     * block up. One block of the coarsest level covers six days, which is every
     * backfill and every rebuild of the levels running against the live
     * recording at once — and the loser of that race is whichever of them wrote
     * first, silently, in the store the chart reads.
     *
     * Laying them over one another is exact rather than a compromise: every
     * level above the finest is a fold by the largest, so a cell both writers
     * hold agrees, and one only a single writer holds is a cell the other never
     * looked at.
     */
    private async gathered(pick: BlockPickUp): Promise<ChunkColumn[]> {
        const held = [...pick.level.columns];
        const resume = {
            instrumentSymbol: pick.instrumentSymbol,
            detailLevel: pick.detailLevel,
            startedAtMs: pick.startedAtMs,
        };
        let stored: readonly ChunkColumn[];
        try {
            // Only when the block is not standing on this recorder's own last
            // write. In a recording nobody else is writing that is never, and
            // reading the block anyway costs a fifth of a second every time a
            // level is written out — more than the recording itself costs.
            if (await this.config.archive.readBlockRevision(resume) === pick.level.revision) {
                return held;
            }
            stored = await this.config.archive.readBlock(resume);
        } catch (reason) {
            // What was gathered is written anyway. Refusing would hold the live
            // edge back for as long as the read keeps failing, and the reader
            // would watch the chart stop.
            this.config.onWriteFailed?.(pick.instrumentSymbol, reason);
            return held;
        }

        const columns: ChunkColumn[] = [];
        for (let column = 0; column < Math.max(held.length, stored.length); column += 1) {
            columns.push(overlay(stored[column], held[column]));
        }
        return columns;
    }

    /** Writes one level's block out, as it stands the moment its turn comes. */
    private async storeNow(write: LevelWrite): Promise<void> {
        const { instrumentSymbol, detailLevel, level, isComplete } = write;
        const priceBucketSize = this.bucketSizes.get(instrumentSymbol);
        if (level.blockIndex === null || level.columns.length === 0 || priceBucketSize === undefined) {
            return;
        }

        const columnIntervalMs = this.config.intervalMs * columnsPerCell(detailLevel);
        const startedAtMs = level.blockIndex * COLUMNS_PER_CHUNK * columnIntervalMs;
        const columns = await this.gathered({
            instrumentSymbol, detailLevel, level, startedAtMs,
        });
        try {
            level.revision = await this.config.archive.writeBlock({
                instrumentSymbol,
                detailLevel,
                columnIntervalMs,
                // The same grid at every level: a level folds instants, not
                // prices.
                priceBucketSize,
                scale: toScale(this.config.stepRatio),
                startedAtMs,
                columns,
                isComplete,
            });
            level.writtenColumns = columns.length;
        } catch (reason) {
            this.config.onWriteFailed?.(instrumentSymbol, reason);
        }
    }
}

/** Whether a column is a reading of the book or a place kept for one. */
function isRecorded(column: ChunkColumn): boolean {
    return column.steps.size > 0 || column.bestBidPrice > 0;
}

/**
 * One column holding everything either reading of it held.
 *
 * @param stored - What the store had there, or nothing.
 * @param held - What this recorder gathered there, or nothing.
 * @returns Both of them, or whichever of them is a reading at all.
 */
function overlay(stored: ChunkColumn | undefined, held: ChunkColumn | undefined): ChunkColumn {
    if (held === undefined || !isRecorded(held)) {
        return stored ?? held ?? UNRECORDED_COLUMN;
    }
    if (stored === undefined || !isRecorded(stored)) {
        return held;
    }
    return mergeColumns(stored, held);
}

/**
 * How many new columns a level gathers before it is written out again.
 *
 * The finest level carries the live edge, so it is held to a count: sixteen
 * instants, which is what the recording clock can afford to have repacked.
 *
 * Every level above it is held to a stretch of TIME instead, because a column
 * means something different on each: sixty-four of them is a minute at the
 * finest and four and a half hours at the coarsest. Counted in columns, a
 * coarse level writes when its block opens and then not again for hours —
 * measured on a live archive, an hour of recording left level three holding a
 * single column, and a reader zooming out was answered with one stripe.
 *
 * @param detailLevel - Nought for the finest.
 * @param columnIntervalMs - What one column of that level covers.
 * @returns Columns to gather first, at least one.
 */
export function columnsBetweenRewrites(detailLevel: number, columnIntervalMs: number): number {
    if (detailLevel === 0) {
        return COLUMNS_BETWEEN_REWRITES;
    }
    return Math.max(1, Math.round(COARSE_MS_BETWEEN_REWRITES / Math.max(1, columnIntervalMs)));
}

/** The scale a recorder's sizes are placed on, at its configured precision. */
function toScale(stepRatio: number): QuantityScale {
    return { stepRatio, smallestQuantity: QUANTITY_SCALE_FLOOR };
}

/** A level for every step of the pyramid, all empty. */
function buildLevels(): Level[] {
    return Array.from({ length: LEVEL_COUNT }, () => ({
        blockIndex: null,
        columns: [],
        writtenColumns: 0,
        revision: null,
        folding: null,
        resuming: null,
        writing: Promise.resolve(),
    }));
}

/** One frame as steps by bucket, on the scale the store writes. */
function toColumn(frame: LiquidityFrame, stepRatio: number): ChunkColumn {
    const scale = toScale(stepRatio);
    const steps = new Map<number, number>();
    for (const ladder of [frame.bids, frame.asks]) {
        for (let index = 0; index < ladder.quantities.length; index += 1) {
            const quantity = ladder.quantities[index] ?? 0;
            if (quantity <= 0) {
                continue;
            }
            const bucketIndex = ladder.lowestBucketIndex + index;
            const step = quantiseQuantity(quantity, scale, LARGEST_STEP);
            steps.set(bucketIndex, Math.max(steps.get(bucketIndex) ?? 0, step));
        }
    }
    return { bestBidPrice: frame.bestBidPrice, bestAskPrice: frame.bestAskPrice, steps };
}

/**
 * One more child merged into the column of the level above it.
 *
 * Largest at each price. Largest rather than a total or a mean because a wall
 * that stood through any part of the group is a wall that stood, and it is the
 * thing a reader zoomed out is looking for; and because largest is associative
 * and idempotent, merging one child at a time gives the same answer as merging
 * all four at once, and merging one twice changes nothing. That is what lets a
 * parent be handed up on every child rather than held back until its group is
 * full.
 *
 * Prices are kept where they are. A level folds instants together and nothing
 * else: the two axes of this chart are zoomed apart, and a reader who widens
 * the hours is not asking for coarser prices — measured over a day, prices
 * folded alongside the instants drew the book as seven bands a hundred and
 * twenty-eight pixels tall, where the pane had room for a hundred and twelve.
 */
function mergeColumns(parent: ChunkColumn | null, child: ChunkColumn): ChunkColumn {
    const steps = new Map(parent?.steps);
    for (const [bucketIndex, step] of child.steps) {
        if (step > (steps.get(bucketIndex) ?? 0)) {
            steps.set(bucketIndex, step);
        }
    }
    return { bestBidPrice: child.bestBidPrice, bestAskPrice: child.bestAskPrice, steps };
}
