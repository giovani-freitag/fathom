import { describe, expect, it, type Mock, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { createLiveHandler } from '../../../src/server/http/actions/live-action.ts';
import type { LiquidityQueryService } from '../../../src/database/services/liquidity-query-service.ts';
import type { LiveFilters } from '../../../src/server/http/schemas/live-schema.ts';
import type {
    LiveTailService,
    LiveTailSubscriptionRequest,
} from '../../../src/server/services/live-tail-service.ts';
import { type FakeSocket, openFakeSocket } from '../../mocks/websocket.ts';

const RECORDED = [{
    instrumentSymbol: 'BTCUSDT',
    priceBucketSize: 10,
    frameIntervalMs: 1_000,
    firstFrameAtMs: 1_000,
    lastFrameAtMs: 2_000,
}];

type LiveHandler = ReturnType<typeof createLiveHandler>;

interface Harness {
    readonly handler: LiveHandler;
    readonly socket: FakeSocket;
    readonly listInstruments: ReturnType<typeof vi.fn>;
    readonly subscribe: Mock<(request: LiveTailSubscriptionRequest) => () => void>;
}

function buildHarness(): Harness {
    const listInstruments = vi.fn().mockResolvedValue(RECORDED);
    const subscribe: Harness['subscribe'] = vi.fn(() => () => undefined);

    const handler = createLiveHandler({
        query: { listInstruments } as unknown as LiquidityQueryService,
        liveTail: { subscribe } as unknown as LiveTailService,
    });

    return { handler, socket: openFakeSocket(), listInstruments, subscribe };
}

/** A connect request for one instrument, resuming after an instant. */
function buildRequest(symbol: string, afterMs = 1_500): FastifyRequest<{ Querystring: LiveFilters }> {
    return { query: { symbol, afterMs } } as FastifyRequest<{ Querystring: LiveFilters }>;
}

describe('createLiveHandler', () => {
    it('follows an instrument the archive knows', async () => {
        const harness = buildHarness();

        await harness.handler(harness.socket, buildRequest('BTCUSDT'));

        expect(harness.subscribe).toHaveBeenCalled();
    });

    it('refuses an instrument that has never been recorded', async () => {
        const harness = buildHarness();

        await harness.handler(harness.socket, buildRequest('DOGEUSDT'));

        expect(harness.socket.closures).toEqual([
            { code: 1008, reason: 'Instrument DOGEUSDT has never been recorded' },
        ]);
    });

    it('resumes from now when the viewer names no instant', async () => {
        const harness = buildHarness();

        await harness.handler(harness.socket, buildRequest('BTCUSDT', 0));

        expect(harness.subscribe.mock.calls[0]?.[0]?.afterMs).toBeGreaterThan(RECORDED[0]!.lastFrameAtMs);
    });

    it('closes the socket when the archive cannot say what is recorded', async () => {
        // Left open, the viewer sits on a socket that never sends and never
        // closes: the feed reads as streaming while nothing arrives.
        const harness = buildHarness();
        harness.listInstruments.mockRejectedValue(new Error('database unreachable'));

        await harness.handler(harness.socket, buildRequest('BTCUSDT'));

        expect(harness.socket.closures.map((closure) => closure.code)).toEqual([1011]);
    });

    it('closes with a code the viewer will try again after', async () => {
        const harness = buildHarness();
        harness.listInstruments.mockRejectedValue(new Error('database unreachable'));

        await harness.handler(harness.socket, buildRequest('BTCUSDT'));

        expect(harness.socket.closures[0]?.code).not.toBe(1008);
    });
});
