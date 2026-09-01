// Installs IDBKeyRange and friends as globals, which the store reaches for the
// way a page does. A fresh factory per test then keeps the stores isolated.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChunkArchiveService } from '../../../src/database/services/chunk-archive-service.ts';
import { ChunkTileRecorder } from '../../../src/database/services/chunk-tile-recorder.ts';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbChunkRowStore } from '../../../src/database/browser/indexed-db-chunk-row-store.ts';
import { IndexedDbLiveTailSource } from '../../../src/database/browser/indexed-db-live-tail-source.ts';
import { IndexedDbService } from '../../../src/database/browser/indexed-db-service.ts';
import { StoredDepthTailSource } from '../../../src/shared/core/stored-depth-tail-source.ts';
import type { LiquidityFrame } from '../../../src/shared/core/liquidity-frame.ts';

const BUCKET_SIZE = 10;
const INTERVAL_MS = 1_000;
const STEP_RATIO = 1.02;
/** Deliberately not on a block boundary, which is where a recording starts. */
const STARTED_AT_MS = 1_700_000_000_000 - (1_700_000_000_000 % (512 * INTERVAL_MS)) + 7_000;

const NEAR_BUCKET = 7_700;
const NEAR_ROWS = 30;
/** A wall a long way above the price, which the recorded band never reaches. */
const FAR_BUCKET = 15_400;
const FAR_QUANTITY = 900;

/**
 * A stretch shaped the way the book is: dense around the price, with one wall
 * standing far above it — the thing a band around the price cannot hold.
 */
function buildRecording(count: number): LiquidityFrame[] {
    return Array.from({ length: count }, (_, offset) => {
        const held = new Map<number, number>();
        for (let row = 0; row < NEAR_ROWS; row += 1) {
            held.set(NEAR_BUCKET + row, 1 + (row % 4) * 0.5);
        }
        held.set(FAR_BUCKET, FAR_QUANTITY);

        const touch = NEAR_BUCKET + NEAR_ROWS;
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
            asks: {
                lowestBucketIndex: touch + 1,
                quantities: quantities.slice(touch - lowest + 1),
            },
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

describe('the whole book as squares, kept in a page', () => {
    let database: IndexedDbService;
    let archive: ChunkArchiveService;
    let recorder: ChunkTileRecorder;

    beforeEach(async () => {
        database = new IndexedDbService({ factory: new IDBFactory() });
        await database.open();
        archive = new ChunkArchiveService({ rows: new IndexedDbChunkRowStore({ database }) });
        recorder = new ChunkTileRecorder({
            archive, priceRangeRatio: 1, intervalMs: INTERVAL_MS, stepRatio: STEP_RATIO,
        });
    });

    afterEach(() => {
        database.close();
    });

    /** Records a run through the real recorder and reads a window straight back. */
    async function roundTrip(count: number, read: {
        maxColumns?: number; lowPrice?: number; highPrice?: number; maxRows?: number;
    } = {}) {
        const frames = buildRecording(count);
        const recording = recorder.buildRecording('BTCUSDT', BUCKET_SIZE);
        for (const frame of frames) {
            recording.onFrame(frame, BUCKET_SIZE);
        }
        await recorder.flush();

        return archive.fetchWindow({
            instrumentSymbol: 'BTCUSDT',
            fromMs: STARTED_AT_MS,
            toMs: STARTED_AT_MS + count * INTERVAL_MS,
            maxColumns: read.maxColumns ?? 4_000,
            ...(read.lowPrice === undefined ? {} : { lowPrice: read.lowPrice }),
            ...(read.highPrice === undefined ? {} : { highPrice: read.highPrice }),
            ...(read.maxRows === undefined ? {} : { maxRows: read.maxRows }),
        });
    }

    it('hands back every instant it was given', async () => {
        const window = await roundTrip(40);

        expect(window.frames.length).toBe(40);
    });

    it('dates every instant at the moment it happened', async () => {
        // A block is addressed by where it sits, so a run that starts halfway
        // through one has to sit where it belongs in it. Written from the front
        // instead, every instant is drawn at a time it never happened.
        const window = await roundTrip(40);

        expect(window.frames[0]?.capturedAtMs).toBe(STARTED_AT_MS);
    });

    it('keeps the wall the recorded band would never have reached', async () => {
        // The point of the whole thing: a page recording only the band around
        // the price cannot show a wall standing half again above it.
        const window = await roundTrip(40);

        expect(readByBucket(window.frames.at(-1)!).has(FAR_BUCKET)).toBe(true);
    });

    it('gives sizes back within the precision they were written at', async () => {
        const window = await roundTrip(40);

        const held = readByBucket(window.frames.at(-1)!).get(FAR_BUCKET) ?? 0;
        expect(Math.abs(Math.log(held / FAR_QUANTITY))).toBeLessThan(Math.log(STEP_RATIO));
    });

    it('answers only for the prices the reader named', async () => {
        // A square is addressed by price as well as by time, so a band decides
        // which squares are opened at all rather than what is thrown away after.
        const window = await roundTrip(40, {
            lowPrice: (NEAR_BUCKET - 5) * BUCKET_SIZE,
            highPrice: (NEAR_BUCKET + NEAR_ROWS + 5) * BUCKET_SIZE,
            maxRows: 200,
        });

        expect(readByBucket(window.frames.at(-1)!).has(FAR_BUCKET)).toBe(false);
    });

    it('opens only the squares the band crosses, not every square of the block', async () => {
        // The band is applied above this as well, so a store that opened them
        // all would still draw the right picture — after gunzipping a quarter of
        // a megabyte per square to throw it away.
        await roundTrip(40);
        const rows = new IndexedDbChunkRowStore({ database });
        const blocks = await rows.readBlocksWithin({
            instrumentSymbol: 'BTCUSDT',
            detailLevel: 0,
            fromMs: STARTED_AT_MS,
            toMs: STARTED_AT_MS + 40 * INTERVAL_MS,
        });

        const opened = await rows.readSquares({
            instrumentSymbol: 'BTCUSDT',
            detailLevel: 0,
            startedAtMs: blocks.map((one) => one.startedAtMs),
            lowestBucketIndexes: [Math.floor(NEAR_BUCKET / 512) * 512],
        });

        expect(opened.map((one) => one.lowestBucketIndex))
            .toEqual([Math.floor(NEAR_BUCKET / 512) * 512]);
    });

    it('walks only the blocks a window overlaps, not the level from its start', async () => {
        // Two conditions on two fields — one block ends after the window opens,
        // another opens before it closes — and a key range can bound only one.
        // Off the index over the instant a block reaches, and stopped at the
        // first block opening past the window, the walk touches only the blocks
        // that can be in it. Read from the front of the level instead, a page
        // recording all day pays for the whole day on every window.
        await roundTrip(1_200);
        const rows = new IndexedDbChunkRowStore({ database });

        const within = (fromMs: number, toMs: number) => rows.readBlocksWithin({
            instrumentSymbol: 'BTCUSDT', detailLevel: 0, fromMs, toMs,
        });

        const last = await within(
            STARTED_AT_MS + 1_100 * INTERVAL_MS, STARTED_AT_MS + 1_200 * INTERVAL_MS,
        );
        const first = await within(STARTED_AT_MS, STARTED_AT_MS + 100 * INTERVAL_MS);
        const everything = await within(STARTED_AT_MS, STARTED_AT_MS + 1_200 * INTERVAL_MS);

        // One block each end, and neither reaches the blocks on the other side
        // of it: the near bound is where the walk starts, the far one where it
        // stops, and a walk missing either answers with the whole level.
        expect([last.length, first.length, everything.length > 2]).toEqual([1, 1, true]);
    });

    it('answers a wide window off a coarse level rather than the finest', async () => {
        const window = await roundTrip(200, { maxColumns: 20 });

        expect(window.sampleIntervalMs).toBeGreaterThan(INTERVAL_MS);
    });

    it('picks a block back up rather than replacing what is stored', async () => {
        // A second recorder over the same store opens the block the first one
        // filled. Writing what it gathered alone would drop everything already
        // there, and a block of the coarsest level covers six days.
        await roundTrip(20);
        const second = new ChunkTileRecorder({
            archive, priceRangeRatio: 1, intervalMs: INTERVAL_MS, stepRatio: STEP_RATIO,
        });
        const recording = second.buildRecording('BTCUSDT', BUCKET_SIZE);
        for (const frame of buildRecording(40).slice(20)) {
            recording.onFrame(frame, BUCKET_SIZE);
        }
        await second.flush();

        const window = await archive.fetchWindow({
            instrumentSymbol: 'BTCUSDT',
            fromMs: STARTED_AT_MS,
            toMs: STARTED_AT_MS + 40 * INTERVAL_MS,
            maxColumns: 4_000,
        });
        expect(window.frames.length).toBe(40);
    });

    it('extends the live edge out of the store the window came from', async () => {
        // A tail extends the window the chart is drawing. Fed from the band the
        // recording keeps instead, the prices inside it go on while the ones
        // outside stop at the last written block — which draws as a row of
        // teeth along the live edge, one tooth per price the band does not hold.
        await roundTrip(40);
        const tail = new StoredDepthTailSource({
            readWindow: (request) => archive.fetchWindow(request),
            rest: new IndexedDbLiveTailSource({ database }),
            readNowMs: () => STARTED_AT_MS + 40 * INTERVAL_MS,
        });

        const window = await tail.fetchFramesAfter({
            symbol: 'BTCUSDT',
            afterMs: STARTED_AT_MS + 20 * INTERVAL_MS,
            maxFrames: 100,
            frameIntervalMs: INTERVAL_MS,
        });

        expect(readByBucket(window.frames.at(-1)!).has(FAR_BUCKET)).toBe(true);
    });
});
