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

    function follow(instrumentSymbol = 'BTCUSDT'): void {
        feed.connect({
            instrumentSymbol,
            afterMs: RESUME_FROM_MS,
            onMessage: (message) => { received.push(message); },
            onStatusChanged: (status) => { statuses.push(status); },
        });
    }

    /** The acknowledgement the collector sends before it starts delivering. */
    function acknowledge(instrumentSymbol = 'BTCUSDT'): void {
        feed.handleCollectorEvent({
            kind: 'live',
            message: { kind: 'subscribed', instrumentSymbol, priceBucketSize: 10 },
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
        acknowledge();
        received.length = 0;

        feed.handleCollectorEvent({ kind: 'live', message: { kind: 'frames', window } });

        expect(received).toEqual([{ kind: 'frames', window }]);
    });

    it('counts the acknowledgement as the collector answering', () => {
        follow();

        acknowledge();

        expect(statuses).toEqual(['connecting', 'streaming']);
    });

    it('draws nothing the contract it left behind had already sent', () => {
        // The collector is told to stop, but what it posted before reading that
        // is already on its way, and a frame message names no instrument.
        const window = buildWindow([buildFrame(RESUME_FROM_MS + 1_000)]);
        follow('BTCUSDT');
        acknowledge('BTCUSDT');
        feed.disconnect();
        follow('ETHUSDT');
        received.length = 0;

        feed.handleCollectorEvent({ kind: 'live', message: { kind: 'frames', window } });

        expect(received).toEqual([]);
    });

    it('waits for the new acknowledgement when it is pointed straight at another contract', () => {
        // A tail replaced without being disconnected first: what is already in
        // flight still belongs to the contract that was being followed.
        const window = buildWindow([buildFrame(RESUME_FROM_MS + 1_000)]);
        follow('BTCUSDT');
        acknowledge('BTCUSDT');
        follow('ETHUSDT');
        received.length = 0;

        feed.handleCollectorEvent({ kind: 'live', message: { kind: 'frames', window } });

        expect(received).toEqual([]);
    });

    it('draws what the contract it moved to sends, once that is acknowledged', () => {
        const window = buildWindow([buildFrame(RESUME_FROM_MS + 1_000)]);
        follow('ETHUSDT');
        acknowledge('ETHUSDT');
        received.length = 0;

        feed.handleCollectorEvent({ kind: 'live', message: { kind: 'frames', window } });

        expect(received).toEqual([{ kind: 'frames', window }]);
    });

    it('ignores an acknowledgement for a contract it is not following', () => {
        follow('ETHUSDT');

        acknowledge('BTCUSDT');

        expect(statuses).toEqual(['connecting']);
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
