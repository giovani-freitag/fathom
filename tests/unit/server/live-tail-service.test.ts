import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTailFrame, buildTailWindow, createLiveTailSourceMock, type LiveTailSourceMock } from '../../mocks/live-tail-source.ts';
import { LiveTailService, TooManySubscribersError } from '../../../src/server/services/live-tail-service.ts';
import type { LiveMessage } from '../../../src/shared/core/live-message.ts';

const POLL_INTERVAL_MS = 100;

describe('LiveTailService', () => {
    let source: LiveTailSourceMock;
    let delivered: LiveMessage[];

    function buildService(maximumSubscriptions = 24): LiveTailService {
        return new LiveTailService({
            source: source.source,
            pollIntervalMs: POLL_INTERVAL_MS,
            maxFramesPerPoll: 50,
            maximumSubscriptions,
        });
    }

    function buildRequest(instrumentSymbol = 'BTCUSDT') {
        return {
            instrumentSymbol,
            afterMs: 5_000,
            priceBucketSize: 10,
            onMessage: (message: LiveMessage) => { delivered.push(message); },
        };
    }

    beforeEach(() => {
        vi.useFakeTimers();
        source = createLiveTailSourceMock();
        delivered = [];
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('tells a new viewer what it is following before anything is streamed', () => {
        buildService().subscribe(buildRequest());

        expect(delivered[0]).toMatchObject({ kind: 'subscribed', priceBucketSize: 10 });
    });

    it('catches a tail up when the archive says its contract grew', async () => {
        // The interval below is a backstop; this is the trigger that makes a
        // second reach the reader in the time it takes to write it.
        const service = buildService();
        service.subscribe(buildRequest());
        await vi.advanceTimersByTimeAsync(1);
        const readsBefore = source.fetchFramesAfter.mock.calls.length;

        service.nudge('BTCUSDT');
        await vi.advanceTimersByTimeAsync(1);

        expect(source.fetchFramesAfter.mock.calls.length).toBeGreaterThan(readsBefore);
    });

    it('leaves alone a tail following something else', async () => {
        const service = buildService();
        service.subscribe(buildRequest('BTCUSDT'));
        await vi.advanceTimersByTimeAsync(1);
        const readsBefore = source.fetchFramesAfter.mock.calls.length;

        service.nudge('ETHUSDT');
        await vi.advanceTimersByTimeAsync(1);

        expect(source.fetchFramesAfter.mock.calls).toHaveLength(readsBefore);
    });

    it('catches up on its own when no nudge arrives', async () => {
        source.fetchFramesAfter.mockResolvedValue(buildTailWindow([buildTailFrame(6_000)]));
        buildService().subscribe(buildRequest());

        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);

        expect(source.fetchFramesAfter.mock.calls.length).toBeGreaterThan(1);
    });

    it('stops reading once a viewer disconnects', async () => {
        const service = buildService();
        const unsubscribe = service.subscribe(buildRequest());
        await vi.advanceTimersByTimeAsync(1);
        const readsBefore = source.fetchFramesAfter.mock.calls.length;

        unsubscribe();
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4);

        expect(source.fetchFramesAfter.mock.calls).toHaveLength(readsBefore);
    });

    it('drops every viewer when the gateway stops', () => {
        const service = buildService();
        service.subscribe(buildRequest());

        service.stop();

        expect(service.subscriptionCount).toBe(0);
    });

    it('refuses a viewer past its budget rather than starving the recording', () => {
        const service = buildService(1);
        service.subscribe(buildRequest());

        expect(() => service.subscribe(buildRequest())).toThrow(TooManySubscribersError);
    });

    it('frees the slot once a viewer disconnects', () => {
        const service = buildService(1);
        const unsubscribe = service.subscribe(buildRequest());

        unsubscribe();

        expect(() => service.subscribe(buildRequest())).not.toThrow();
    });
});
