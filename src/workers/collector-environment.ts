import {
    type CollectorConfiguration,
    ConfigurationError,
} from './core/collector-configuration.ts';
import { FIRST_VENUE } from '../shared/core/recording-control.ts';
import { isShippedVenue } from '../shared/venues/venue-registry.ts';

/** Where the dated log files go when the environment does not say. */
const DEFAULT_LOG_FILE_PATH = 'logs/collector';

/**
 * Reads what the collector records, and how much of the book it keeps.
 *
 * @returns The configuration, with a default for everything unset.
 * @throws ConfigurationError when a value is unusable or the two ranges disagree.
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
        instrumentSymbol: readText('INSTRUMENT_SYMBOL', 'BTCUSDT').toUpperCase(),
        venue: readVenue('VENUE', FIRST_VENUE),
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
    return readText('COLLECTOR_LOG_PATH', DEFAULT_LOG_FILE_PATH);
}

/**
 * The venue the seed contract is recorded from.
 *
 * Checked here rather than where the socket is opened, because an unknown name
 * fails deep inside a runtime that has already been started for it — and the
 * message a reader gets then names a connector rather than the setting that
 * asked for one.
 *
 * @param variableName - The variable to read.
 * @param fallbackValue - The venue an unset variable means.
 * @returns The venue, which some connector in this build reads.
 * @throws ConfigurationError when nothing in this build reads that venue.
 */
function readVenue(variableName: string, fallbackValue: string): string {
    const chosen = readText(variableName, fallbackValue);
    if (!isShippedVenue(chosen)) {
        throw new ConfigurationError(
            `${variableName} names “${chosen}”, which no connector in this build reads`,
        );
    }
    return chosen;
}

/**
 * Reads a variable that has something sensible to fall back on.
 *
 * @param variableName - The variable to read.
 * @param fallbackValue - What an unset or blank variable means.
 * @returns The configured text, trimmed, or the fallback.
 */
function readText(variableName: string, fallbackValue: string): string {
    // Blank reads as unset throughout: emptying a variable is how a `.env` says
    // it does not apply, and a collector recording under the empty symbol writes
    // history no query can find again.
    return process.env[variableName]?.trim() || fallbackValue;
}

/**
 * Reads a variable the collector cannot start without.
 *
 * @param variableName - The variable to read.
 * @returns Its value, trimmed.
 * @throws ConfigurationError when it is unset or blank.
 */
function readRequiredText(variableName: string): string {
    const rawValue = process.env[variableName];
    if (rawValue === undefined || rawValue.trim() === '') {
        throw new ConfigurationError(`Missing required environment variable: ${variableName}`);
    }
    return rawValue.trim();
}

/**
 * Reads a variable that must describe a positive quantity.
 *
 * @param variableName - The variable to read.
 * @param fallbackValue - What an unset or blank variable means.
 * @returns The configured number, or the fallback.
 * @throws ConfigurationError when the value is set but not a positive number.
 */
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
