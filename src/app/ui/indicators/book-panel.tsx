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
 * What the book is made of, and what is making it.
 *
 * Everything here describes one thing: how far back the recording goes, the
 * grid it was written on, where it has holes, and which contracts are still
 * being written. They were spread between a drawer and a chart, and they are
 * all the same answer to what the depth map is showing.
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
                <RecordingPanel
                    recording={kernel.recording}
                    onContractsChanged={() => { void kernel.chart.refreshInstruments(); }}
                    translate={translate}
                />
            )}

            {/*
                Recording is the machine's, not this chart's. Taking the book off
                the chart stops drawing it and nothing else — and it matters that
                nobody reads it the other way, because a book that stopped being
                recorded cannot be recovered afterwards.
            */}
            <p className="text-[11px] leading-relaxed text-ink-500">
                {translate('settings.recordingIsGlobal')}
            </p>
            <p className="text-[11px] leading-relaxed text-ink-500">
                {translate('settings.backfillNote')}
            </p>
        </div>
    );
}
