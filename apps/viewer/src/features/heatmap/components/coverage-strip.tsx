import { formatDuration } from '@core/domain/formatting';
import type { ChartState } from '@core/modules/chart/chart-controller';
import { StatusDot, type StatusTone } from '@ui/primitives/status-dot';
import type { ReactElement } from 'react';

interface CoverageStripProps {
    readonly state: ChartState;
}

const LIVE_TONES: Record<ChartState['liveStatus'], StatusTone> = {
    streaming: 'live',
    connecting: 'pending',
    reconnecting: 'stale',
    idle: 'idle',
};

const LIVE_LABELS: Record<ChartState['liveStatus'], string> = {
    streaming: 'ao vivo',
    connecting: 'conectando',
    reconnecting: 'reconectando',
    idle: 'parado',
};

/**
 * What the chart is actually showing, and how trustworthy it is.
 *
 * The sampling interval and the gap count are here rather than hidden in a
 * settings panel because both change what the picture means: a wall that is
 * shorter than one sampled column may simply never have been recorded.
 */
export function CoverageStrip({ state }: CoverageStripProps): ReactElement {
    const visibleGapCount = state.dataset.gaps.length;

    return (
        <div className="flex items-center gap-3 text-[11px] text-ink-500">
            <span className="inline-flex items-center gap-1.5">
                <StatusDot tone={state.isFollowingLive ? LIVE_TONES[state.liveStatus] : 'idle'} />
                <span className={state.liveStatus === 'streaming' && state.isFollowingLive ? 'text-phosphor' : ''}>
                    {state.isFollowingLive ? LIVE_LABELS[state.liveStatus] : 'histórico'}
                </span>
            </span>

            <span className="numeric" title="Largura de cada coluna do gráfico">
                {formatDuration(state.dataset.sampleIntervalMs)}/col
            </span>

            {visibleGapCount > 0 && (
                <span className="numeric text-amber" title="Períodos sem gravação nesta janela">
                    {visibleGapCount} {visibleGapCount === 1 ? 'lacuna' : 'lacunas'}
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
