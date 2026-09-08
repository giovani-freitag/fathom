import type { CollectorConfiguration } from '../core/collector-configuration.ts';
import { FIRST_VENUE } from '../../shared/core/recording-control.ts';

/**
 * What a first visit records, and what else may be switched on beside it.
 *
 * A seed and an offer, not a list of everything a page may hold: a reader
 * adds whatever the venue lists, and deleting one of these stops it being
 * offered again.
 */
export const DEMO_CATALOGUE = [
    { venue: FIRST_VENUE, instrumentSymbol: 'BTCUSDT', priceBucketSize: 10, frameIntervalMs: 1_000, isEnabled: true },
    { venue: FIRST_VENUE, instrumentSymbol: 'ETHUSDT', priceBucketSize: 0.5, frameIntervalMs: 1_000, isEnabled: false },
    { venue: FIRST_VENUE, instrumentSymbol: 'SOLUSDT', priceBucketSize: 0.1, frameIntervalMs: 1_000, isEnabled: false },
    { venue: FIRST_VENUE, instrumentSymbol: 'LTCUSDT', priceBucketSize: 0.05, frameIntervalMs: 1_000, isEnabled: false },
    { venue: FIRST_VENUE, instrumentSymbol: 'PAXGUSDT', priceBucketSize: 1, frameIntervalMs: 1_000, isEnabled: false },
] as const;

/** What a visitor sees unless the link says otherwise. */
const DEMO_DEFAULTS = {
    instrumentSymbol: 'BTCUSDT',
    venue: FIRST_VENUE,
    priceBucketSize: 10,
    frameIntervalMs: 1_000,
    recordedPriceRangeRatio: 0.02,
    retainedPriceRangeRatio: 0.10,
    deepRepairIntervalMs: 300_000,
} as const;

/**
 * Reads the demo's settings, letting a link override the contract.
 *
 * @param search - The worker location's query string.
 * @returns The configuration the runtime is built with.
 */
export function readDemoConfiguration(search: string): CollectorConfiguration {
    const parameters = new URLSearchParams(search);
    const symbol = parameters.get('symbol')?.toUpperCase();
    const bucketSize = Number(parameters.get('bucket'));

    return {
        ...DEMO_DEFAULTS,
        instrumentSymbol: symbol !== undefined && symbol !== '' ? symbol : DEMO_DEFAULTS.instrumentSymbol,
        priceBucketSize: Number.isFinite(bucketSize) && bucketSize > 0
            ? bucketSize
            : DEMO_DEFAULTS.priceBucketSize,
    };
}
