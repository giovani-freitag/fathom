import { describe, expect, it } from 'vitest';
import { ChunkArchiveService } from '../../../src/database/services/chunk-archive-service.ts';
import { ChunkTileRecorder } from '../../../src/database/services/chunk-tile-recorder.ts';
import { COLUMNS_PER_CHUNK } from '../../../src/shared/codec/chunk-grid.ts';
import { createChunkStoreMock } from '../../mocks/chunk-store.ts';
import type { LiquidityFrame } from '../../../src/shared/core/liquidity-frame.ts';
import { PostgresChunkRowStore } from '../../../src/database/postgres/postgres-chunk-row-store.ts';

/** The contract every recording here is written and read back under. */
const CONTRACT = { venue: 'binance-futures', instrumentSymbol: 'BTCUSDT' };

const INTERVAL_MS = 1_000;
const STEP_RATIO = 1.07;
const SCALE = { stepRatio: STEP_RATIO, smallestQuantity: 0.25 };

/** A wall standing at one price throughout, whichever grid is recording it. */
const WALL_PRICE = 78_000;
const TOUCH_PRICE = 77_900;

/** Two blocks of the finest level, the second following the first. */
const FIRST_BLOCK_MS = 1_700_000_000_000 - (1_700_000_000_000 % (COLUMNS_PER_CHUNK * INTERVAL_MS));
const SECOND_BLOCK_MS = FIRST_BLOCK_MS + COLUMNS_PER_CHUNK * INTERVAL_MS;

function buildArchive() {
    const store = createChunkStoreMock();
    return new ChunkArchiveService({ rows: new PostgresChunkRowStore({ postgres: store.service }) });
}

/** One instant on a grid, with the wall and the touch at the same prices. */
function columnOn(bucketSize: number) {
    const touch = Math.round(TOUCH_PRICE / bucketSize);
    return {
        bestBidPrice: TOUCH_PRICE,
        bestAskPrice: TOUCH_PRICE + bucketSize,
        steps: new Map<number, number>([
            [touch - 1, 20],
            [Math.round(WALL_PRICE / bucketSize), 120],
        ]),
    };
}

/** Writes one whole block of one grid, at one of the two block starts. */
async function writeBlockOn(archive: ChunkArchiveService, startedAtMs: number, bucketSize: number) {
    await archive.writeBlock({
        ...CONTRACT,
        detailLevel: 0,
        columnIntervalMs: INTERVAL_MS,
        priceBucketSize: bucketSize,
        scale: SCALE,
        startedAtMs,
        columns: Array.from({ length: 8 }, () => columnOn(bucketSize)),
        isComplete: true,
    });
}

/** What one instant says is resting at each price. */
function pricesIn(frame: LiquidityFrame, bucketSize: number): Map<number, number> {
    const byPrice = new Map<number, number>();
    for (const ladder of [frame.bids, frame.asks]) {
        for (let at = 0; at < ladder.quantities.length; at += 1) {
            const quantity = ladder.quantities[at] ?? 0;
            if (quantity > 0) {
                byPrice.set((ladder.lowestBucketIndex + at) * bucketSize, quantity);
            }
        }
    }
    return byPrice;
}

/** A window over both blocks, whichever grids they were written on. */
async function readAcross(first: number, second: number) {
    const archive = buildArchive();
    await writeBlockOn(archive, FIRST_BLOCK_MS, first);
    await writeBlockOn(archive, SECOND_BLOCK_MS, second);

    return archive.fetchWindow({
        ...CONTRACT,
        fromMs: FIRST_BLOCK_MS,
        toMs: SECOND_BLOCK_MS + 8 * INTERVAL_MS,
        maxColumns: 2_000,
    });
}

describe('a window reaching back past a change of grid', () => {
    it('reads at the coarser of the two, because the finer detail was never recorded', async () => {
        // Coarse first, then fine: the older half cannot be spread over rows it
        // was never written on, so the whole window reads at its resolution.
        expect((await readAcross(40, 10)).priceBucketSize).toBe(40);
        expect((await readAcross(10, 40)).priceBucketSize).toBe(40);
    });

    it('keeps both stretches, in the order they were recorded', async () => {
        // Dropped, a reader would see the recording start when the grid was
        // last edited — and an order book cannot be recorded again.
        const window = await readAcross(10, 40);

        const instants = window.frames.map((frame) => frame.capturedAtMs);
        expect(instants[0]).toBe(FIRST_BLOCK_MS);
        expect(instants.at(-1)).toBe(SECOND_BLOCK_MS + 7 * INTERVAL_MS);
        expect([...instants].sort((one, other) => one - other)).toEqual(instants);
    });

    it('draws one price on one row, whichever grid it was recorded on', async () => {
        // The whole point of folding rather than dropping: a wall that stood at
        // seventy-eight thousand before the change and after it is one wall,
        // and drawn on two rows it reads as two.
        const window = await readAcross(10, 40);
        const wallRow = Math.floor(WALL_PRICE / window.priceBucketSize) * window.priceBucketSize;

        expect(pricesIn(window.frames[0]!, window.priceBucketSize).get(wallRow)).toBeGreaterThan(0);
        expect(pricesIn(window.frames.at(-1)!, window.priceBucketSize).get(wallRow)).toBeGreaterThan(0);
    });

    it('reads a window inside one grid exactly as it always did', async () => {
        const window = await readAcross(10, 10);

        expect(window.priceBucketSize).toBe(10);
        expect(window.frames).toHaveLength(16);
    });
});

describe('a recorder picking up a block written on another grid', () => {
    /** Records eight instants on one grid, then eight on another, in one block. */
    async function recordThenRetune(first: number, second: number) {
        const archive = buildArchive();
        const recorder = new ChunkTileRecorder({
            archive, priceRangeRatio: 1, intervalMs: INTERVAL_MS, stepRatio: STEP_RATIO,
        });

        const before = recorder.buildRecording(CONTRACT, first);
        for (let at = 0; at < 8; at += 1) {
            before.onFrame(frameOn(FIRST_BLOCK_MS + at * INTERVAL_MS, first), first);
        }
        await recorder.flush();

        const after = recorder.buildRecording(CONTRACT, second);
        for (let at = 8; at < 16; at += 1) {
            after.onFrame(frameOn(FIRST_BLOCK_MS + at * INTERVAL_MS, second), second);
        }
        await recorder.flush();

        return archive.fetchWindow({
            ...CONTRACT,
            fromMs: FIRST_BLOCK_MS,
            toMs: FIRST_BLOCK_MS + 16 * INTERVAL_MS,
            maxColumns: 2_000,
        });
    }

    it('folds what the block already held onto the coarser grid', async () => {
        // A block is written whole, so the instants before the change are
        // rewritten with the ones after it. Folded, none of them is lost.
        const window = await recordThenRetune(10, 40);

        expect(window.priceBucketSize).toBe(40);
        expect(window.frames).toHaveLength(16);
    });

    it('starts the block again where the new grid is finer than the stored one', async () => {
        // A coarse column cannot be spread over fine rows: the detail was never
        // recorded. What that costs is the instants of the block being written
        // when the grid was changed, and nothing before it.
        const window = await recordThenRetune(40, 10);

        expect(window.priceBucketSize).toBe(10);
        expect(window.frames).toHaveLength(8);
    });
});

/** One instant on a grid, as the collector would have written it. */
function frameOn(atMs: number, bucketSize: number): LiquidityFrame {
    const touch = Math.round(TOUCH_PRICE / bucketSize);
    const wall = Math.round(WALL_PRICE / bucketSize);
    const quantities = new Float32Array(wall - touch + 2);
    quantities[0] = 3;
    quantities[wall - touch + 1] = 40;

    return {
        capturedAtMs: atMs,
        bestBidPrice: touch * bucketSize,
        bestAskPrice: (touch + 1) * bucketSize,
        bids: { lowestBucketIndex: touch - 1, quantities: quantities.slice(0, 2) },
        asks: { lowestBucketIndex: touch + 1, quantities: quantities.slice(2) },
    };
}
