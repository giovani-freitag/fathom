import { beforeEach, describe, expect, it } from 'vitest';
import { buildTailFrame, buildTailWindow, createLiveTailSourceMock, type LiveTailSourceMock } from '../../mocks/live-tail-source.ts';
import { LiveTail } from '../../../src/shared/core/live-tail.ts';
import type { LiveMessage } from '../../../src/shared/core/live-message.ts';

const RESUME_FROM_MS = 5_000;

describe('LiveTail', () => {
    let source: LiveTailSourceMock;
    let delivered: LiveMessage[];
    let tail: LiveTail;

    beforeEach(() => {
        source = createLiveTailSourceMock();
        delivered = [];
        tail = new LiveTail({
            source: source.source,
            instrumentSymbol: 'BTCUSDT',
            afterMs: RESUME_FROM_MS,
            maxFramesPerPoll: 50,
            deliver: (message) => { delivered.push(message); },
        });
    });

    it('resumes strictly after the instant the reader already holds', async () => {
        await tail.advance();

        expect(source.fetchFramesAfter).toHaveBeenCalledWith(
            expect.objectContaining({ symbol: 'BTCUSDT', afterMs: RESUME_FROM_MS }),
        );
    });

    it('says nothing when the archive has nothing new', async () => {
        await tail.advance();

        expect(delivered).toEqual([]);
    });

    it('carries the frames it read, then resumes from the newest of them', async () => {
        source.fetchFramesAfter.mockResolvedValueOnce(
            buildTailWindow([buildTailFrame(6_000), buildTailFrame(7_000)]),
        );

        await tail.advance();
        await tail.advance();

        expect(delivered[0]).toMatchObject({ kind: 'frames' });
        expect(source.fetchFramesAfter.mock.calls[1]![0]).toMatchObject({ afterMs: 7_000 });
    });

    it('leaves the cursor alone when a read fails, so the range is retried', async () => {
        // Closing a reader's tail over one unavailable read would cost them the
        // stretch that arrives while they reconnect.
        source.fetchFramesAfter.mockRejectedValueOnce(new Error('the archive went away'));

        await tail.advance();
        await tail.advance();

        expect(source.fetchFramesAfter.mock.calls[1]![0]).toMatchObject({ afterMs: RESUME_FROM_MS });
    });

    it('asks for executions only over the stretch the frames just covered', async () => {
        source.fetchFramesAfter.mockResolvedValueOnce(buildTailWindow([buildTailFrame(6_000)]));

        await tail.advance();

        expect(source.fetchTradeClustersBetween).toHaveBeenCalledWith(
            expect.objectContaining({ fromMs: RESUME_FROM_MS, toMs: 6_001 }),
        );
    });

    it('does not ask again for a stretch it has already read', async () => {
        source.fetchFramesAfter.mockResolvedValueOnce(buildTailWindow([buildTailFrame(6_000)]));

        await tail.advance();
        await tail.advance();

        expect(source.fetchTradeClustersBetween).toHaveBeenCalledTimes(1);
    });

    it('reports a stretch that went unrecorded while the reader was watching', async () => {
        // This used to reach the chart only on a reload, which showed the
        // window as continuous until then.
        source.fetchFramesAfter.mockResolvedValueOnce(buildTailWindow([buildTailFrame(6_000)]));
        source.fetchGapsBetween.mockResolvedValueOnce([
            { gapStartedAtMs: 5_200, gapEndedAtMs: 5_800, gapReason: 'the stream dropped' },
        ]);

        await tail.advance();

        expect(delivered).toContainEqual(expect.objectContaining({ kind: 'gap' }));
    });

    it('announces what it is following, with the grid it is recorded on', () => {
        tail.announce(10);

        expect(delivered).toEqual([
            { kind: 'subscribed', instrumentSymbol: 'BTCUSDT', priceBucketSize: 10 },
        ]);
    });

    it('says nothing once stopped', async () => {
        source.fetchFramesAfter.mockResolvedValue(buildTailWindow([buildTailFrame(6_000)]));
        tail.stop();

        await tail.advance();

        expect(delivered).toEqual([]);
    });
});
