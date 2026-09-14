import type { CollectorConfiguration } from '../core/collector-configuration.ts';
import { FIRST_VENUE } from '../../shared/core/recording-control.ts';

/**
 * What a first visit is offered, which is nothing.
 *
 * The five Binance pairs that used to sit here offered nothing the picker does
 * not — it lists the whole venue, and a pair's price grid is worked out from
 * its own tick. One of them was switched on, so every first load recorded it.
 * The shape stays because a link that names a contract still builds one.
 */
export const DEMO_CATALOGUE: readonly {
    readonly venue: string;
    readonly instrumentSymbol: string;
    readonly priceBucketSize: number;
    readonly frameIntervalMs: number;
    readonly isEnabled: boolean;
}[] = [];

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
 * The contract a link asked for, when one did.
 *
 * Told apart from the build's fallback on purpose: a link naming a symbol is a
 * request to record it, and a default is not.
 *
 * @param search - The worker location's query string.
 * @returns The symbol asked for, upper-cased, or null when none was.
 */
export function requestedSymbolIn(search: string): string | null {
    const asked = new URLSearchParams(search).get('symbol')?.toUpperCase();

    return asked === undefined || asked === '' ? null : asked;
}

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
