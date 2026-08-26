import {
    type CollectorConfiguration,
    ConfigurationError,
} from './core/collector-configuration.ts';

/** Where the dated log files go when the environment does not say. */
const DEFAULT_LOG_FILE_PATH = 'logs/collector';

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
    };
}


/**
 * The connection string the archive is opened with.
 *
 * @returns The connection string.
 * @throws ConfigurationError when it is missing.
 */
export function readDatabaseUrl(): string {
    return readRequiredText('DATABASE_URL');
}

/**
 * Where the dated log files are written.
 *
 * @returns The path a dated suffix is appended to.
 */
export function readLogFilePath(): string {
    return process.env['COLLECTOR_LOG_PATH']?.trim() || DEFAULT_LOG_FILE_PATH;
}

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
