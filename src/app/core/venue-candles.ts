import type { ArchiveSource, HeatmapSource } from '../../shared/core/heatmap-source.ts';
import { BINANCE_CONNECTOR } from '../../shared/venues/binance-connector.ts';
import { VenueBarSource } from '../services/venue-bar-source.ts';
import { VenueCandleService } from '../services/venue-candle-service.ts';
import { VenueGateway } from '../../shared/venues/venue-gateway.ts';

/**
 * The archive, with the venue's candles in front of it.
 *
 * Wired here rather than inside either source, because which questions a venue
 * can answer is a property of the product and not of where this recording
 * happens to be kept.
 *
 * The chart reaches the venue directly rather than through the server: a candle
 * is public history, and routing it through a gateway would mean the
 * browser-only build could not have one at all.
 *
 * @param archive - Whatever holds the recording, on a server or in the browser.
 * @returns A source answering candles from the venue and the rest from the archive.
 */
export function wrapWithVenueCandles(archive: ArchiveSource): HeatmapSource {
    return new VenueBarSource({
        archive,
        candles: new VenueCandleService({
            connector: BINANCE_CONNECTOR,
            gateway: new VenueGateway({ fetch: (input, init) => globalThis.fetch(input, init) }),
            readNowMs: () => Date.now(),
        }),
    });
}
