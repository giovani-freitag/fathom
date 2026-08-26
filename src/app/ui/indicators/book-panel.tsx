import type { ReactElement } from 'react';
import type { ChartState } from '../../core/chart-controller.ts';
import { formatDuration, formatFixed } from '../../core/formatting.ts';
import { RecordingPanel } from '../recording-panel.tsx';
import { resolveRecordedSpanMs } from '../../core/viewport-policy.ts';
import { useKernel } from '../../react/kernel-context.ts';
import { useTranslate } from '../../react/use-appearance.ts';

interface BookPanelProps {
    readonly state: ChartState;
}

/**
 * The book: what it is made of, and what is making it.
 *
 * How far back it goes, the grid it was written on, how much of it is loaded
 * and where it has holes. All of it answers one question — what am I looking
 * at — which is why it sits with the layer that draws it rather than in a
 * drawer of its own.
 *
 * The recording is here because it is the same thing seen from the other end —
 * what is being captured is what this draws. It is safe here only because the
 * book cannot be taken off the list, just hidden: a control that went away with
 * its layer would be a collector nobody could stop.
 */
export function BookPanel({ state }: BookPanelProps): ReactElement {
    const kernel = useKernel();
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

            {kernel.recording === null ? null : (
                <div className="space-y-3 border-t border-hairline pt-3">
                    <RecordingPanel
                        recording={kernel.recording}
                        onContractsChanged={() => { void kernel.chart.refreshInstruments(); }}
                        translate={translate}
                    />
                    <p className="text-[11px] leading-relaxed text-ink-500">
                        {translate('settings.recordingIsGlobal')}
                    </p>
                    <p className="text-[11px] leading-relaxed text-ink-500">
                        {translate('settings.backfillNote')}
                    </p>
                </div>
            )}

        </div>
    );
}
