import type { MarketDataSocket } from '../../src/workers/core/market-data-socket.ts';

/** A socket whose four events the test fires by hand. */
export interface FakeMarketDataSocket extends MarketDataSocket {
    /** Reports the venue accepting the connection. */
    open: () => void;
    /** Delivers one frame, already decoded to text. */
    deliver: (payload: string) => void;
    /** Reports a transport fault. */
    fail: (reason: unknown) => void;
    /** Reports the venue closing the connection. */
    hangUp: () => void;
    readonly wasClosed: () => boolean;
}

/**
 * Builds a socket that does nothing until the test tells it to.
 *
 * @returns The socket, plus the handles that fire its events.
 */
export function openFakeMarketDataSocket(): FakeMarketDataSocket {
    const handlers: Record<string, ((value: never) => void) | null> = {};
    let wasClosed = false;

    return {
        onOpen: (handler) => { handlers['open'] = handler; },
        onMessage: (handler) => { handlers['message'] = handler; },
        onError: (handler) => { handlers['error'] = handler; },
        onClose: (handler) => { handlers['close'] = handler; },
        close: () => { wasClosed = true; return Promise.resolve(); },
        open: () => handlers['open']?.(undefined as never),
        deliver: (payload) => handlers['message']?.(payload as never),
        fail: (reason) => handlers['error']?.(reason as never),
        hangUp: () => handlers['close']?.(undefined as never),
        wasClosed: () => wasClosed,
    };
}

/**
 * Builds a socket that connects and then says nothing.
 *
 * @returns A socket a lifecycle test can start and stop without feeding.
 */
export function openSilentMarketDataSocket(): MarketDataSocket {
    return openFakeMarketDataSocket();
}
