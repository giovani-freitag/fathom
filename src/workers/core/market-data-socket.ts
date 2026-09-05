/**
 * The socket the depth feed needs, with nothing of any runtime in it.
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
    /**
     * Says something to the venue.
     *
     * Needed by venues that take their subscription over the socket rather than
     * in the URL, and by those that drop a connection nothing has said anything
     * on. Dropped silently once the socket is closed.
     */
    send: (message: string) => void;
    /** Closes the socket and releases every listener. Safe to call twice. */
    close: () => Promise<void>;
}

/**
 * Opens a socket to a stream URL.
 */
export type MarketDataSocketFactory = (streamUrl: string) => MarketDataSocket;
