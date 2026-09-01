import { describe, expect, it, vi } from 'vitest';
import {
    StoredDepthTailSource,
    type StoredDepthWindowRequest,
} from '../../../src/shared/core/stored-depth-tail-source.ts';

const NOW_MS = 1_700_000_000_000;

function buildSource() {
    const readWindow = vi.fn().mockResolvedValue({
        priceBucketSize: 10, sampleIntervalMs: 1_000, frames: [],
    });
    const rest = {
        fetchFramesAfter: vi.fn(),
        fetchTradeClustersBetween: vi.fn().mockResolvedValue([]),
        fetchGapsBetween: vi.fn().mockResolvedValue([]),
    };
    return {
        readWindow,
        rest,
        source: new StoredDepthTailSource({
            readWindow,
            rest,
            readNowMs: () => NOW_MS,
        }),
    };
}

describe('StoredDepthTailSource', () => {
    it('reads depth out of its own store and nowhere else', async () => {
        // These stores exist to be weighed against each other. A chart drawn
        // from one and streamed from another shows neither.
        const { source, readWindow, rest } = buildSource();

        await source.fetchFramesAfter({ symbol: 'BTCUSDT', afterMs: NOW_MS - 5_000, maxFrames: 60 });

        expect([readWindow.mock.calls.length, rest.fetchFramesAfter.mock.calls.length])
            .toEqual([1, 0]);
    });

    it('resumes strictly after the instant the reader already holds', async () => {
        // Handed back its own newest instant, the reader discards it, and a tail
        // that kept offering it would never move.
        const { source, readWindow } = buildSource();

        await source.fetchFramesAfter({ symbol: 'BTCUSDT', afterMs: NOW_MS - 5_000, maxFrames: 60 });

        expect(readWindow.mock.calls[0]?.[0]).toMatchObject({ fromMs: NOW_MS - 4_999 });
    });

    it('stops at the present rather than asking for time nobody has recorded', async () => {
        const { source, readWindow } = buildSource();

        await source.fetchFramesAfter({ symbol: 'BTCUSDT', afterMs: NOW_MS - 5_000, maxFrames: 60 });

        expect(readWindow.mock.calls[0]?.[0]).toMatchObject({ toMs: NOW_MS, maxColumns: 60 });
    });

    it('reads no longer a stretch than it can answer instant by instant', async () => {
        // These stores fold a stretch onto a budget of drawn columns, which is
        // right for a window and wrong for a tail: the cursor moves to the
        // newest instant delivered, so everything folded away between them is
        // never offered again. Measured on a reader twenty minutes behind, one
        // instant in twelve arrived and the chart drew a column every twelfth
        // second with nothing between them.
        const { source, readWindow } = buildSource();

        await source.fetchFramesAfter({
            symbol: 'BTCUSDT', afterMs: NOW_MS - 20 * 60_000, maxFrames: 60, frameIntervalMs: 1_000,
        });

        const read = readWindow.mock.calls[0]?.[0] as StoredDepthWindowRequest;
        expect(read.toMs - read.fromMs).toBeLessThanOrEqual(60 * 1_000);
    });

    it('leaves the rest of a long catch-up for the next pass', async () => {
        const { source, readWindow } = buildSource();

        await source.fetchFramesAfter({
            symbol: 'BTCUSDT', afterMs: NOW_MS - 20 * 60_000, maxFrames: 60, frameIntervalMs: 1_000,
        });

        expect(readWindow.mock.calls[0]?.[0]).toMatchObject({ fromMs: NOW_MS - 20 * 60_000 + 1 });
    });

    it('stops at the present when the reader is close behind', async () => {
        const { source, readWindow } = buildSource();

        await source.fetchFramesAfter({
            symbol: 'BTCUSDT', afterMs: NOW_MS - 5_000, maxFrames: 60, frameIntervalMs: 1_000,
        });

        expect(readWindow.mock.calls[0]?.[0]).toMatchObject({ toMs: NOW_MS });
    });

    it('narrows the read to the prices the reader is drawing', async () => {
        // These stores hold the whole book, and a chart draws a strip of it.
        // Passed on rather than applied after, so the ones that can skip whole
        // squares of storage do, instead of unpacking them to throw them away.
        const { source, readWindow } = buildSource();

        await source.fetchFramesAfter({
            symbol: 'BTCUSDT', afterMs: NOW_MS - 5_000, maxFrames: 60,
            lowPrice: 90_000, highPrice: 110_000,
        });

        expect(readWindow.mock.calls[0]?.[0])
            .toMatchObject({ lowPrice: 90_000, highPrice: 110_000 });
    });

    it('asks for every price when the reader named none', async () => {
        const { source, readWindow } = buildSource();

        await source.fetchFramesAfter({ symbol: 'BTCUSDT', afterMs: NOW_MS - 5_000, maxFrames: 60 });

        expect(readWindow.mock.calls[0]?.[0]).not.toHaveProperty('lowPrice');
    });

    it('leaves executions to whatever was already answering for them', async () => {
        // No strategy keeps its own copy of these, so sharing them is not two
        // stores in one answer.
        const { source, rest } = buildSource();

        await source.fetchTradeClustersBetween({ symbol: 'BTCUSDT', fromMs: 1, toMs: 2 });

        expect(rest.fetchTradeClustersBetween).toHaveBeenCalledTimes(1);
    });

    it('leaves the holes in the recording to it as well', async () => {
        const { source, rest } = buildSource();

        await source.fetchGapsBetween({ symbol: 'BTCUSDT', fromMs: 1, toMs: 2 });

        expect(rest.fetchGapsBetween).toHaveBeenCalledTimes(1);
    });
});
