import { FLOATING_SURFACE_CLASSES } from './control-shell.ts';
import type { ChartState } from '../core/chart-controller.ts';
import { type ReactElement, useState } from 'react';
import { TriangleAlert, X } from 'lucide-react';
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
    // What was dismissed, not whether anything was. A reader who put one
    // failure away has not agreed to be told nothing about the next, and
    // holding the key rather than a flag is the whole of what that takes.
    const [dismissedKey, setDismissedKey] = useState<string | null>(null);

    if (failureKey === null || phase !== 'ready' || dismissedKey === failureKey) {
        return null;
    }

    return (
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-3">
            <span
                role="status"
                className={`${FLOATING_SURFACE_CLASSES} pointer-events-auto inline-flex max-w-full items-center gap-1.5 rounded-full py-1 pl-3 pr-1 text-[11px] text-ask shadow-lg`}
            >
                <TriangleAlert className="size-3 shrink-0" />
                <span className="truncate">{translate(failureKey)}</span>
                {/* A reader who has read it and cannot act on it should be able
                    to put it away. It clears itself on the next window that
                    loads, and a chart nobody is panning may not load one. */}
                <button
                    type="button"
                    aria-label={translate('alert.dismiss')}
                    title={translate('alert.dismiss')}
                    onClick={() => { setDismissedKey(failureKey); }}
                    className="grid size-5 shrink-0 place-items-center rounded-full text-ask/70 transition-colors hover:bg-ask/15 hover:text-ask"
                >
                    <X className="size-3" />
                </button>
            </span>
        </div>
    );
}
