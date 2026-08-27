import type { Translate } from '../../i18n/translator.ts';
import { PanelSection } from '../../ui/panel-section.tsx';
import type { ReactElement, ReactNode } from 'react';
import type { ChartState } from '../../core/chart-controller.ts';
import { formatDuration, formatFixed } from '../../core/formatting.ts';
import { RecordingPanel } from './recording-panel.tsx';
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
    const translate = useTranslate();

    return (
        <>
            <PanelSection
                title={translate('settings.drawn')}
                {...(state.instrumentSymbol === null ? {} : { summary: state.instrumentSymbol })}
            >
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                    <Stat isLead term={translate('settings.recordedSoFar')}>
                        {formatDuration(resolveRecordedSpanMs(state.instruments, state.instrumentSymbol), translate)}
                    </Stat>
                    <Stat term={translate('settings.resolution')}>
                        {translate('settings.perColumn', { value: formatDuration(state.dataset.sampleIntervalMs, translate) })}
                    </Stat>
                    <Stat term={translate('settings.priceBand')}>
                        {translate('settings.perRow', { value: state.dataset.priceBucketSize })}
                    </Stat>
                    <Stat term={translate('settings.columnsLoaded')}>
                        {formatFixed(state.dataset.frames.length, 0)}
                    </Stat>
                    <Stat term={translate('settings.gapsInWindow')}>
                        {formatFixed(state.dataset.gaps.length, 0)}
                    </Stat>
                </dl>
            </PanelSection>

            <RecordingSection translate={translate} />
        </>
    );
}

/**
 * The collector, beside the readings it feeds.
 */
function RecordingSection({ translate }: { readonly translate: Translate }): ReactElement | null {
    const kernel = useKernel();
    if (kernel.recording === null) {
        return null;
    }

    return (
        <RecordingPanel
            recording={kernel.recording}
            onContractsChanged={() => { void kernel.chart.refreshInstruments(); }}
            translate={translate}
        />
    );
}

interface StatProps {
    readonly term: string;
    readonly children: ReactNode;
    /** The one figure the panel is really about, given the brighter ink. */
    readonly isLead?: boolean;
}

/**
 * One reading of the recording, named on the left and given on the right.
 */
function Stat({ term, children, isLead }: StatProps): ReactElement {
    return (
        <>
            <dt className="text-ink-500">{term}</dt>
            <dd className={`numeric text-right ${isLead === true ? 'text-ink-100' : 'text-ink-300'}`}>
                {children}
            </dd>
        </>
    );
}
