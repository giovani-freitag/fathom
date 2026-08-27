import type { TranslationKey } from '../i18n/dictionaries/en.ts';

export interface SpanPreset {
    readonly labelKey: TranslationKey;
    readonly spanMs: number;
}

/**
 * The time windows the chart offers, from a single sweep to a full week.
 */
export const SPAN_PRESETS: readonly SpanPreset[] = [
    { labelKey: 'span.1m', spanMs: 60_000 },
    { labelKey: 'span.5m', spanMs: 300_000 },
    { labelKey: 'span.15m', spanMs: 900_000 },
    { labelKey: 'span.1h', spanMs: 3_600_000 },
    { labelKey: 'span.4h', spanMs: 14_400_000 },
    { labelKey: 'span.1d', spanMs: 86_400_000 },
    { labelKey: 'span.3d', spanMs: 259_200_000 },
    { labelKey: 'span.1w', spanMs: 604_800_000 },
];

/**
 * How far a span may be from a preset and still be counted as it.
 *
 * A reader who pressed an hour and then nudged the view is still looking at an
 * hour, and a row that let go of its mark at the first drag would say nothing
 * about where they are.
 */
const SPAN_MATCH_TOLERANCE = 0.12;

/**
 * Whether a span on screen is the one a preset offers.
 *
 * @param activeSpanMs - What is on screen.
 * @param presetSpanMs - What the preset would set.
 * @returns True when the two are near enough to be the same answer.
 */
export function matchesSpan(activeSpanMs: number, presetSpanMs: number): boolean {
    return Math.abs(activeSpanMs - presetSpanMs) < presetSpanMs * SPAN_MATCH_TOLERANCE;
}
