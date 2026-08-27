import type { HeatmapSource } from '../../shared/core/heatmap-source.ts';
import { VenueBarSource } from '../services/venue-bar-source.ts';
import { VenueCandleService } from '../services/venue-candle-service.ts';

/**
 * Where the venue's REST surface is served from.
 *
 * The same origin the collector takes its book snapshots from. Named here as
 * well because the chart reaches it directly: a candle is public history, and
 * routing it through a gateway would mean the browser-only build could not have
 * one at all.
 */
const VENUE_REST_BASE_URL = 'https://fapi.binance.com';

/**
 * The archive, with the venue's candles in front of it.
 *
 * Wired here rather than inside either source, because which questions a venue
 * can answer is a property of the product and not of where this recording
 * happens to be kept.
 *
 * @param archive - Whatever holds the recording, on a server or in the browser.
 * @returns A source answering candles from the venue and the rest from the archive.
 */
export function wrapWithVenueCandles(archive: HeatmapSource): HeatmapSource {
    return new VenueBarSource({
        archive,
        candles: new VenueCandleService({
            restApiBaseUrl: VENUE_REST_BASE_URL,
            fetch: (input, init) => globalThis.fetch(input, init),
            readNowMs: () => Date.now(),
        }),
    });
}
