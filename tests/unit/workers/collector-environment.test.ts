import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    readCollectorConfiguration,
    readDatabaseUrl,
    readLogFilePath,
} from '../../../src/workers/collector-environment.ts';
import { ConfigurationError } from '../../../src/workers/core/collector-configuration.ts';

/** Every variable the collector reads, so a host's own settings cannot leak in. */
const COLLECTOR_VARIABLES = [
    'INSTRUMENT_SYMBOL',
    'PRICE_BUCKET_SIZE',
    'FRAME_INTERVAL_MS',
    'RECORDED_PRICE_RANGE_RATIO',
    'RETAINED_PRICE_RANGE_RATIO',
    'DEEP_REPAIR_INTERVAL_MS',
    'DATABASE_URL',
    'COLLECTOR_LOG_PATH',
];

describe('readCollectorConfiguration', () => {
    beforeEach(() => {
        COLLECTOR_VARIABLES.forEach((name) => { vi.stubEnv(name, ''); });
    });

    afterEach(() => { vi.unstubAllEnvs(); });

    it('runs on defaults when the environment says nothing', () => {
        const configuration = readCollectorConfiguration();

        expect(configuration).toEqual({
            instrumentSymbol: 'BTCUSDT',
            priceBucketSize: 10,
            frameIntervalMs: 1_000,
            recordedPriceRangeRatio: 0.02,
            retainedPriceRangeRatio: 0.10,
            deepRepairIntervalMs: 300_000,
        });
    });

    it('reads a symbol the way the venue writes it', () => {
        vi.stubEnv('INSTRUMENT_SYMBOL', 'ethusdt');

        const configuration = readCollectorConfiguration();

        expect(configuration.instrumentSymbol).toBe('ETHUSDT');
    });

    it('takes the values the environment does set', () => {
        vi.stubEnv('PRICE_BUCKET_SIZE', '5');
        vi.stubEnv('FRAME_INTERVAL_MS', '250');

        const configuration = readCollectorConfiguration();

        expect(configuration).toMatchObject({ priceBucketSize: 5, frameIntervalMs: 250 });
    });

    it('refuses to keep less of the book than it records', () => {
        // Pruned inside the recorded range, the edges of every frame are written
        // as empty, and nothing downstream can tell that from an empty book.
        vi.stubEnv('RECORDED_PRICE_RANGE_RATIO', '0.2');
        vi.stubEnv('RETAINED_PRICE_RANGE_RATIO', '0.1');

        expect(() => readCollectorConfiguration()).toThrow(ConfigurationError);
    });

    it('accepts keeping exactly as much of the book as it records', () => {
        vi.stubEnv('RECORDED_PRICE_RANGE_RATIO', '0.1');
        vi.stubEnv('RETAINED_PRICE_RANGE_RATIO', '0.1');

        expect(() => readCollectorConfiguration()).not.toThrow();
    });

    it('refuses a value that is not a number', () => {
        vi.stubEnv('FRAME_INTERVAL_MS', 'one second');

        expect(() => readCollectorConfiguration()).toThrow(ConfigurationError);
    });

    it('refuses an interval of no time at all', () => {
        vi.stubEnv('FRAME_INTERVAL_MS', '0');

        expect(() => readCollectorConfiguration()).toThrow(ConfigurationError);
    });

    it('refuses a negative quantity', () => {
        vi.stubEnv('PRICE_BUCKET_SIZE', '-10');

        expect(() => readCollectorConfiguration()).toThrow(ConfigurationError);
    });
});

describe('readDatabaseUrl', () => {
    afterEach(() => { vi.unstubAllEnvs(); });

    it('reads the connection string the archive is opened with', () => {
        vi.stubEnv('DATABASE_URL', '  postgres://fathom@localhost/fathom  ');

        expect(readDatabaseUrl()).toBe('postgres://fathom@localhost/fathom');
    });

    it('refuses to start with nowhere to write', () => {
        vi.stubEnv('DATABASE_URL', '');

        expect(() => readDatabaseUrl()).toThrow(ConfigurationError);
    });
});

describe('readLogFilePath', () => {
    afterEach(() => { vi.unstubAllEnvs(); });

    it('writes beside the collector when the environment says nothing', () => {
        vi.stubEnv('COLLECTOR_LOG_PATH', '');

        expect(readLogFilePath()).toBe('logs/collector');
    });

    it('writes where the environment says', () => {
        vi.stubEnv('COLLECTOR_LOG_PATH', ' /var/log/fathom ');

        expect(readLogFilePath()).toBe('/var/log/fathom');
    });
});
