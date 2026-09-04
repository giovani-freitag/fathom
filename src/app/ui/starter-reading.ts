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
