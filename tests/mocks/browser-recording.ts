import { buildFrame } from './chart-services.ts';
import { ChunkArchiveService } from '../../src/database/services/chunk-archive-service.ts';
import { ChunkTileRecorder } from '../../src/database/services/chunk-tile-recorder.ts';
import { IndexedDbChunkRowStore } from '../../src/database/browser/indexed-db-chunk-row-store.ts';
import type { IndexedDbService } from '../../src/database/browser/indexed-db-service.ts';
import type { LiquidityFrame } from '../../src/shared/core/liquidity-frame.ts';

/** The grid the browser records on, matching what the worker is configured with. */
export const RECORDING_GRID = { priceBucketSize: 10, frameIntervalMs: 1_000 };

/** What the collector records the whole book with. */
const PRICE_RANGE_RATIO = 1;
const STEP_RATIO = 1.02;

export interface RecordingRequest {
    readonly database: IndexedDbService;
    readonly instrumentSymbol?: string;
    /** Where the run starts. */
    readonly fromMs: number;
    readonly count: number;
    /** Anything a test wants each instant to differ in. */
    readonly shape?: (frame: LiquidityFrame) => LiquidityFrame;
}

/**
 * Records a run of instants into a page's chunked archive.
 *
 * The way the worker does it: through a recording, one instant at a time. A
 * test that wrote the stored rows directly would be asserting against a shape
 * nothing produces.
 *
 * @param request - Which database, which contract, and how many instants.
 * @returns The instant of the last one recorded.
 */
export async function recordInstants(request: RecordingRequest): Promise<number> {
    const instrumentSymbol = request.instrumentSymbol ?? 'BTCUSDT';
    const recorder = new ChunkTileRecorder({
        archive: new ChunkArchiveService({
            rows: new IndexedDbChunkRowStore({ database: request.database }),
        }),
        priceRangeRatio: PRICE_RANGE_RATIO,
        intervalMs: RECORDING_GRID.frameIntervalMs,
        stepRatio: STEP_RATIO,
    });
    const recording = recorder.buildRecording(instrumentSymbol, RECORDING_GRID.priceBucketSize);

    let lastMs = request.fromMs;
    for (let offset = 0; offset < request.count; offset += 1) {
        lastMs = request.fromMs + offset * RECORDING_GRID.frameIntervalMs;
        const frame = buildFrame(lastMs);
        recording.onFrame(request.shape === undefined ? frame : request.shape(frame),
            RECORDING_GRID.priceBucketSize);
    }

    await recorder.flush();
    await recorder.settled();
    return lastMs;
}
