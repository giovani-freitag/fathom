import type { CollectorConfiguration } from '../core/collector-configuration.ts';

/** Whatever exposes a storage estimate: a window's navigator or a worker's. */
export interface StorageOwner {
    readonly storage?: { estimate(): Promise<StorageEstimate> };
}

/** What a visitor sees unless the link says otherwise. */
const DEMO_DEFAULTS = {
    instrumentSymbol: 'BTCUSDT',
    priceBucketSize: 10,
    frameIntervalMs: 1_000,
    recordedPriceRangeRatio: 0.02,
    retainedPriceRangeRatio: 0.10,
    deepRepairIntervalMs: 300_000,
} as const;

/** Share of the device's quota the demo is willing to fill. */
const QUOTA_SHARE = 0.25;

/** Bytes one frame costs in the store, measured on a 325-bucket ladder. */
const BYTES_PER_FRAME = 1_300;

/** Kept even when the quota is unknown, so a page always records something. */
const FALLBACK_FRAME_CAPACITY = 7_200;

/** No window is worth more than a week; beyond that the demo is a recorder. */
const MAXIMUM_FRAME_CAPACITY = 604_800;

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

/**
 * How many frames this device is willing to hold.
 *
 * Derived from the quota rather than fixed in time, because the same span costs
 * several times the bytes with a wider recorded band or a second contract, and
 * bytes are what the device actually limits.
 *
 * @param agent - The navigator whose storage is being asked about.
 * @returns The capacity, floored so a page always records something.
 */
export async function resolveFrameCapacity(agent: StorageOwner): Promise<number> {
    const quotaBytes = await readQuotaBytes(agent);
    if (quotaBytes === null) {
        return FALLBACK_FRAME_CAPACITY;
    }

    const affordable = Math.floor((quotaBytes * QUOTA_SHARE) / BYTES_PER_FRAME);
    return Math.min(MAXIMUM_FRAME_CAPACITY, Math.max(FALLBACK_FRAME_CAPACITY, affordable));
}

async function readQuotaBytes(agent: StorageOwner): Promise<number | null> {
    try {
        const estimate = await agent.storage?.estimate();
        if (estimate === undefined) {
            return null;
        }
        return estimate.quota ?? null;
    } catch {
        return null;
    }
}
