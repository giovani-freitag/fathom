import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { ArchiveLiveFeedService } from '../../../../src/app/services/archive-live-feed-service.ts';
import { buildFrame, buildWindow } from '../../../mocks/chart-services.ts';
import type { FrameWindowQuery, HeatmapSource } from '../../../../src/shared/core/heatmap-source.ts';
import type { LiquidityFrameWindow } from '../../../../src/shared/core/liquidity-frame.ts';
import type { LiveFeedStatus } from '../../../../src/app/services/live-feed.ts';

const POLL_INTERVAL_MS = 500;
const RESUME_FROM_MS = 1_000_000;

describe('ArchiveLiveFeedService', () => {
    // Typed rather than left to inference: a bare `vi.fn()` is declared as
    // returning void, and a stub that answers with a promise then reads as a
    // mistake rather than as the slow read it is standing in for.
    let fetchFrameWindow: Mock<(query: FrameWindowQuery) => Promise<LiquidityFrameWindow>>;
    let feed: ArchiveLiveFeedService;
    let statuses: LiveFeedStatus[];
    let delivered: number[];

    function follow(): void {
        feed.connect({
            instrumentSymbol: 'BTCUSDT',
            afterMs: RESUME_FROM_MS,
            onFrames: (window) => {
                delivered.push(...window.frames.map((frame) => frame.capturedAtMs));
            },
            onText: () => undefined,
            onStatusChanged: (status) => { statuses.push(status); },
        });
    }

    beforeEach(() => {
        vi.useFakeTimers();
        statuses = [];
        delivered = [];
        fetchFrameWindow = vi.fn<(query: FrameWindowQuery) => Promise<LiquidityFrameWindow>>()
            .mockResolvedValue(buildWindow([]));
        feed = new ArchiveLiveFeedService({ source: { fetchFrameWindow } as unknown as HeatmapSource });
    });

    afterEach(() => {
        feed.disconnect();
        vi.useRealTimers();
    });

    it('picks up from the instant the caller already has', async () => {
        follow();

        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

        expect(fetchFrameWindow).toHaveBeenCalledWith(
            expect.objectContaining({ symbol: 'BTCUSDT', fromMs: RESUME_FROM_MS + 1 }),
        );
    });

    it('advances the mark so a second poll does not re-read the same seconds', async () => {
        fetchFrameWindow.mockResolvedValueOnce(buildWindow([buildFrame(RESUME_FROM_MS + 2_000)]));
        follow();

        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

        expect(fetchFrameWindow.mock.calls[1]![0]).toMatchObject({
            fromMs: RESUME_FROM_MS + 2_001,
        });
    });

    it('hands over only the polls that carried something', async () => {
        fetchFrameWindow
            .mockResolvedValueOnce(buildWindow([]))
            .mockResolvedValueOnce(buildWindow([buildFrame(RESUME_FROM_MS + 1_000)]));
        follow();

        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);

        expect(delivered).toEqual([RESUME_FROM_MS + 1_000]);
    });

    it('says it is reconnecting when the archive will not answer, and keeps trying', async () => {
        fetchFrameWindow.mockRejectedValueOnce(new Error('the store is closed'));
        follow();

        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);

        expect(statuses).toEqual(['connecting', 'reconnecting', 'streaming']);
    });

    it('never runs two polls at once, however slow the archive is', async () => {
        // A read that outlives its interval would otherwise stack, and each one
        // that finished late would rewind the mark the next had already moved.
        // Never settles, which is what a read slower than the interval looks like.
        fetchFrameWindow.mockImplementation(() => new Promise<never>(() => { /* held open */ }));
        follow();

        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);

        expect(fetchFrameWindow).toHaveBeenCalledTimes(1);
    });

    it('stops reading once it has been disconnected', async () => {
        follow();
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

        feed.disconnect();
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4);

        expect(fetchFrameWindow).toHaveBeenCalledTimes(1);
    });
});
