import type { Translate } from '../i18n/translator.ts';
import type { VenueFact } from '../../shared/core/venue-plan.ts';

/**
 * A shortfall said in the reader's own words.
 *
 * The facts are named rather than counted, because "needs one thing this venue
 * lacks" tells a reader nothing about whether another venue would do.
 *
 * @param translate - The reader's dictionary.
 * @param missing - What the layer asked for and did not get.
 * @returns One sentence, or null where nothing is missing.
 */
export function sayUnreachable(translate: Translate, missing: readonly VenueFact[]): string | null {
    if (missing.length === 0) {
        return null;
    }

    const facts = missing.map((fact) => translate(`venue.fact.${fact}`));
    return translate('indicators.outOfReach', { facts: facts.join(', ') });
}
