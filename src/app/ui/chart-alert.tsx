import { FLOATING_SURFACE_CLASSES } from './control-shell.ts';
import type { ChartState } from '../core/chart-controller.ts';
import type { ReactElement } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useChartSlice } from '../react/use-chart-state.ts';
import { useTranslate } from '../react/use-appearance.ts';

/* Declared once each, so every subscription is the same one on every render. */
const readFailureKey = (state: ChartState): ChartState['failureKey'] => state.failureKey;
const readPhase = (state: ChartState): ChartState['phase'] => state.phase;

/**
 * The one thing the chart has to say for itself, and only when it has one.
 *
 * A refetch that failed while the window it already holds is still drawn: the
 * reader is looking at real data that has stopped being brought up to date, and
 * nothing else on the screen would tell them. Every other state — live, in
 * history, how wide a column is — is either visible in the chart itself or
 * answered by a control, so none of it earns a permanent strip.
 */
export function ChartAlert(): ReactElement | null {
    const failureKey = useChartSlice(readFailureKey);
    const phase = useChartSlice(readPhase);
    const translate = useTranslate();

    if (failureKey === null || phase !== 'ready') {
        return null;
    }

    return (
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-3">
            <span className={`${FLOATING_SURFACE_CLASSES} pointer-events-auto inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-3 py-1 text-[11px] text-ask shadow-lg`}>
                <TriangleAlert className="size-3 shrink-0" />
                {translate(failureKey)}
            </span>
        </div>
    );
}
