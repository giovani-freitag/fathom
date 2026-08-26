import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BinanceDepthFeedService } from '../../../src/workers/services/binance-depth-feed-service.ts';
import { type FakeMarketDataSocket, openFakeMarketDataSocket } from '../../mocks/market-data-socket.ts';

const SILENCE_TIMEOUT_MS = 20_000;
const PROACTIVE_INTERVAL_MS = 600_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAXIMUM_BACKOFF_MS = 8_000;

interface Harness {
    readonly feed: BinanceDepthFeedService;
    readonly sockets: FakeMarketDataSocket[];
    readonly disconnections: string[];
    readonly diffs: unknown[];
}

function buildHarness(): Harness {
    const sockets: FakeMarketDataSocket[] = [];
    const disconnections: string[] = [];
    const diffs: unknown[] = [];

    const feed = new BinanceDepthFeedService({
        instrumentSymbol: 'BTCUSDT',
        restApiBaseUrl: 'https://example.invalid',
        webSocketBaseUrl: 'wss://example.invalid',
        depthSnapshotLevelLimit: 1_000,
        depthUpdateIntervalLabel: '100ms',
        proactiveReconnectIntervalMs: PROACTIVE_INTERVAL_MS,
        inboundSilenceTimeoutMs: SILENCE_TIMEOUT_MS,
        initialReconnectDelayMs: INITIAL_BACKOFF_MS,
        maximumReconnectDelayMs: MAXIMUM_BACKOFF_MS,
        snapshotRequestTimeoutMs: 5_000,
        onDepthDiff: (diff) => { diffs.push(diff); },
        onExecutedTrade: () => undefined,
        onConnected: () => undefined,
        onDisconnected: (reason) => { disconnections.push(reason); },
        openSocket: () => {
            const socket = openFakeMarketDataSocket();
            sockets.push(socket);
            return socket;
        },
    });

    return { feed, sockets, disconnections, diffs };
}

/** Drives one full cycle: the socket fails, the backoff elapses, a new one opens. */
function failAndReconnect(harness: Harness): void {
    harness.sockets[harness.sockets.length - 1]!.hangUp();
    vi.advanceTimersByTime(MAXIMUM_BACKOFF_MS);
}

describe('BinanceDepthFeedService', () => {
    let harness: Harness;

    beforeEach(() => {
        vi.useFakeTimers();
        harness = buildHarness();
        harness.feed.connect();
        harness.sockets[0]!.open();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('gives up on a socket that has gone quiet and opens another', () => {
        vi.advanceTimersByTime(SILENCE_TIMEOUT_MS);
        vi.advanceTimersByTime(INITIAL_BACKOFF_MS);

        expect(harness.disconnections).toEqual(['no inbound traffic within the silence timeout']);
        expect(harness.sockets).toHaveLength(2);
    });

    it('counts inbound traffic as a sign of life', () => {
        for (let elapsed = 0; elapsed < SILENCE_TIMEOUT_MS * 3; elapsed += SILENCE_TIMEOUT_MS / 2) {
            vi.advanceTimersByTime(SILENCE_TIMEOUT_MS / 2);
            harness.sockets[0]!.deliver('{}');
        }

        expect(harness.disconnections).toEqual([]);
    });

    it('reconnects ahead of the cutoff the venue imposes, however healthy the socket is', () => {
        // Fed throughout, so the only thing that can end this socket is the
        // clock the venue itself keeps.
        for (let elapsed = 0; elapsed < PROACTIVE_INTERVAL_MS; elapsed += SILENCE_TIMEOUT_MS / 2) {
            vi.advanceTimersByTime(SILENCE_TIMEOUT_MS / 2);
            harness.sockets[0]!.deliver('{}');
        }

        expect(harness.disconnections).toEqual(['proactive reconnect ahead of the venue cutoff']);
    });

    it('waits longer after each failure, up to a ceiling', () => {
        // Four failures without a successful open: 1s, 2s, 4s, then held at 8s
        // rather than climbing until the contract is effectively abandoned.
        for (let attempt = 0; attempt < 4; attempt += 1) {
            failAndReconnect(harness);
        }
        harness.sockets[harness.sockets.length - 1]!.hangUp();

        vi.advanceTimersByTime(MAXIMUM_BACKOFF_MS - 1);
        const beforeCeiling = harness.sockets.length;
        vi.advanceTimersByTime(1);

        expect(beforeCeiling).toBe(5);
        expect(harness.sockets).toHaveLength(6);
    });

    it('forgets the failures once a socket connects again', () => {
        // Without this a flaky hour ends with the feed sitting at its maximum
        // delay for the rest of the day, which reads as a collector that died.
        failAndReconnect(harness);
        failAndReconnect(harness);
        harness.sockets[harness.sockets.length - 1]!.open();

        harness.sockets[harness.sockets.length - 1]!.hangUp();
        vi.advanceTimersByTime(INITIAL_BACKOFF_MS);

        expect(harness.sockets).toHaveLength(4);
    });

    it('hands a depth update on to whoever is keeping the book', () => {
        // Wrapped the way a combined stream delivers it, which is the shape the
        // reader unwraps before it looks at the event type.
        harness.sockets[0]!.deliver(JSON.stringify({
            stream: 'btcusdt@depth@100ms',
            data: { e: 'depthUpdate', E: 1, T: 1, s: 'BTCUSDT', U: 1, u: 2, pu: 0, b: [['1', '2']], a: [] },
        }));

        expect(harness.diffs).toHaveLength(1);
    });

    it('ignores a frame it cannot read rather than dropping the socket', () => {
        harness.sockets[0]!.deliver('not json at all');

        expect(harness.diffs).toEqual([]);
        expect(harness.disconnections).toEqual([]);
    });

    it('stops reconnecting once it has been disconnected', async () => {
        await harness.feed.disconnect();
        harness.sockets[0]!.hangUp();
        vi.advanceTimersByTime(MAXIMUM_BACKOFF_MS * 4);

        expect(harness.sockets).toHaveLength(1);
    });

    it('refuses to be reconnected after a disconnect, which would leak a socket', async () => {
        await harness.feed.disconnect();

        expect(() => { harness.feed.connect(); }).toThrow();
    });
});
