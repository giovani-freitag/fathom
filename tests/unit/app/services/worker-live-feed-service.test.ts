import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { buildFrame, buildWindow } from '../../../mocks/chart-services.ts';
import type { LiveFeedStatus } from '../../../../src/app/services/live-feed.ts';
import type { LiveMessage } from '../../../../src/shared/core/live-message.ts';
import { WorkerLiveFeedService } from '../../../../src/app/services/worker-live-feed-service.ts';

const RESUME_FROM_MS = 1_000_000;

describe('WorkerLiveFeedService', () => {
    let feed: WorkerLiveFeedService;
    let subscribe: Mock<(instrumentSymbol: string, afterMs: number) => void>;
    let unsubscribe: Mock<() => void>;
    let received: LiveMessage[];
    let statuses: LiveFeedStatus[];

    function follow(): void {
        feed.connect({
            instrumentSymbol: 'BTCUSDT',
            afterMs: RESUME_FROM_MS,
            onMessage: (message) => { received.push(message); },
            onStatusChanged: (status) => { statuses.push(status); },
        });
    }

    beforeEach(() => {
        received = [];
        statuses = [];
        subscribe = vi.fn<(instrumentSymbol: string, afterMs: number) => void>();
        unsubscribe = vi.fn<() => void>();
        feed = new WorkerLiveFeedService({ subscribe, unsubscribe });
    });

    it('asks the collector to follow from the instant the page already holds', () => {
        follow();

        expect(subscribe).toHaveBeenCalledWith('BTCUSDT', RESUME_FROM_MS);
    });

    it('hands the chart exactly what the collector sent', () => {
        // The same type a socket delivers; only the carrier differs, so the
        // chart cannot tell which half of the product it is talking to.
        const window = buildWindow([buildFrame(RESUME_FROM_MS + 1_000)]);
        follow();

        feed.handleCollectorEvent({ kind: 'live', message: { kind: 'frames', window } });

        expect(received).toEqual([{ kind: 'frames', window }]);
    });

    it('counts the acknowledgement as the collector answering', () => {
        follow();

        feed.handleCollectorEvent({
            kind: 'live',
            message: { kind: 'subscribed', instrumentSymbol: 'BTCUSDT', priceBucketSize: 10 },
        });

        expect(statuses).toEqual(['connecting', 'streaming']);
    });

    it('ignores what the collector says about itself', () => {
        follow();

        feed.handleCollectorEvent({ kind: 'state', state: 'recording' });
        feed.handleCollectorEvent({ kind: 'log', level: 'info', message: 'Recording' });

        expect(received).toEqual([]);
    });

    it('stops listening once disconnected, so a late message is nobody s', () => {
        follow();
        feed.disconnect();

        feed.handleCollectorEvent({
            kind: 'live',
            message: { kind: 'gap', gap: { gapStartedAtMs: 1, gapEndedAtMs: 2, gapReason: 'dropped' } },
        });

        expect(unsubscribe).toHaveBeenCalled();
        expect(received).toEqual([]);
        expect(statuses).toEqual(['connecting', 'idle']);
    });
});
