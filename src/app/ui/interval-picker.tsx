import { BAR_INTERVALS_MS, type BarIntervalMs } from '../core/bar-interval.ts';
import { formatDuration } from '../core/formatting.ts';
import { Select } from './select.tsx';
import { memo, type ReactElement } from 'react';
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
function IntervalPickerComponent({
    chosen,
    effectiveMs,
    frameIntervalMs,
    onSelect,
}: IntervalPickerProps): ReactElement {
    const translate = useTranslate();
    const offered = BAR_INTERVALS_MS.filter((rung) => rung >= Math.max(1, frameIntervalMs));

    return (
        <Select
            value={chosen === null ? AUTOMATIC : String(chosen)}
            label={translate('interval.label')}
            onSelect={(value) => {
                onSelect(value === AUTOMATIC ? null : (Number(value) as BarIntervalMs));
            }}
            choices={[
                {
                    value: AUTOMATIC,
                    label: translate('interval.auto', { interval: formatDuration(effectiveMs, translate) }),
                },
                ...offered.map((rung) => ({
                    value: String(rung),
                    label: formatDuration(rung, translate),
                })),
            ]}
        />
    );
}

/**
 * Re-rendered only when what it shows changes.
 *
 * A drag rewrites the viewport many times a second and the whole page follows
 * it; this reads none of that, and rebuilding its menu each time was the
 * costliest thing on the screen during a drag.
 */
export const IntervalPicker = memo(IntervalPickerComponent);
