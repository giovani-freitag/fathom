/** Raised when the environment cannot produce a usable configuration. */
export class ConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ConfigurationError';
    }
}

export interface CollectorConfiguration {
    readonly instrumentSymbol: string;
    readonly priceBucketSize: number;
    readonly frameIntervalMs: number;
    readonly recordedPriceRangeRatio: number;
    readonly retainedPriceRangeRatio: number;
    readonly deepRepairIntervalMs: number;
}

/**
 * Reads the collector's configuration from the process environment.
 *
 * @returns A validated configuration.
 * @throws ConfigurationError when a required variable is missing, or a numeric
 *         one is absent from the positive reals, or the retained price range is
 *         not wider than the recorded one.
 */
export const BINANCE_ENDPOINTS = {
    restApiBaseUrl: 'https://fapi.binance.com',
    webSocketBaseUrl: 'wss://fstream.binance.com',
    /** The deepest ladder the REST endpoint serves in one call. */
    depthSnapshotLevelLimit: 1_000,
    depthUpdateIntervalLabel: '100ms',
} as const;

export const RESILIENCE_SETTINGS = {
    /** The venue closes any stream connection at 24 hours; reconnect before it does. */
    proactiveReconnectIntervalMs: 23 * 60 * 60 * 1_000,
    /** Depth updates arrive ten times a second, so this much silence means a dead socket. */
    inboundSilenceTimeoutMs: 30_000,
    initialReconnectDelayMs: 1_000,
    maximumReconnectDelayMs: 60_000,
    snapshotRequestTimeoutMs: 10_000,
    snapshotRetryDelayMs: 1_000,
} as const;

export const WRITE_SETTINGS = {
    flushIntervalMs: 1_000,
    framesPerFlush: 60,
    /**
     * Frames held in memory while writes are failing.
     */
    maximumBufferedFrames: 600,
    maximumBufferedTradeClusters: 20_000,
} as const;

/** Write pacing for a server, where a batch per flush amortises the round trip. */
/**
 * How the whole book is written down beside the recorded band.
 *
 * The recording a chart reads is clipped to a couple of percent around the
 * price and cannot see a wall standing where the market has not been. This
 * frames every price, on a logarithmic scale two percent to the step — the
 * tightest precision measured, and the one worth judging by eye, because it is
 * what decides whether the picture is worth the loss.
 *
 * Shared by the server and by a page, because the squares they write have to be
 * the same squares: a grid that differed between them would be two archives
 * that cannot be held against each other.
 */
export const WHOLE_BOOK_FRAMING = {
    priceRangeRatio: 1,
    stepPrecision: 0.02,
    frameIntervalMs: 1_000,
} as const;

export const BROWSER_WRITE_SETTINGS = {
    ...WRITE_SETTINGS,
    // One frame per flush in a page: the archive is local, a batch buys nothing,
    // and a visitor watching the chart should see the second they just lived.
    framesPerFlush: 1,
} as const;
