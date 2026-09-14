import type { CollectorConfiguration } from '../core/collector-configuration.ts';
import { FIRST_VENUE } from '../../shared/core/recording-control.ts';

/**
 * What a first visit is offered, which is nothing.
 *
 * There used to be five pairs here, on Binance futures, with Bitcoin switched
 * on — so every first load recorded Bitcoin whether or not anyone wanted it,
 * and opened an unasked-for connection to a venue that refuses whole countries.
 * From the United States that was an error message and a Try again that could
 * never work.
 *
 * Emptying it takes nothing away. A reader picks from everything the venue
 * lists, not from five names written here, and the price grid a pair records on
 * is worked out from its own tick and last trade by `offerGrids` — which is a
 * better answer than a number typed beside a symbol, and the only answer for
 * the several thousand pairs that were never in this list. What is left is the
 * shape, because a link that names a contract still builds one.
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
 * Told apart from the default on purpose. A shared link naming a symbol is a
 * request, and the recorder should honour it by switching that contract on; the
 * symbol the build falls back to is not a request, and treating the two alike
 * is what made every first visit record Bitcoin whether or not anyone wanted it.
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
