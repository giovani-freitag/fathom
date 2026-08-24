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
    readonly databaseUrl: string;
}

/**
 * Reads the collector's configuration from the process environment.
 *
 * @returns A validated configuration.
 * @throws ConfigurationError when a required variable is missing, or a numeric
 *         one is absent from the positive reals, or the retained price range is
 *         not wider than the recorded one.
 */
export function readCollectorConfiguration(): CollectorConfiguration {
    const recordedPriceRangeRatio = readPositiveNumber('RECORDED_PRICE_RANGE_RATIO', 0.02);
    const retainedPriceRangeRatio = readPositiveNumber('RETAINED_PRICE_RANGE_RATIO', 0.10);

    if (retainedPriceRangeRatio < recordedPriceRangeRatio) {
        throw new ConfigurationError(
            'RETAINED_PRICE_RANGE_RATIO must be at least RECORDED_PRICE_RANGE_RATIO, '
            + 'otherwise the book is pruned inside the range being recorded',
        );
    }

    return {
        instrumentSymbol: (process.env['INSTRUMENT_SYMBOL'] ?? 'BTCUSDT').toUpperCase(),
        priceBucketSize: readPositiveNumber('PRICE_BUCKET_SIZE', 10),
        frameIntervalMs: readPositiveNumber('FRAME_INTERVAL_MS', 1_000),
        recordedPriceRangeRatio,
        retainedPriceRangeRatio,
        deepRepairIntervalMs: readPositiveNumber('DEEP_REPAIR_INTERVAL_MS', 300_000),
        databaseUrl: readRequiredText('DATABASE_URL'),
    };
}

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
     *
     * Roughly ten minutes at the default grid. Past this the oldest are dropped
     * and the loss is recorded as a gap, which beats an unbounded heap.
     */
    maximumBufferedFrames: 600,
    maximumBufferedTradeClusters: 20_000,
} as const;

function readRequiredText(variableName: string): string {
    const rawValue = process.env[variableName];
    if (rawValue === undefined || rawValue.trim() === '') {
        throw new ConfigurationError(`Missing required environment variable: ${variableName}`);
    }
    return rawValue.trim();
}

function readPositiveNumber(variableName: string, fallbackValue: number): number {
    const rawValue = process.env[variableName];
    if (rawValue === undefined || rawValue.trim() === '') {
        return fallbackValue;
    }
    const parsedValue = Number(rawValue);
    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
        throw new ConfigurationError(`Environment variable ${variableName} must be a positive number`);
    }
    return parsedValue;
}
