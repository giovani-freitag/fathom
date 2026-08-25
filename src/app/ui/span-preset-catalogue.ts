export interface SpanPreset {
    readonly label: string;
    readonly spanMs: number;
}

/**
 * The time windows the chart offers, from a single sweep to a full week.
 */
export const SPAN_PRESETS: readonly SpanPreset[] = [
    { label: '1m', spanMs: 60_000 },
    { label: '5m', spanMs: 300_000 },
    { label: '15m', spanMs: 900_000 },
    { label: '1h', spanMs: 3_600_000 },
    { label: '4h', spanMs: 14_400_000 },
    { label: '1d', spanMs: 86_400_000 },
    { label: '3d', spanMs: 259_200_000 },
    { label: '1w', spanMs: 604_800_000 },
];
