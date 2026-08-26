import type { ReactElement } from 'react';
import type { ChartState } from '../../core/chart-controller.ts';
import { formatDuration, formatFixed } from '../../core/formatting.ts';
import { resolveRecordedSpanMs } from '../../core/viewport-policy.ts';
import { useTranslate } from '../../react/use-appearance.ts';

interface BookPanelProps {
    readonly state: ChartState;
}

/**
 * What the book being drawn is made of.
 *
 * How far back it goes, the grid it was written on, how much of it is loaded
 * and where it has holes. All of it answers one question — what am I looking
 * at — which is why it sits with the layer that draws it rather than in a
 * drawer of its own.
 *
 * What is deliberately not here is the recording. That belongs to the machine
 * and outlives any layer: put here, taking the book off the chart would take
 * the only control over a collector that keeps writing to disk.
 */
export function BookPanel({ state }: BookPanelProps): ReactElement {
    const translate = useTranslate();

    return (
        <div className="space-y-3 border-t border-hairline pt-3">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                <dt className="text-ink-500">{translate('settings.recordedSoFar')}</dt>
                <dd className="numeric text-right text-ink-100">
                    {formatDuration(resolveRecordedSpanMs(state.instruments, state.instrumentSymbol), translate)}
                </dd>
                <dt className="text-ink-500">{translate('settings.resolution')}</dt>
                <dd className="numeric text-right text-ink-300">
                    {translate('settings.perColumn', { value: formatDuration(state.dataset.sampleIntervalMs, translate) })}
                </dd>
                <dt className="text-ink-500">{translate('settings.priceBand')}</dt>
                <dd className="numeric text-right text-ink-300">
                    {translate('settings.perRow', { value: state.dataset.priceBucketSize })}
                </dd>
                <dt className="text-ink-500">{translate('settings.columnsLoaded')}</dt>
                <dd className="numeric text-right text-ink-300">{formatFixed(state.dataset.frames.length, 0)}</dd>
                <dt className="text-ink-500">{translate('settings.gapsInWindow')}</dt>
                <dd className="numeric text-right text-ink-300">{formatFixed(state.dataset.gaps.length, 0)}</dd>
            </dl>

        </div>
    );
}
