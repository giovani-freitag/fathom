import type { MarketDataSocket } from '../core/market-data-socket.ts';
import WebSocket from 'ws';
import { delay } from '../../shared/core/timers.ts';

/** How long a polite close is given before the socket is torn down. */
const CLOSE_GRACE_MS = 2_000;

/**
 * The `ws` client, behind the socket the feed expects.
 */
export function openNodeMarketDataSocket(streamUrl: string): MarketDataSocket {
    const socket = new WebSocket(streamUrl);
    let wasClosed = false;

    return {
        onOpen: (handler) => socket.on('open', handler),
        onMessage: (handler) => socket.on('message', (raw: WebSocket.RawData) => {
            handler(decodeFrameText(raw));
        }),
        onError: (handler) => socket.on('error', handler),
        onClose: (handler) => socket.on('close', handler),
        close: async () => {
            if (wasClosed) {
                return;
            }
            wasClosed = true;
            socket.removeAllListeners();

            // A socket the venue already hung up on emits no further close, so
            // waiting out the grace would hold the collector's exit for nothing.
            if (socket.readyState === WebSocket.CLOSED) {
                return;
            }

            const { promise, resolve } = Promise.withResolvers<void>();
            socket.once('close', resolve);
            socket.close();
            await Promise.race([promise, delay(CLOSE_GRACE_MS)]);
            socket.terminate();
        },
    };
}

/**
 * Reads a frame as text, whichever shape the client handed over.
 *
 * @param rawPayload - One frame as `ws` delivered it.
 * @returns The frame decoded as UTF-8.
 */
function decodeFrameText(rawPayload: WebSocket.RawData): string {
    if (typeof rawPayload === 'string') {
        return rawPayload;
    }
    if (Array.isArray(rawPayload)) {
        return Buffer.concat(rawPayload).toString('utf8');
    }
    return Buffer.from(rawPayload as ArrayBuffer).toString('utf8');
}
