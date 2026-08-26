import { BAR_INTERVALS_MS, type BarIntervalMs } from '../core/bar-interval.ts';
import { formatDuration } from '../core/formatting.ts';
import type { ReactElement } from 'react';
import { useTranslate } from '../react/use-appearance.ts';

/** The value the select carries while the window is deciding for itself. */
const AUTOMATIC = 'auto';

interface IntervalPickerProps {
    /** The rung the reader named, or null while the window decides. */
    readonly chosen: BarIntervalMs | null;
    /** The rung actually being drawn, which is what auto resolved to. */
    readonly effectiveMs: number;
    /** Nothing finer than this was recorded, so nothing finer is offered. */
    readonly frameIntervalMs: number;
    readonly onSelect: (intervalMs: BarIntervalMs | null) => void;
}

/**
 * How long one bar covers.
 *
 * Auto by default, because the span presets already put a sensible number of
 * bars on the screen and most readers never want to think about it. Naming a
 * rung pins it: zooming then changes how many bars are seen rather than how
 * much each one covers, which is what a reader comparing two windows means.
 */
export function IntervalPicker({
    chosen,
    effectiveMs,
    frameIntervalMs,
    onSelect,
}: IntervalPickerProps): ReactElement {
    const translate = useTranslate();
    const offered = BAR_INTERVALS_MS.filter((rung) => rung >= Math.max(1, frameIntervalMs));

    return (
        <label className="flex items-center gap-1.5">
            <span className="sr-only">{translate('interval.label')}</span>
            <select
                value={chosen === null ? AUTOMATIC : String(chosen)}
                onChange={(event) => {
                    const { value } = event.target;
                    onSelect(value === AUTOMATIC ? null : (Number(value) as BarIntervalMs));
                }}
                title={translate('interval.label')}
                className="rounded border border-hairline bg-abyss-900 px-2 py-1 text-xs tabular-nums text-ink-100 hover:border-hairline-bright focus:outline-none"
            >
                <option value={AUTOMATIC}>
                    {translate('interval.auto', { interval: formatDuration(effectiveMs, translate) })}
                </option>
                {offered.map((rung) => (
                    <option key={rung} value={rung}>{formatDuration(rung, translate)}</option>
                ))}
            </select>
        </label>
    );
}
