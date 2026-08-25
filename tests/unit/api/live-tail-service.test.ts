import type { LiquidityFrame } from '../../../src/book/liquidity-frame.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    LiveTailService,
    TooManySubscribersError,
} from '../../../src/api/live-tail-service.ts';
import { createLiquidityQueryServiceMock } from '../../mocks/liquidity-query-service.ts';

function buildFrame(capturedAtMs: number): LiquidityFrame {
    return {
        capturedAtMs,
        bestBidPrice: 100,
        bestAskPrice: 101,
        bids: { lowestBucketIndex: 9, quantities: Float32Array.from([1]) },
        asks: { lowestBucketIndex: 10, quantities: Float32Array.from([2]) },
    };
}

function buildService(
    query: ReturnType<typeof createLiquidityQueryServiceMock>,
    maximumSubscriptions = 24,
): LiveTailService {
    return new LiveTailService({
        query: query.service,
        pollIntervalMs: 100,
        maxFramesPerPoll: 50,
        maximumSubscriptions,
    });
}

function buildRequest() {
    return {
        instrumentSymbol: 'BTCUSDT',
        afterMs: 5_000,
        onFrames: vi.fn(),
        onText: vi.fn(),
    };
}

describe('LiveTailService', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('resumes strictly after the instant the subscriber already holds', async () => {
        const query = createLiquidityQueryServiceMock();
        const service = buildService(query);

        service.subscribe({
            instrumentSymbol: 'BTCUSDT',
            afterMs: 5_000,
            onFrames: vi.fn(),
            onText: vi.fn(),
        });
        await vi.advanceTimersByTimeAsync(1);

        expect(query.fetchFramesAfter).toHaveBeenCalledWith(
            expect.objectContaining({ symbol: 'BTCUSDT', afterMs: 5_000 }),
        );
    });

    it('delivers frames the archive returned', async () => {
        const query = createLiquidityQueryServiceMock();
        query.fetchFramesAfter.mockResolvedValue({
            priceBucketSize: 10,
            sampleIntervalMs: 1_000,
            frames: [buildFrame(6_000)],
        });
        const onFrames = vi.fn();
        const service = buildService(query);

        service.subscribe({ instrumentSymbol: 'BTCUSDT', afterMs: 5_000, onFrames, onText: vi.fn() });
        await vi.advanceTimersByTimeAsync(1);

        expect(onFrames).toHaveBeenCalledTimes(1);
    });

    it('advances the cursor to the newest frame it delivered', async () => {
        const query = createLiquidityQueryServiceMock();
        query.fetchFramesAfter.mockResolvedValueOnce({
            priceBucketSize: 10,
            sampleIntervalMs: 1_000,
            frames: [buildFrame(6_000), buildFrame(7_000)],
        });
        const service = buildService(query);

        service.subscribe({
            instrumentSymbol: 'BTCUSDT',
            afterMs: 5_000,
            onFrames: vi.fn(),
            onText: vi.fn(),
        });
        await vi.advanceTimersByTimeAsync(150);

        expect(query.fetchFramesAfter).toHaveBeenLastCalledWith(
            expect.objectContaining({ afterMs: 7_000 }),
        );
    });

    it('delivers nothing when the archive has nothing new', async () => {
        const query = createLiquidityQueryServiceMock();
        const onFrames = vi.fn();
        const service = buildService(query);

        service.subscribe({ instrumentSymbol: 'BTCUSDT', afterMs: 5_000, onFrames, onText: vi.fn() });
        await vi.advanceTimersByTimeAsync(350);

        expect(onFrames).not.toHaveBeenCalled();
    });

    it('leaves the cursor alone when the archive fails, so the range is retried', async () => {
        const query = createLiquidityQueryServiceMock();
        query.fetchFramesAfter.mockRejectedValue(new Error('archive unavailable'));
        const service = buildService(query);

        service.subscribe({
            instrumentSymbol: 'BTCUSDT',
            afterMs: 5_000,
            onFrames: vi.fn(),
            onText: vi.fn(),
        });
        await vi.advanceTimersByTimeAsync(150);

        expect(query.fetchFramesAfter).toHaveBeenLastCalledWith(
            expect.objectContaining({ afterMs: 5_000 }),
        );
    });

    it('stops polling once the subscription is cancelled', async () => {
        const query = createLiquidityQueryServiceMock();
        const service = buildService(query);
        const unsubscribe = service.subscribe({
            instrumentSymbol: 'BTCUSDT',
            afterMs: 5_000,
            onFrames: vi.fn(),
            onText: vi.fn(),
        });
        await vi.advanceTimersByTimeAsync(1);
        const callsBeforeCancel = query.fetchFramesAfter.mock.calls.length;

        unsubscribe();
        await vi.advanceTimersByTimeAsync(500);

        expect(query.fetchFramesAfter.mock.calls.length).toBe(callsBeforeCancel);
    });

    it('drops every subscription when the service stops', () => {
        const query = createLiquidityQueryServiceMock();
        const service = buildService(query);
        service.subscribe({
            instrumentSymbol: 'BTCUSDT',
            afterMs: 5_000,
            onFrames: vi.fn(),
            onText: vi.fn(),
        });

        service.stop();

        expect(service.subscriptionCount).toBe(0);
    });
});

describe('LiveTailService budget', () => {
    it('serves viewers up to its budget', () => {
        const service = buildService(createLiquidityQueryServiceMock(), 2);

        service.subscribe(buildRequest());
        service.subscribe(buildRequest());

        expect(service.subscriptionCount).toBe(2);
    });

    it('refuses a viewer past the budget rather than starving the recording', () => {
        const service = buildService(createLiquidityQueryServiceMock(), 1);
        service.subscribe(buildRequest());

        expect(() => service.subscribe(buildRequest())).toThrow(TooManySubscribersError);
    });

    it('frees the slot once a viewer disconnects', () => {
        const service = buildService(createLiquidityQueryServiceMock(), 1);
        const unsubscribe = service.subscribe(buildRequest());

        unsubscribe();

        expect(() => service.subscribe(buildRequest())).not.toThrow();
    });
});
