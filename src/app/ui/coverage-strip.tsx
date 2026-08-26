import { formatDuration } from '../core/formatting.ts';
import type { ChartState } from '../core/chart-controller.ts';
import { StatusDot, type StatusTone } from './status-dot.tsx';
import type { ReactElement } from 'react';
import type { TranslationKey } from '../i18n/dictionaries/en.ts';
import { useTranslate } from '../react/use-appearance.ts';

interface CoverageStripProps {
    readonly state: ChartState;
}

const LIVE_TONES: Record<ChartState['liveStatus'], StatusTone> = {
    streaming: 'live',
    connecting: 'pending',
    reconnecting: 'stale',
    refused: 'stale',
    idle: 'idle',
};

const LIVE_LABEL_KEYS: Record<ChartState['liveStatus'], TranslationKey> = {
    streaming: 'live.streaming',
    connecting: 'live.connecting',
    reconnecting: 'live.reconnecting',
    refused: 'live.refused',
    idle: 'live.idle',
};

/**
 * What the chart is actually showing, and how trustworthy it is.
 */
export function CoverageStrip({ state }: CoverageStripProps): ReactElement {
    const translate = useTranslate();
    const visibleGapCount = state.dataset.gaps.length;
    const failure = state.failureKey === null ? null : translate(state.failureKey);

    return (
        <div className="flex items-center gap-3 text-[11px] text-ink-500">
            <span className="inline-flex items-center gap-1.5">
                <StatusDot tone={state.isFollowingLive ? LIVE_TONES[state.liveStatus] : 'idle'} />
                <span className={state.liveStatus === 'streaming' && state.isFollowingLive ? 'text-phosphor' : ''}>
                    {state.isFollowingLive
                        ? translate(LIVE_LABEL_KEYS[state.liveStatus])
                        : translate('live.history')}
                </span>
            </span>

            <span className="numeric" title={translate('coverage.columnWidth')}>
                {formatDuration(state.dataset.sampleIntervalMs, translate)}{translate('coverage.perColumn')}
            </span>

            {/* The bar rung is its own resolution now: the depth field follows the
                surface, and a bar deliberately does not. */}
            <span className="numeric" title={translate('coverage.barInterval')}>
                {formatDuration(state.dataset.bars.intervalMs, translate)}
            </span>

            {visibleGapCount > 0 && (
                <span className="numeric text-amber" title={translate('coverage.gapTitle')}>
                    {translate(
                        visibleGapCount === 1 ? 'coverage.gapOne' : 'coverage.gapMany',
                        { count: visibleGapCount },
                    )}
                </span>
            )}

            {state.isLoadingWindow && <span className="text-ink-700">{translate('coverage.loading')}</span>}

            {failure !== null && state.phase === 'ready' && (
                <span className="truncate text-ask" title={failure}>{failure}</span>
            )}
        </div>
    );
}
