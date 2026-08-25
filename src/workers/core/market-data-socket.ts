/**
 * The socket the depth feed needs, with nothing of any runtime in it.
 *
 * Node and the browser disagree on almost everything about a WebSocket: how it
 * is constructed, whether listeners attach with `on` or `addEventListener`, and
 * whether a message arrives as a Buffer, a Blob or a string. None of that is
 * market data, so it stays in an adapter and the feed sees only this.
 */
export interface MarketDataSocket {
    /** Fired once the venue accepts the connection. */
    onOpen: (handler: () => void) => void;
    /** Fired per frame, already decoded to text by the adapter. */
    onMessage: (handler: (payload: string) => void) => void;
    /** Fired when the transport reports a fault, with whatever it reported. */
    onError: (handler: (reason: unknown) => void) => void;
    /** Fired once the socket is closed, however it got there. */
    onClose: (handler: () => void) => void;
    /** Closes the socket and releases every listener. Safe to call twice. */
    close: () => Promise<void>;
}

/**
 * Opens a socket to a stream URL.
 *
 * A factory rather than an instance because the feed reconnects: each attempt
 * needs its own socket, and a closed one can never be reopened.
 */
export type MarketDataSocketFactory = (streamUrl: string) => MarketDataSocket;
