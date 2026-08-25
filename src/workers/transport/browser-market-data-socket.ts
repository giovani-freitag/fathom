import type { MarketDataSocket } from '../core/market-data-socket.ts';

/**
 * The platform WebSocket, behind the socket the feed expects.
 *
 * Binary frames are asked for as `arraybuffer` rather than the default Blob, so
 * decoding stays synchronous and a message never has to be awaited.
 */
export function openBrowserMarketDataSocket(streamUrl: string): MarketDataSocket {
    const socket = new WebSocket(streamUrl);
    socket.binaryType = 'arraybuffer';
    let wasClosed = false;

    return {
        onOpen: (handler) => socket.addEventListener('open', () => { handler(); }),
        onMessage: (handler) => socket.addEventListener('message', (event: MessageEvent) => {
            handler(decodeFrameText(event.data));
        }),
        onError: (handler) => socket.addEventListener('error', (event) => { handler(event); }),
        onClose: (handler) => socket.addEventListener('close', () => { handler(); }),
        close: async () => {
            if (wasClosed) {
                return;
            }
            wasClosed = true;
            socket.close();
            return Promise.resolve();
        },
    };
}

function decodeFrameText(data: unknown): string {
    if (typeof data === 'string') {
        return data;
    }
    if (data instanceof ArrayBuffer) {
        return new TextDecoder().decode(data);
    }
    return String(data);
}
