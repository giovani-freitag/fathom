import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket as ServerSideSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import type { MarketDataSocket } from '../../../src/workers/core/market-data-socket.ts';
import { openNodeMarketDataSocket } from '../../../src/workers/transport/node-market-data-socket.ts';

interface Venue {
    readonly server: WebSocketServer;
    readonly streamUrl: string;
    /** The peer, once one has connected. */
    readonly connections: ServerSideSocket[];
}

/** A venue on a port the host picked, speaking the same protocol Binance does. */
async function openVenue(): Promise<Venue> {
    const server = new WebSocketServer({ port: 0 });
    const connections: ServerSideSocket[] = [];
    server.on('connection', (connection) => { connections.push(connection); });

    await new Promise<void>((resolve) => { server.once('listening', resolve); });
    const { port } = server.address() as AddressInfo;
    return { server, streamUrl: `ws://127.0.0.1:${port}`, connections };
}

async function closeVenue(venue: Venue): Promise<void> {
    venue.connections.forEach((connection) => { connection.terminate(); });
    await new Promise<void>((resolve) => { venue.server.close(() => { resolve(); }); });
}

/** Resolves with the first frame the socket reports, as text. */
function readFirstFrame(socket: MarketDataSocket): Promise<string> {
    const { promise, resolve } = Promise.withResolvers<string>();
    socket.onMessage(resolve);
    return promise;
}

/** Resolves once the socket reports the venue accepted it. */
function waitForOpen(socket: MarketDataSocket): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    socket.onOpen(resolve);
    return promise;
}

describe('openNodeMarketDataSocket', () => {
    let venue: Venue;
    let socket: MarketDataSocket | null;

    beforeEach(async () => {
        venue = await openVenue();
        socket = null;
    });

    afterEach(async () => {
        await socket?.close();
        await closeVenue(venue);
    });

    it('reports the venue accepting the connection', async () => {
        socket = openNodeMarketDataSocket(venue.streamUrl);

        await waitForOpen(socket);

        expect(venue.connections).toHaveLength(1);
    });

    it('reads a frame the venue sent as text', async () => {
        socket = openNodeMarketDataSocket(venue.streamUrl);
        const frame = readFirstFrame(socket);
        await waitForOpen(socket);

        venue.connections[0]!.send('{"stream":"btcusdt@depth","data":{}}');

        await expect(frame).resolves.toBe('{"stream":"btcusdt@depth","data":{}}');
    });

    it('reads a frame the venue sent as bytes', async () => {
        // A venue that negotiated compression, or a proxy in between, delivers
        // the same JSON as a binary frame.
        socket = openNodeMarketDataSocket(venue.streamUrl);
        const frame = readFirstFrame(socket);
        await waitForOpen(socket);

        venue.connections[0]!.send(Buffer.from('{"e":"depthUpdate"}', 'utf8'));

        await expect(frame).resolves.toBe('{"e":"depthUpdate"}');
    });

    it('reports the venue hanging up', async () => {
        socket = openNodeMarketDataSocket(venue.streamUrl);
        const { promise, resolve } = Promise.withResolvers<void>();
        socket.onClose(() => { resolve(); });
        await waitForOpen(socket);

        venue.connections[0]!.close();

        await expect(promise).resolves.toBeUndefined();
    });

    it('closes at once when the venue already hung up', async () => {
        // No further close event is coming, so waiting out the grace would hold
        // the collector's exit for two seconds per socket, for nothing.
        socket = openNodeMarketDataSocket(venue.streamUrl);
        const { promise, resolve } = Promise.withResolvers<void>();
        socket.onClose(() => { resolve(); });
        await waitForOpen(socket);
        venue.connections[0]!.close();
        await promise;

        const startedAtMs = Date.now();
        await socket.close();

        expect(Date.now() - startedAtMs).toBeLessThan(500);
    });

    it('closes without waiting on a venue that already hung up', async () => {
        socket = openNodeMarketDataSocket(venue.streamUrl);
        await waitForOpen(socket);

        await expect(socket.close()).resolves.toBeUndefined();
    });

    it('is safe to close twice', async () => {
        // The feed closes on shutdown and again on the socket's own close event,
        // and a second close must not hang the collector's exit.
        socket = openNodeMarketDataSocket(venue.streamUrl);
        await waitForOpen(socket);
        await socket.close();

        await expect(socket.close()).resolves.toBeUndefined();
    });

    it('reports no hang-up for a close it performed itself', async () => {
        // Told the socket closed, the feed treats it as the venue dropping the
        // stream and reconnects the very connection it just shut down.
        socket = openNodeMarketDataSocket(venue.streamUrl);
        const hangUps: string[] = [];
        socket.onClose(() => { hangUps.push('closed'); });
        await waitForOpen(socket);

        await socket.close();
        await new Promise((resolve) => { setTimeout(resolve, 50); });

        expect(hangUps).toEqual([]);
    });
});
