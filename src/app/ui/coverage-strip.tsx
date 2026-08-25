import { formatDuration } from '../core/formatting.ts';
import type { ChartState } from '../core/chart-controller.ts';
import { StatusDot, type StatusTone } from './status-dot.tsx';
import type { ReactElement } from 'react';

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

const LIVE_LABELS: Record<ChartState['liveStatus'], string> = {
    streaming: 'live',
    connecting: 'connecting',
    reconnecting: 'reconnecting',
    refused: 'refused',
    idle: 'idle',
};

/**
 * What the chart is actually showing, and how trustworthy it is.
 */
export function CoverageStrip({ state }: CoverageStripProps): ReactElement {
    const visibleGapCount = state.dataset.gaps.length;

    return (
        <div className="flex items-center gap-3 text-[11px] text-ink-500">
            <span className="inline-flex items-center gap-1.5">
                <StatusDot tone={state.isFollowingLive ? LIVE_TONES[state.liveStatus] : 'idle'} />
                <span className={state.liveStatus === 'streaming' && state.isFollowingLive ? 'text-phosphor' : ''}>
                    {state.isFollowingLive ? LIVE_LABELS[state.liveStatus] : 'history'}
                </span>
            </span>

            <span className="numeric" title="Width of each chart column">
                {formatDuration(state.dataset.sampleIntervalMs)}/col
            </span>

            {visibleGapCount > 0 && (
                <span className="numeric text-amber" title="Stretches with no recording in this window">
                    {visibleGapCount} {visibleGapCount === 1 ? 'gap' : 'gaps'}
                </span>
            )}

            {state.isLoadingWindow && <span className="text-ink-700">carregando…</span>}

            {state.errorMessage !== null && state.phase === 'ready' && (
                <span className="truncate text-ask" title={state.errorMessage}>
                    {state.errorMessage}
                </span>
            )}
        </div>
    );
}
