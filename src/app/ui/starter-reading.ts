import { ENTRY_FILE, type ReadingFiles } from '../../shared/core/reading-files.ts';

const STARTER_MAIN = `// This is yours to change. It is already running, and every edit redraws the
// chart beside it. Nothing here leaves this browser.
import { Params, Plot, readSetting } from 'fathom';
import type { Indicator, IndicatorInput, IndicatorSettings, PlanDraft, SourceRequest } from 'fathom';

const PERIOD = Params.integer('periodBars')
    .called('Period')
    .between(2, 400)
    .startingAt(20);

export default class MyMean implements Indicator {
    // What the chart calls it, in the legend and in the layer list.
    readonly label = 'My mean';
    readonly about = 'The mean of the close, written in the page';
    readonly parameters = [PERIOD];

    // Everything besides the drawn bars this reads, for the chart to fetch.
    resolveSources(settings: IndicatorSettings): SourceRequest {
        return { warmupBars: readSetting(settings, PERIOD) };
    }

    compute(input: IndicatorInput): PlanDraft {
        const bars = input.bars.bars;
        const periodBars = readSetting(input.settings, PERIOD);
        const value = bars.map((_bar, index) => {
            if (index < periodBars - 1) {
                // NaN breaks the line rather than drawing a mean of fewer bars
                // than the reader asked for.
                return Number.NaN;
            }
            let total = 0;
            for (let step = 0; step < periodBars; step += 1) {
                total += bars[index - step]!.closePrice;
            }
            return total / periodBars;
        });

        // The colour comes from the layer list, not from here.
        return Plot.over(input.bars)
            .line(value, 'My mean')
            .overThePrice();
    }
}
`;

/** What a reader with an empty shelf opens on: a whole, working reading. */
export const STARTER_FILES: ReadingFiles = { [ENTRY_FILE]: STARTER_MAIN };

const STARTER_CONNECTOR = `// A connector says what a venue can do and how to read what it answers. It
// never fetches anything itself: it describes a request, the engine performs it,
// and the connector reads what came back.
import { Connector } from 'fathom';
import type { VenueInstrument, VenueRequest } from 'fathom';

export default class MyVenue extends Connector {
    // Kept in here because nothing outside this class uses it.
    private static readonly REST = 'https://api.example.com';

    // What the venue can do. Every capability is either described or null —
    // writing null is how the chart is told to stop offering the readings that
    // would need it, and the methods behind it can then be left out entirely.
    readonly declaration = {
        book: null,
        tape: null,
        bars: null,
    };

    // Every venue lists what it trades; there is nothing to chart otherwise.
    planInstruments(): VenueRequest {
        return { url: MyVenue.REST + '/api/v1/symbols' };
    }

    readInstruments(payload: unknown): VenueInstrument[] {
        return this.requireList(payload, 'data').map((listing) => {
            const entry = listing as Record<string, unknown>;
            return {
                symbol: String(entry['symbol']),
                base: String(entry['baseCurrency']),
                quote: String(entry['quoteCurrency']),
                priceStep: this.readNumber(entry['priceIncrement']) ?? 0,
                // False for a listing that exists but is halted or not open.
                isTrading: entry['enableTrading'] === true,
            };
        });
    }

    // Once the listing works, describe a capability above and write its methods
    // here: planBars and readBars for candles, planStream, planSnapshot,
    // readSnapshot and readUpdate for a live book.
}
`;

/**
 * What a reader adding a venue opens on: the shape, with one half filled in.
 *
 * The listing rather than the book, because the listing is the half that can be
 * checked in a second — press save, and either the pairs appear or the venue
 * said why not.
 */
export const STARTER_CONNECTOR_FILES: ReadingFiles = { [ENTRY_FILE]: STARTER_CONNECTOR };
