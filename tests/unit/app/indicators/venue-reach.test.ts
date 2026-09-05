import { describe, expect, it } from 'vitest';
import { findUnreachable, openingSettings } from '../../../../src/app/indicators/venue-reach.ts';
import type { VenueFact } from '../../../../src/shared/core/venue-plan.ts';

const EVERYTHING = new Set<VenueFact>(['book', 'wholeBook', 'tape', 'volume', 'takerSplit', 'tradeCount']);
const NO_SIDES = new Set<VenueFact>(['book', 'tape', 'volume']);

const SIDED = {
    parameters: [],
    resolveSources: () => ({ needs: ['takerSplit'] as const }),
};

describe('what a layer asked of a venue that cannot answer it', () => {
    it('is nothing for a layer the venue answers whole', () => {
        expect(findUnreachable(SIDED, {}, EVERYTHING)).toEqual([]);
    });

    it('names the fact a venue does not publish', () => {
        expect(findUnreachable(SIDED, {}, NO_SIDES)).toEqual(['takerSplit']);
    });

    it('is nothing for a layer that declares nothing', () => {
        // Most layers read the bars and nothing else, and asking them to say so
        // would be a line in every file to state the ordinary case.
        expect(findUnreachable({ parameters: [] }, {}, NO_SIDES)).toEqual([]);
    });

    it('judges a layer on the knob it was tuned to, not on the one it opens with', () => {
        // Volume reads a size whole and a split by sides, so the same layer is
        // within reach in one mode and out of it in the other.
        const byMode = {
            parameters: [],
            resolveSources: (settings: Record<string, unknown>) => ({
                needs: settings['mode'] === 'sides' ? (['takerSplit'] as const) : (['volume'] as const),
            }),
        };

        expect(findUnreachable(byMode, { mode: 'total' }, NO_SIDES)).toEqual([]);
        expect(findUnreachable(byMode, { mode: 'sides' }, NO_SIDES)).toEqual(['takerSplit']);
    });
});

describe('the settings a layer is judged on before anybody tunes it', () => {
    it('is what each knob opens with', () => {
        const tunable = {
            parameters: [
                { name: 'mode', kind: 'choice' as const, defaultValue: 'total', choices: ['total', 'sides'] },
                { name: 'periodBars', kind: 'integer' as const, defaultValue: 20, minimum: 2, maximum: 90 },
            ],
        };

        expect(openingSettings(tunable)).toEqual({ mode: 'total', periodBars: 20 });
    });
});
