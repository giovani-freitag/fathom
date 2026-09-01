import { beforeAll, describe, expect, it } from 'vitest';
import { PostgresChunkRowStore } from '../../../src/database/postgres/postgres-chunk-row-store.ts';
import { ChunkArchiveService, type ChunkColumn } from '../../../src/database/services/chunk-archive-service.ts';
import { ChunkTileRecorder } from '../../../src/database/services/chunk-tile-recorder.ts';
import { createChunkStoreMock } from '../../mocks/chunk-store.ts';
import type { LiquidityFrame } from '../../../src/shared/core/liquidity-frame.ts';
import { COLUMNS_PER_CHUNK, ROWS_PER_CHUNK } from '../../../src/shared/codec/chunk-grid.ts';

const BUCKET_SIZE = 10;
const INTERVAL_MS = 1_000;
const STEP_RATIO = 1.07;
/**
 * Deliberately NOT on a block boundary.
 *
 * A recording starts when the collector starts, which is halfway through a
 * block far more often than not. A block is addressed by where it sits, so its
 * columns have to sit where they belong in it: a run written from the front
 * instead would draw every instant of it at a time it never happened.
 */
const STARTED_AT_MS = 1_700_000_000_000 - (1_700_000_000_000 % (512 * INTERVAL_MS)) + 7_000;
const NEAR_BUCKET = 7_750;
const NEAR_ROWS = 40;

/**
 * A stretch shaped the way the book is: full around the price, and a handful of
 * lone walls a long way off — including one past a square's edge, so a frame
 * has to be gathered from more than one square to come back whole.
 */
function buildRecording(count: number): LiquidityFrame[] {
    return Array.from({ length: count }, (_, offset) => {
        const drift = Math.round(Math.sin(offset / 11) * 3);
        const base = NEAR_BUCKET + drift;
        const held = new Map<number, number>();
        for (let row = 0; row < NEAR_ROWS; row += 1) {
            held.set(base + row, 1 + (row % 5) * 0.7 + Math.abs(Math.sin(offset / 4 + row)) * 2);
        }
        // Two blocks below and one above the square the price sits in.
        held.set(3_000, 41.25);
        held.set(ROWS_PER_CHUNK * 14 + 7, 87.5);
        held.set(12_000, 6.5);

        const touch = base + NEAR_ROWS;
        const lowest = Math.min(...held.keys());
        const highest = Math.max(...held.keys());
        const quantities = new Float32Array(highest - lowest + 1);
        for (const [bucket, quantity] of held) {
            quantities[bucket - lowest] = quantity;
        }
        return {
            capturedAtMs: STARTED_AT_MS + offset * INTERVAL_MS,
            bestBidPrice: touch * BUCKET_SIZE,
            bestAskPrice: (touch + 1) * BUCKET_SIZE,
            bids: { lowestBucketIndex: lowest, quantities: quantities.slice(0, touch - lowest + 1) },
            asks: { lowestBucketIndex: touch + 1, quantities: quantities.slice(touch - lowest + 1) },
        };
    });
}

/** What one frame says is resting at each price. */
function readByBucket(frame: LiquidityFrame): Map<number, number> {
    const byBucket = new Map<number, number>();
    for (const ladder of [frame.bids, frame.asks]) {
        for (let index = 0; index < ladder.quantities.length; index += 1) {
            const quantity = ladder.quantities[index] ?? 0;
            if (quantity > 0) {
                byBucket.set(ladder.lowestBucketIndex + index, quantity);
            }
        }
    }
    return byBucket;
}

/** A size no other price in the recording carries, to follow one instant by. */
const WALL_QUANTITY = 5_000;
/** Two lone prices far enough apart to stay apart once folded four into one. */
const LOW_WALL_BUCKET = 3_000;
const HIGH_WALL_BUCKET = 12_000;

/** The same instant with one unmistakable wall standing in it. */
function withWall(frame: LiquidityFrame, bucketIndex: number, quantity: number): LiquidityFrame {
    const side = bucketIndex > frame.bids.lowestBucketIndex + frame.bids.quantities.length - 1
        ? 'asks'
        : 'bids';
    const quantities = Float32Array.from(frame[side].quantities);
    quantities[bucketIndex - frame[side].lowestBucketIndex] = quantity;
    return { ...frame, [side]: { ...frame[side], quantities } };
}

/** The recording with a wall standing at one price, in one instant of it. */
function spikedRecording(count: number, atMs: number, bucketIndex: number): LiquidityFrame[] {
    return buildRecording(count).map((frame) => (frame.capturedAtMs === atMs
        ? withWall(frame, bucketIndex, WALL_QUANTITY)
        : frame));
}

/** Records a run through the real recorder and reads a window straight back. */
async function roundTrip(frames: readonly LiquidityFrame[], read: {
    maxColumns?: number; lowPrice?: number; highPrice?: number; maxRows?: number;
    /** Where the read begins, for a reader looking further back than the recording. */
    fromMs?: number;
    /** False to read only what the recorder's own cadence wrote, as it runs. */
    flush?: boolean;
} = {}) {
    const store = createChunkStoreMock();
    const archive = new ChunkArchiveService({ rows: new PostgresChunkRowStore({ postgres: store.service }) });
    const recorder = new ChunkTileRecorder({
        archive, priceRangeRatio: 1, intervalMs: INTERVAL_MS, stepRatio: STEP_RATIO,
    });
    const recording = recorder.buildRecording('BTCUSDT', BUCKET_SIZE);
    for (const frame of frames) {
        recording.onFrame(frame, BUCKET_SIZE);
    }
    if (read.flush === false) {
        // The recorder writes without being waited on, so that a slow archive
        // never holds up the capture. Waited on properly rather than by a timer:
        // a reader that looked too early would be measuring the test's own
        // timing rather than the recorder's cadence.
        await recorder.settled();
    } else {
        await recorder.flush();
    }

    return {
        store,
        window: await archive.fetchWindow({
            instrumentSymbol: 'BTCUSDT',
            fromMs: read.fromMs ?? STARTED_AT_MS,
            toMs: STARTED_AT_MS + frames.length * INTERVAL_MS,
            maxColumns: read.maxColumns ?? 4_000,
            ...(read.lowPrice === undefined ? {} : { lowPrice: read.lowPrice }),
            ...(read.highPrice === undefined ? {} : { highPrice: read.highPrice }),
            ...(read.maxRows === undefined ? {} : { maxRows: read.maxRows }),
        }),
    };
}

describe('the heat map as fixed squares', () => {
    const recording = buildRecording(140);

    it('hands back every instant it was given', async () => {
        const { window } = await roundTrip(recording);

        expect(window.frames).toHaveLength(140);
    });

    it('scatters one instant across the squares its prices fall in', async () => {
        // A frame reaching four blocks of prices has to be written to four
        // squares, or the prices in the missing ones are silently dropped.
        const { store } = await roundTrip(recording);
        const blocks = new Set(store.rows('chunk')
            .filter((row) => row['detail_level'] === 0)
            .map((row) => row['lowest_bucket_index']));

        expect(blocks.size).toBeGreaterThan(3);
    });

    it('gathers an instant back out of every square that held part of it', async () => {
        // The far walls sit in squares of their own, three blocks apart.
        const { window } = await roundTrip(recording);
        const held = readByBucket(window.frames.at(-1)!);

        expect([...held.keys()]
            .filter((bucket) => bucket === 3_000 || bucket === 12_000)
            .sort((left, right) => left - right))
            .toEqual([3_000, 12_000]);
    });

    it('gives every size back within the precision it was written at', async () => {
        const { window } = await roundTrip(recording);
        const held = readByBucket(window.frames.at(-1)!);

        expect(held.get(3_000)).toBeCloseTo(41.25, 0);
    });

    it('keeps the instants in the order they were recorded', async () => {
        const { window } = await roundTrip(recording);
        const times = window.frames.map((frame) => frame.capturedAtMs);

        expect(times).toEqual([...times].sort((left, right) => left - right));
    });

    it('dates every instant at the moment it happened', async () => {
        // A recording begins halfway through a block far more often than not.
        // Written from the front of one, every instant comes back shifted by
        // however far into it the collector started.
        const { window } = await roundTrip(recording);

        expect(window.frames.map((frame) => frame.capturedAtMs))
            .toEqual(recording.map((frame) => frame.capturedAtMs));
    });

    it('gives an instant back holding what it was given', async () => {
        // Shifted by a column, every size still reads as a size — just the
        // wrong one. Only comparing them against what went in catches that.
        const { window } = await roundTrip(recording);
        const held = readByBucket(window.frames.at(-1)!);
        const given = readByBucket(recording.at(-1)!);

        for (const [bucket, quantity] of given) {
            // Within the scale's own precision: a step is seven percent here,
            // and a size is stored as the step nearest to it.
            const back = held.get(bucket) ?? 0;
            expect(Math.abs(back - quantity) / quantity).toBeLessThan(STEP_RATIO - 1);
        }
    });

    it('carries the touch prices through, which is what the axis is framed on', async () => {
        const { window } = await roundTrip(recording);

        expect(window.frames.at(-1)?.bestBidPrice).toBe(recording.at(-1)?.bestBidPrice);
    });
});

describe('reading fixed squares over a band of prices', () => {
    const recording = buildRecording(140);

    it('answers only for the prices the reader named', async () => {
        const { window } = await roundTrip(recording, {
            lowPrice: 77_000, highPrice: 78_500, maxRows: 1_000,
        });
        const held = readByBucket(window.frames.at(-1)!);

        expect([...held.keys()].filter((bucket) => bucket < 7_700)).toEqual([]);
    });

    it('still carries the prices inside the band', async () => {
        const { window } = await roundTrip(recording, {
            lowPrice: 77_000, highPrice: 78_500, maxRows: 1_000,
        });

        expect(readByBucket(window.frames.at(-1)!).size).toBeGreaterThan(30);
    });

    it('reports the grid it folded onto, not the one it stored', async () => {
        const { window } = await roundTrip(recording, {
            lowPrice: 30_000, highPrice: 120_000, maxRows: 100,
        });

        expect(window.priceBucketSize).toBeGreaterThan(BUCKET_SIZE);
    });
});

describe('reading a coarse level', () => {
    /** Enough instants that the levels above the finest have columns of their own. */
    const recording = buildRecording(160);
    /** One cell of the level above the finest, in milliseconds. */
    const CELL_MS = INTERVAL_MS * 4;

    it('answers off a coarse level rather than the finest', async () => {
        // Sixteen seconds to a drawn column is one cell of level two.
        const { window } = await roundTrip(recording, { maxColumns: 10, flush: false });

        expect(window.sampleIntervalMs).toBeGreaterThan(INTERVAL_MS);
    });

    it('writes a coarse level more than once as the recording runs', async () => {
        // Held to a cadence counted in its own columns, a coarse level writes
        // when its block opens and then not again for an hour — measured on the
        // live archive, an hour of recording gave one column of level three and
        // a reader zooming out was answered with a single stripe. Counted here
        // as writes, because a block still filling is written over in place and
        // the row it leaves behind looks the same either way.
        const { store } = await roundTrip(recording, { maxColumns: 10, flush: false });

        expect(store.writes(2)).toBeGreaterThan(1);
    });

    it('writes the coarsest levels too, seldom as their columns come', async () => {
        const { store } = await roundTrip(recording, { maxColumns: 10, flush: false });

        expect(store.writes(3)).toBeGreaterThan(0);
    });

    it('keeps the largest of what it folded, so a wall survives the fold', async () => {
        const { window } = await roundTrip(recording, { maxColumns: 10, flush: false });
        const held = readByBucket(window.frames.at(-1)!);

        expect(Math.max(...held.values())).toBeGreaterThan(80);
    });

    it('folds an instant into the cell its own time covers', async () => {
        // Grouped by how many have arrived, the boundary is set by whatever
        // second the recording started on and moves again with every instant it
        // drops. Measured, that reproduced a level's own children shifted by one
        // column in five hundred and eleven of five hundred and twelve.
        const spikeAtMs = STARTED_AT_MS + 4 * INTERVAL_MS;

        // Ten drawn columns of forty instants is one cell of level one.
        const { window } = await roundTrip(
            spikedRecording(40, spikeAtMs, LOW_WALL_BUCKET),
            { maxColumns: 10 },
        );

        const carrying = window.frames
            .filter((frame) => Math.max(...readByBucket(frame).values()) > WALL_QUANTITY / 2);
        expect(carrying.map((frame) => frame.capturedAtMs))
            .toEqual([Math.floor(spikeAtMs / CELL_MS) * CELL_MS]);
    });

    it('keeps every instant a cell covers, not only the last of them', async () => {
        // Reset by a count instead of by the address, a cell is written over by
        // whichever instant happens to start the next group, and everything the
        // cell had gathered before it is gone.
        const firstAtMs = STARTED_AT_MS + INTERVAL_MS;
        const lastAtMs = STARTED_AT_MS + 4 * INTERVAL_MS;
        const recorded = spikedRecording(40, firstAtMs, HIGH_WALL_BUCKET)
            .map((frame) => (frame.capturedAtMs === lastAtMs
                ? withWall(frame, LOW_WALL_BUCKET, WALL_QUANTITY)
                : frame));

        const { window } = await roundTrip(recorded, { maxColumns: 10 });

        const cell = window.frames
            .find((frame) => frame.capturedAtMs === Math.floor(lastAtMs / CELL_MS) * CELL_MS);
        const held = readByBucket(cell!);
        // At their own prices: a level folds instants together and leaves the
        // prices where they are.
        // Within the step the sizes are stored on, which is a ratio, not a number.
        expect([held.get(LOW_WALL_BUCKET), held.get(HIGH_WALL_BUCKET)]
            .map((quantity) => Math.round((quantity ?? 0) / WALL_QUANTITY * 100)))
            .toEqual([100, 100]);
    });

    it('hands back no more columns than the reader asked for', async () => {
        // A level is four times coarser than the one below it, so the level that
        // fits under the budget still holds up to four times as many columns as
        // the budget allows. Measured on a six hour window that was fourteen
        // thousand columns against a budget of four thousand, decoded and sent
        // to a chart with no pixels to draw them on.
        const { window } = await roundTrip(recording, { maxColumns: 7 });

        expect(window.frames.length).toBeLessThanOrEqual(7);
    });

    it('reports the span a drawn column stands for once it has folded some', async () => {
        const { window } = await roundTrip(recording, { maxColumns: 7 });

        expect(window.sampleIntervalMs).toBe(INTERVAL_MS * 32);
    });

    it('keeps the largest of what the fold left over, so a wall still survives', async () => {
        const { window } = await roundTrip(recording, { maxColumns: 7 });
        const tallest = window.frames
            .map((frame) => Math.max(...readByBucket(frame).values()));

        expect(Math.max(...tallest)).toBeGreaterThan(80);
    });

    it('spaces the drawn columns evenly across a boundary between blocks', async () => {
        const { window } = await roundTrip(recording, { maxColumns: 7 });
        const gaps = new Set(window.frames
            .slice(1)
            .map((frame, index) => frame.capturedAtMs - window.frames[index]!.capturedAtMs));

        expect([...gaps]).toEqual([window.sampleIntervalMs]);
    });

    it('keeps a wall that stood in only one of the instants it folded', async () => {
        // Four instants to a drawn column, and the wall standing in the second
        // of them: kept by taking the first of a group rather than the largest,
        // the chart loses every wall that did not happen to open one.
        const spikeAtMs = STARTED_AT_MS + INTERVAL_MS;

        const { window } = await roundTrip(
            spikedRecording(12, spikeAtMs, LOW_WALL_BUCKET),
            { maxColumns: 4 },
        );

        const held = window.frames.flatMap((frame) => [...readByBucket(frame).values()]);
        expect(Math.max(...held)).toBeGreaterThan(WALL_QUANTITY / 2);
    });

    it('steps down to a level that reaches as far back as the window asked for', async () => {
        // Read off a level too young for the stretch asked for, the chart is
        // answered for the end of the window and left blank for the rest of it —
        // beside candles that are drawn, which reads as a hole in the recording
        // rather than as a level that has not been running long enough.
        const store = createChunkStoreMock();
        const archive = new ChunkArchiveService({ rows: new PostgresChunkRowStore({ postgres: store.service }) });
        const recorder = new ChunkTileRecorder({
            archive, priceRangeRatio: 1, intervalMs: INTERVAL_MS, stepRatio: STEP_RATIO,
        });
        const feeding = recorder.buildRecording('BTCUSDT', BUCKET_SIZE);
        for (const frame of recording) {
            feeding.onFrame(frame, BUCKET_SIZE);
        }
        await recorder.flush();
        store.forgetEarly(2, 6);

        const window = await archive.fetchWindow({
            instrumentSymbol: 'BTCUSDT',
            fromMs: STARTED_AT_MS,
            toMs: STARTED_AT_MS + recording.length * INTERVAL_MS,
            maxColumns: 10,
        });

        expect(window.frames[0]?.capturedAtMs).toBeLessThan(STARTED_AT_MS + 16 * INTERVAL_MS);
    });

    it('stays on a coarse level when the finest one opens before it records', async () => {
        // A block is addressed by a fixed grid, so it opens whenever the grid
        // says and carries empty places until the recording reaches it. Judged
        // against the opening rather than the first instant, every coarse level
        // looks short of the finest one by however long that padding runs, and
        // the whole window is read off the finest — measured on the live
        // archive, two and a half seconds where the pyramid answers in a
        // twentieth of that.
        // Three minutes into the block before the first instant, which is what
        // the live archive was measured holding.
        const openedAtMs = STARTED_AT_MS - 7_000;
        const paddedMs = openedAtMs + 200 * INTERVAL_MS;
        const late = buildRecording(160)
            .map((frame, offset) => ({ ...frame, capturedAtMs: paddedMs + offset * INTERVAL_MS }));

        const store = createChunkStoreMock();
        const archive = new ChunkArchiveService({ rows: new PostgresChunkRowStore({ postgres: store.service }) });
        const recorder = new ChunkTileRecorder({
            archive, priceRangeRatio: 1, intervalMs: INTERVAL_MS, stepRatio: STEP_RATIO,
        });
        const feeding = recorder.buildRecording('BTCUSDT', BUCKET_SIZE);
        for (const frame of late) {
            feeding.onFrame(frame, BUCKET_SIZE);
        }
        await recorder.flush();

        const window = await archive.fetchWindow({
            instrumentSymbol: 'BTCUSDT',
            // Reaching back further than anything was recorded, which is what a
            // reader zoomed out over a young archive is always doing.
            fromMs: openedAtMs - 600 * INTERVAL_MS,
            toMs: paddedMs + late.length * INTERVAL_MS,
            // Sixteen seconds to a drawn column, which is one cell of level two
            // — narrower than the padding, so the padding is what decides.
            maxColumns: 48,
        });

        expect(window.sampleIntervalMs).toBeGreaterThan(INTERVAL_MS);
    });

    it('steps down to a level that has something when the one asked for has not', async () => {
        // A level is only as old as the recording. Refusing would blank the
        // chart where a finer level could have answered with everything.
        const { window } = await roundTrip(buildRecording(20), { maxColumns: 1 });

        expect(window.frames.length).toBeGreaterThan(0);
    });
});

describe('two reads of overlapping stretches', () => {
    const recording = buildRecording(600);
    let archive: ChunkArchiveService;

    // One archive for every read here: they only read from it, and recording
    // six hundred instants once per test was most of what this file spent.
    beforeAll(async () => {
        const store = createChunkStoreMock();
        archive = new ChunkArchiveService({ rows: new PostgresChunkRowStore({ postgres: store.service }) });
        const recorder = new ChunkTileRecorder({
            archive, priceRangeRatio: 1, intervalMs: INTERVAL_MS, stepRatio: STEP_RATIO,
        });
        const feeding = recorder.buildRecording('BTCUSDT', BUCKET_SIZE);
        for (const frame of recording) {
            feeding.onFrame(frame, BUCKET_SIZE);
        }
        await recorder.flush();
    });

    it('agrees instant for instant on the stretch they share', async () => {
        // A reader panning has most of what it is about to ask for. It can only
        // keep it if the two reads land on the same instants — anchored to
        // where each read began, the same stretch comes back on two grids half a
        // column apart and everything already held has to be thrown away.
        const read = (fromColumn: number) => archive.fetchWindow({
            instrumentSymbol: 'BTCUSDT',
            fromMs: STARTED_AT_MS + fromColumn * INTERVAL_MS,
            toMs: STARTED_AT_MS + (fromColumn + 400) * INTERVAL_MS,
            // Three stored instants to a drawn column, so where the stride
            // starts is something the two reads can disagree about.
            maxColumns: 150,
        });

        const earlier = await read(0);
        const later = await read(137);

        const shared = new Set(earlier.frames.map((frame) => frame.capturedAtMs));
        const overlap = later.frames.filter((frame) => frame.capturedAtMs <= (earlier.frames.at(-1)?.capturedAtMs ?? 0));
        expect(overlap.filter((frame) => !shared.has(frame.capturedAtMs))).toEqual([]);
    });

    it('reports the same grid for both, so one can be laid on the other', async () => {
        const read = (fromColumn: number) => archive.fetchWindow({
            instrumentSymbol: 'BTCUSDT',
            fromMs: STARTED_AT_MS + fromColumn * INTERVAL_MS,
            toMs: STARTED_AT_MS + (fromColumn + 400) * INTERVAL_MS,
            maxColumns: 150,
        });

        const earlier = await read(0);
        const later = await read(137);

        expect([later.sampleIntervalMs, later.priceBucketSize])
            .toEqual([earlier.sampleIntervalMs, earlier.priceBucketSize]);
    });
});

describe('zooming back in after zooming out', () => {
    const recording = buildRecording(600);

    it('sharpens the columns again rather than holding the coarse ones', async () => {
        // Every level of the pyramid is coarser than the one below it, so a
        // wide window comes back on a coarse grid. What the reader must never
        // get is that grid still standing once they have zoomed back in: it
        // reads as a picture that thickened and will not thin again.
        const store = createChunkStoreMock();
        const archive = new ChunkArchiveService({ rows: new PostgresChunkRowStore({ postgres: store.service }) });
        const recorder = new ChunkTileRecorder({
            archive, priceRangeRatio: 1, intervalMs: INTERVAL_MS, stepRatio: STEP_RATIO,
        });
        const feeding = recorder.buildRecording('BTCUSDT', BUCKET_SIZE);
        for (const frame of recording) {
            feeding.onFrame(frame, BUCKET_SIZE);
        }
        await recorder.flush();
        const read = (spanColumns: number, maxColumns: number) => archive.fetchWindow({
            instrumentSymbol: 'BTCUSDT',
            fromMs: STARTED_AT_MS,
            toMs: STARTED_AT_MS + spanColumns * INTERVAL_MS,
            maxColumns,
        });

        const wide = await read(recording.length, 20);
        const close = await read(40, 200);

        expect(close.sampleIntervalMs).toBeLessThan(wide.sampleIntervalMs);
    });

    it('draws the same rows however wide the hours are', async () => {
        // The two axes of this chart are zoomed apart, so widening the hours is
        // not a request for coarser prices. Folded together, a day of the book
        // drew as seven bands a hundred and twenty-eight pixels tall where the
        // pane had room for a hundred and twelve.
        const store = createChunkStoreMock();
        const archive = new ChunkArchiveService({ rows: new PostgresChunkRowStore({ postgres: store.service }) });
        const recorder = new ChunkTileRecorder({
            archive, priceRangeRatio: 1, intervalMs: INTERVAL_MS, stepRatio: STEP_RATIO,
        });
        const feeding = recorder.buildRecording('BTCUSDT', BUCKET_SIZE);
        for (const frame of recording) {
            feeding.onFrame(frame, BUCKET_SIZE);
        }
        await recorder.flush();
        const read = (spanColumns: number, maxColumns: number) => archive.fetchWindow({
            instrumentSymbol: 'BTCUSDT',
            fromMs: STARTED_AT_MS,
            toMs: STARTED_AT_MS + spanColumns * INTERVAL_MS,
            maxColumns,
        });

        const wide = await read(recording.length, 20);
        const close = await read(40, 200);

        expect([wide.priceBucketSize, close.priceBucketSize]).toEqual([BUCKET_SIZE, BUCKET_SIZE]);
    });

    it('never folds the rows further than the reader asked them folded', async () => {
        // A level folds time and price together, so a level taken for the sake
        // of the time axis thickens every row by the same four. Bounded by the
        // fold the reader already asked for, that costs nothing; unbounded, it
        // is a thicker bar than they can do anything about.
        const store = createChunkStoreMock();
        const archive = new ChunkArchiveService({ rows: new PostgresChunkRowStore({ postgres: store.service }) });
        const recorder = new ChunkTileRecorder({
            archive, priceRangeRatio: 1, intervalMs: INTERVAL_MS, stepRatio: STEP_RATIO,
        });
        const feeding = recorder.buildRecording('BTCUSDT', BUCKET_SIZE);
        for (const frame of recording) {
            feeding.onFrame(frame, BUCKET_SIZE);
        }
        await recorder.flush();

        // Rows enough for every price in the band, so nothing was to be folded.
        const window = await archive.fetchWindow({
            instrumentSymbol: 'BTCUSDT',
            fromMs: STARTED_AT_MS,
            toMs: STARTED_AT_MS + 300 * INTERVAL_MS,
            maxColumns: 100,
            lowPrice: NEAR_BUCKET * BUCKET_SIZE,
            highPrice: (NEAR_BUCKET + NEAR_ROWS) * BUCKET_SIZE,
            maxRows: 4_000,
        });

        expect(window.priceBucketSize).toBe(BUCKET_SIZE);
    });
});

describe('rebuilding the levels above the finest', () => {
    it('gives back what recording them as it ran would have', async () => {
        // Every level above the finest is derived, so a change to how they fold
        // leaves what is stored wrong until it is built again — and built as the
        // recording runs, a day of history waits a day to be worth reading.
        const recording = buildRecording(160);
        const asRecorded = await roundTrip(recording, { maxColumns: 10 });

        const store = createChunkStoreMock();
        const archive = new ChunkArchiveService({ rows: new PostgresChunkRowStore({ postgres: store.service }) });
        const recorder = new ChunkTileRecorder({
            archive, priceRangeRatio: 1, intervalMs: INTERVAL_MS, stepRatio: STEP_RATIO,
        });
        const feeding = recorder.buildRecording('BTCUSDT', BUCKET_SIZE);
        for (const frame of recording) {
            feeding.onFrame(frame, BUCKET_SIZE);
        }
        await recorder.flush();

        // The finest level kept, everything above it thrown away and rebuilt
        // from it, the way a fold that changed would have to be.
        store.forgetLevelsAbove(0);
        const rebuilder = new ChunkTileRecorder({
            archive, priceRangeRatio: 1, intervalMs: INTERVAL_MS, stepRatio: STEP_RATIO,
        });
        for (const block of store.rows('block').filter((row) => row['detail_level'] === 0)) {
            const startedAtMs = (block['started_at'] as Date).getTime();
            const columns = await archive.readBlock({
                instrumentSymbol: 'BTCUSDT', detailLevel: 0, startedAtMs,
            });
            for (const [index, column] of columns.entries()) {
                if (column.bestBidPrice > 0) {
                    await rebuilder.replay({
                        instrumentSymbol: 'BTCUSDT',
                        priceBucketSize: BUCKET_SIZE,
                        column,
                        capturedAtMs: startedAtMs + index * INTERVAL_MS,
                    });
                }
            }
        }
        await rebuilder.flush();

        const rebuilt = await archive.fetchWindow({
            instrumentSymbol: 'BTCUSDT',
            fromMs: STARTED_AT_MS,
            toMs: STARTED_AT_MS + recording.length * INTERVAL_MS,
            maxColumns: 10,
        });

        expect([rebuilt.sampleIntervalMs, rebuilt.frames.map((frame) => frame.capturedAtMs)])
            .toEqual([asRecorded.window.sampleIntervalMs,
                asRecorded.window.frames.map((frame) => frame.capturedAtMs)]);
    });

    it('holds the same sizes at the same prices as the recording did', async () => {
        const recording = buildRecording(160);
        const asRecorded = await roundTrip(recording, { maxColumns: 10 });

        const store = createChunkStoreMock();
        const archive = new ChunkArchiveService({ rows: new PostgresChunkRowStore({ postgres: store.service }) });
        const recorder = new ChunkTileRecorder({
            archive, priceRangeRatio: 1, intervalMs: INTERVAL_MS, stepRatio: STEP_RATIO,
        });
        const feeding = recorder.buildRecording('BTCUSDT', BUCKET_SIZE);
        for (const frame of recording) {
            feeding.onFrame(frame, BUCKET_SIZE);
        }
        await recorder.flush();
        store.forgetLevelsAbove(0);
        const rebuilder = new ChunkTileRecorder({
            archive, priceRangeRatio: 1, intervalMs: INTERVAL_MS, stepRatio: STEP_RATIO,
        });
        for (const block of store.rows('block').filter((row) => row['detail_level'] === 0)) {
            const startedAtMs = (block['started_at'] as Date).getTime();
            const columns = await archive.readBlock({
                instrumentSymbol: 'BTCUSDT', detailLevel: 0, startedAtMs,
            });
            for (const [index, column] of columns.entries()) {
                if (column.bestBidPrice > 0) {
                    await rebuilder.replay({
                        instrumentSymbol: 'BTCUSDT',
                        priceBucketSize: BUCKET_SIZE,
                        column,
                        capturedAtMs: startedAtMs + index * INTERVAL_MS,
                    });
                }
            }
        }
        await rebuilder.flush();

        const rebuilt = await archive.fetchWindow({
            instrumentSymbol: 'BTCUSDT',
            fromMs: STARTED_AT_MS,
            toMs: STARTED_AT_MS + recording.length * INTERVAL_MS,
            maxColumns: 10,
        });

        const asCells = (window: { frames: readonly LiquidityFrame[] }) => window.frames
            .map((frame) => [...readByBucket(frame).entries()].sort((left, right) => left[0] - right[0]));
        expect(asCells(rebuilt)).toEqual(asCells(asRecorded.window));
    });
});

describe('a recorder picking up where another left off', () => {
    it('keeps what was already stored for the block it opens', async () => {
        // A block is written whole. A recorder that began from an empty one
        // would replace what is stored with only what it has gathered since —
        // and a block of the coarsest level spans six days, so a restart would
        // take days of it. Measured on the live archive before this: every
        // level held only what had arrived since the last restart.
        const store = createChunkStoreMock();
        const first = buildRecording(60);
        const second = buildRecording(60).map((frame) => ({
            ...frame, capturedAtMs: frame.capturedAtMs + 60 * INTERVAL_MS,
        }));

        await record(store, first);
        await record(store, second);

        const archive = new ChunkArchiveService({ rows: new PostgresChunkRowStore({ postgres: store.service }) });
        const window = await archive.fetchWindow({
            instrumentSymbol: 'BTCUSDT',
            fromMs: STARTED_AT_MS,
            toMs: STARTED_AT_MS + 120 * INTERVAL_MS,
            maxColumns: 4_000,
        });

        expect(window.frames).toHaveLength(120);
    });

    it('still holds what the earlier run recorded, not just the later one', async () => {
        const store = createChunkStoreMock();
        await record(store, buildRecording(60));
        await record(store, buildRecording(60).map((frame) => ({
            ...frame, capturedAtMs: frame.capturedAtMs + 60 * INTERVAL_MS,
        })));

        const archive = new ChunkArchiveService({ rows: new PostgresChunkRowStore({ postgres: store.service }) });
        const window = await archive.fetchWindow({
            instrumentSymbol: 'BTCUSDT',
            fromMs: STARTED_AT_MS,
            toMs: STARTED_AT_MS + 120 * INTERVAL_MS,
            maxColumns: 4_000,
        });
        const oldest = readByBucket(window.frames[0]!);

        expect(oldest.size).toBeGreaterThan(0);
    });
});

/** One run of a recorder over a store, as a restart leaves it. */
async function record(store: ReturnType<typeof createChunkStoreMock>, frames: readonly LiquidityFrame[]) {
    const recorder = new ChunkTileRecorder({
        archive: new ChunkArchiveService({ rows: new PostgresChunkRowStore({ postgres: store.service }) }),
        priceRangeRatio: 1,
        intervalMs: INTERVAL_MS,
        stepRatio: STEP_RATIO,
    });
    const recording = recorder.buildRecording('BTCUSDT', BUCKET_SIZE);
    for (const frame of frames) {
        recording.onFrame(frame, BUCKET_SIZE);
    }
    await recorder.flush();
}

describe('two instants crossing a block boundary together', () => {
    it('leaves no blank column where a block opens', async () => {
        // Taken in parallel, both see the old block, both close it, and the
        // second clears the columns the first had already started filling.
        // Measured on the live archive: a blank first column in thirty of three
        // hundred and thirty-six blocks, over a second the frame table holds.
        const store = createChunkStoreMock();
        const archive = new ChunkArchiveService({ rows: new PostgresChunkRowStore({ postgres: store.service }) });
        const recorder = new ChunkTileRecorder({
            archive, priceRangeRatio: 1, intervalMs: INTERVAL_MS, stepRatio: STEP_RATIO,
        });
        const recording = recorder.buildRecording('BTCUSDT', BUCKET_SIZE);
        // A run that walks over the boundary of a five-hundred-and-twelve
        // column block, fed as fast as the capture feeds it.
        const acrossBoundary = buildRecording(20).map((frame, offset) => ({
            ...frame,
            capturedAtMs: STARTED_AT_MS - 7_000 + (505 + offset) * INTERVAL_MS,
        }));
        for (const frame of acrossBoundary) {
            recording.onFrame(frame, BUCKET_SIZE);
        }
        await recorder.flush();

        const opened = store.rows('block')
            .filter((row) => row['detail_level'] === 0)
            .sort((left, right) => (left['started_at'] as Date).getTime()
                - (right['started_at'] as Date).getTime())
            .at(-1);

        expect((opened?.['best_bid_prices'] as number[])[0]).toBeGreaterThan(0);
    });

    it('spaces the drawn columns evenly across the boundary once it folds any', async () => {
        // A fold that restarted at every block leaves the columns either side of
        // a boundary closer together than the rest, which draws as a seam every
        // five hundred and twelve columns of whichever level is being read.
        const store = createChunkStoreMock();
        const archive = new ChunkArchiveService({ rows: new PostgresChunkRowStore({ postgres: store.service }) });
        const recorder = new ChunkTileRecorder({
            archive, priceRangeRatio: 1, intervalMs: INTERVAL_MS, stepRatio: STEP_RATIO,
        });
        const recording = recorder.buildRecording('BTCUSDT', BUCKET_SIZE);
        const blockOpensAtMs = STARTED_AT_MS - 7_000 + COLUMNS_PER_CHUNK * INTERVAL_MS;
        const acrossBoundary = buildRecording(40).map((frame, offset) => ({
            ...frame,
            capturedAtMs: blockOpensAtMs + (offset - 20) * INTERVAL_MS,
        }));
        for (const frame of acrossBoundary) {
            recording.onFrame(frame, BUCKET_SIZE);
        }
        await recorder.flush();

        // Thirteen drawn columns of forty instants is four to each of them.
        const window = await archive.fetchWindow({
            instrumentSymbol: 'BTCUSDT',
            fromMs: acrossBoundary[0]!.capturedAtMs,
            toMs: acrossBoundary.at(-1)!.capturedAtMs,
            maxColumns: 13,
        });

        const gaps = new Set(window.frames
            .slice(1)
            .map((frame, index) => frame.capturedAtMs - window.frames[index]!.capturedAtMs));
        expect([...gaps]).toEqual([window.sampleIntervalMs]);
    });
});

describe('a reader that names rows but no prices', () => {
    it('folds the whole book rather than shipping every price of it', async () => {
        // The ceiling of the band comes from the touch. Taken from one column it
        // can be a place nobody recorded, whose touch is nought — and a ceiling
        // of nought is no band at all, so the fine grid ships whole. Measured on
        // the live archive: fifteen megabytes against six hundred kilobytes,
        // decided by which block the window happened to touch.
        const { window } = await roundTrip(buildRecording(60), { maxRows: 40 });

        expect(window.priceBucketSize).toBeGreaterThan(BUCKET_SIZE);
    });

    it('covers the whole of what was recorded, so a chart can frame on it', async () => {
        const { window } = await roundTrip(buildRecording(60), { maxRows: 40 });
        const held = readByBucket(window.frames.at(-1)!);
        const highest = Math.max(...held.keys()) * window.priceBucketSize;

        expect(highest).toBeGreaterThan(100_000);
    });
});

/** A stretch of the recording moved to another instant. */
function recordingAt(atMs: number, count: number): LiquidityFrame[] {
    return buildRecording(count).map((frame, offset) => ({
        ...frame, capturedAtMs: atMs + offset * INTERVAL_MS,
    }));
}

/** One recorder writing into a store, as the collector and a backfill each are. */
function buildWriter(archive: ChunkArchiveService): ChunkTileRecorder {
    return new ChunkTileRecorder({
        archive, priceRangeRatio: 1, intervalMs: INTERVAL_MS, stepRatio: STEP_RATIO,
    });
}

/** Feeds a stretch through a recorder and waits for it to reach the store. */
async function write(
    recorder: ChunkTileRecorder,
    frames: readonly LiquidityFrame[],
): Promise<void> {
    const recording = recorder.buildRecording('BTCUSDT', BUCKET_SIZE);
    for (const frame of frames) {
        recording.onFrame(frame, BUCKET_SIZE);
    }
    await recorder.flush();
}

describe('two writers meeting on one block', () => {
    // A block of the finest level covers eight minutes, and one of the coarsest
    // six days — so a backfill and the live recording are inside the same block
    // whenever they are within a week of each other, and a block is written
    // whole. Level one is enough to show it: its blocks are half an hour.
    const COLUMN_MS = 4 * INTERVAL_MS;
    const BLOCK_MS = COLUMNS_PER_CHUNK * COLUMN_MS;
    const BLOCK_START_MS = Math.ceil(STARTED_AT_MS / BLOCK_MS) * BLOCK_MS;
    const BACKFILLED_MS = BLOCK_START_MS + 7 * INTERVAL_MS;
    const LIVE_MS = BLOCK_START_MS + 1_200 * INTERVAL_MS;

    /** Whether the block holds a recording at the column covering an instant. */
    function isRecordedAt(block: readonly ChunkColumn[], atMs: number): boolean {
        return (block[Math.floor((atMs - BLOCK_START_MS) / COLUMN_MS)]?.steps.size ?? 0) > 0;
    }

    it('keeps what the other one wrote while it was gathering', async () => {
        const store = createChunkStoreMock();
        const archive = new ChunkArchiveService({ rows: new PostgresChunkRowStore({ postgres: store.service }) });
        const live = buildWriter(archive);
        const backfill = buildWriter(archive);

        // The live one picks the block up before the backfill has written into
        // it, so nothing it read can tell it what arrived afterwards.
        await write(live, recordingAt(LIVE_MS, 8));
        await write(backfill, recordingAt(BACKFILLED_MS, 8));
        await write(live, recordingAt(LIVE_MS + 8 * INTERVAL_MS, 8));

        const block = await archive.readBlock({
            instrumentSymbol: 'BTCUSDT', detailLevel: 1, startedAtMs: BLOCK_START_MS,
        });

        expect([isRecordedAt(block, BACKFILLED_MS), isRecordedAt(block, LIVE_MS)])
            .toEqual([true, true]);
    });

    it('does not read the block back for a writer nobody is sharing it with', async () => {
        // Reading one costs a fifth of a second, and a level is written out
        // every sixteen instants — so a recorder that reads before every write
        // spends more on the reading than the recording costs altogether.
        const store = createChunkStoreMock();
        const archive = new ChunkArchiveService({ rows: new PostgresChunkRowStore({ postgres: store.service }) });

        await write(buildWriter(archive), recordingAt(LIVE_MS, 64));

        expect([store.writes(0) > 1, store.blockReads(0)]).toEqual([true, 1]);
    });

    it('keeps the larger reading of an instant both of them hold', async () => {
        // Where they overlap they are readings of the same book, so the two
        // agree — except where a fold has rounded them apart, and there a wall
        // either of them saw is a wall.
        const walled = spikedRecording(8, STARTED_AT_MS, HIGH_WALL_BUCKET)
            .map((frame, offset) => ({ ...frame, capturedAtMs: LIVE_MS + offset * INTERVAL_MS }));

        const alone = await stepAtTheWall([recordingAt(LIVE_MS, 8)]);
        const shared = await stepAtTheWall([recordingAt(LIVE_MS, 8)], walled);

        expect(shared).toBeGreaterThan(alone);
    });

    /**
     * What one column says rests at the wall, after every writer has had it.
     *
     * @param live - Stretches the live writer records, in order.
     * @param backfilled - A stretch another writer puts in between, if any.
     * @returns The step stored at the wall in the column covering the live edge.
     */
    async function stepAtTheWall(
        live: readonly (readonly LiquidityFrame[])[],
        backfilled?: readonly LiquidityFrame[],
    ): Promise<number> {
        const store = createChunkStoreMock();
        const archive = new ChunkArchiveService({ rows: new PostgresChunkRowStore({ postgres: store.service }) });
        const writer = buildWriter(archive);

        for (const stretch of live) {
            await write(writer, stretch);
        }
        if (backfilled !== undefined) {
            await write(buildWriter(archive), backfilled);
            await write(writer, recordingAt(LIVE_MS + 8 * INTERVAL_MS, 8));
        }

        const block = await archive.readBlock({
            instrumentSymbol: 'BTCUSDT', detailLevel: 1, startedAtMs: BLOCK_START_MS,
        });
        const column = block[Math.floor((LIVE_MS - BLOCK_START_MS) / COLUMN_MS)];
        return column?.steps.get(HIGH_WALL_BUCKET) ?? 0;
    }
});
