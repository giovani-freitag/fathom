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
