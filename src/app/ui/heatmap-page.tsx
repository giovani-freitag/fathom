import { RefreshCw, TriangleAlert } from 'lucide-react';
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { resolveRecordedSpanMs } from '../core/viewport-policy.ts';
import { useKernel } from '../react/kernel-context.ts';
import { useChartSlice } from '../react/use-chart-state.ts';
import { useTranslate } from '../react/use-appearance.ts';
import type { TranslationKey } from '../i18n/dictionaries/en.ts';
import type { Translate } from '../i18n/translator.ts';
import { ControlButton } from './control-button.tsx';
import type { AddedIndicator } from '../../shared/core/indicator-selection.ts';
import type { ChartState } from '../core/chart-controller.ts';
import { ChartSurface } from './chart-surface.tsx';
import type { InstrumentCoverage } from '../../shared/core/api-contract.ts';
import { ReturnToLive } from './return-to-live.tsx';
import { ChartAlert } from './chart-alert.tsx';
import { ChartHeader } from './chart-header.tsx';
import { useIsWideViewport } from '../react/use-viewport-width.ts';
import { formatDuration } from '../core/formatting.ts';
import { listDrawnOverlays } from '../indicators/layer-contributions.ts';
import { SettingsDrawer } from './settings-drawer.tsx';
import type { BarIntervalMs } from '../core/bar-interval.ts';
import { IndicatorOverlay } from './indicators/indicator-controls.tsx';
import { useIndicators } from '../react/use-indicators.ts';
import { useDrawings } from '../react/use-drawings.ts';
import { ChartDock } from './chart-dock.tsx';
import { DrawingActions } from './drawing-actions.tsx';

/** Enough to clear the time axis the renderer reserves along the bottom. */
const TIME_AXIS_CLEARANCE_PX = 32;

/* Declared once each, so every subscription is the same one on every render. */
const readPhase = (state: ChartState): ChartState['phase'] => state.phase;
const readFailureKey = (state: ChartState): TranslationKey | null => state.failureKey;
const readInstruments = (state: ChartState): readonly InstrumentCoverage[] => state.instruments;
const readInstrumentSymbol = (state: ChartState): string | null => state.instrumentSymbol;
const readAddedIndicators = (state: ChartState): readonly AddedIndicator[] => state.addedIndicators;
const readBarIntervalMs = (state: ChartState): BarIntervalMs | null => state.barIntervalMs;
const readBarWindowIntervalMs = (state: ChartState): number => state.dataset.bars.intervalMs;
const readIsFollowingLive = (state: ChartState): boolean => state.isFollowingLive;
const readVisibleSpanMs = (state: ChartState): number => state.viewport.toMs - state.viewport.fromMs;
const readIsDepthVisible = (state: ChartState): boolean => state.isDepthVisible;
const readSampleIntervalMs = (state: ChartState): number => state.dataset.sampleIntervalMs;

/**
 * The whole product: one chart, and just enough chrome to explain it.
 */
export function HeatmapPage(): ReactElement {
    const kernel = useKernel();
    // Sliced rather than read whole: a drag rewrites the viewport many times a
    // second, and a page that followed all of it rebuilt every control on the
    // screen for a figure none of them read.
    const phase = useChartSlice(readPhase);
    const failureKey = useChartSlice(readFailureKey);
    const instruments = useChartSlice(readInstruments);
    const instrumentSymbol = useChartSlice(readInstrumentSymbol);
    const addedIndicators = useChartSlice(readAddedIndicators);
    const barIntervalMs = useChartSlice(readBarIntervalMs);
    const barWindowIntervalMs = useChartSlice(readBarWindowIntervalMs);
    const isFollowingLive = useChartSlice(readIsFollowingLive);
    const visibleSpanMs = useChartSlice(readVisibleSpanMs);
    const isDepthVisible = useChartSlice(readIsDepthVisible);
    const sampleIntervalMs = useChartSlice(readSampleIntervalMs);
    const translate = useTranslate();
    const indicators = useIndicators();
    const drawings = useDrawings();
    const surfaceRef = useRef<HTMLElement>(null);
    const isWide = useIsWideViewport();
    // The drawer is where a layer is configured, so a row on the chart has to be
    // able to open it onto itself rather than carrying a panel of its own.
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);


    // Started, never torn down: the chart outlives this page. Whoever built the
    // container owns its lifetime, and a page that disposed it would leave a
    // dead controller behind for the next mount to draw nothing from.
    useEffect(() => {
        void kernel.chart.initialize();
    }, [kernel]);

    const handleInstrumentSelect = useCallback((symbol: string) => {
        kernel.chart.selectInstrument(symbol);
    }, [kernel]);

    const handleIntervalSelect = useCallback((intervalMs: BarIntervalMs | null) => {
        kernel.chart.selectBarInterval(intervalMs);
    }, [kernel]);

    const handleSpanSelect = useCallback((spanMs: number) => {
        const nowMs = Date.now();
        kernel.chart.applyView({
            viewport: { ...kernel.chart.store.read().viewport, fromMs: nowMs - spanMs, toMs: nowMs },
            surfaceWidthPx: window.innerWidth,
            isFollowingLive: true,
        });
    }, [kernel]);

    const handleReturnToLive = useCallback(() => {
        const { viewport } = kernel.chart.store.read();
        handleSpanSelect(viewport.toMs - viewport.fromMs);
    }, [handleSpanSelect, kernel]);

    const recordedSpanMs = resolveRecordedSpanMs(instruments, instrumentSymbol);
    // How wide a drawn column of the book is. A chart with no book has no answer
    // to that rather than an answer of nought.
    const columnSummary = isDepthVisible
        ? `${formatDuration(sampleIntervalMs, translate)}${translate('coverage.perColumn')}`
        : null;
    // The grid the contract is recorded on, not the one this window happens to
    // be sampled at: sampling coarsens as the view widens, and the rungs a
    // reader may pick must not come and go with the zoom.
    const recordedIntervalMs = instruments.find(
        (instrument) => instrument.instrumentSymbol === instrumentSymbol,
    )?.frameIntervalMs ?? 1_000;

    const chartControls = {
        indicators,
        instruments,
        instrumentSymbol,
        onInstrumentSelect: handleInstrumentSelect,
        time: {
            visibleSpanMs,
            recordedSpanMs,
            onSpanSelect: handleSpanSelect,
            barIntervalMs,
            effectiveIntervalMs: barWindowIntervalMs,
            frameIntervalMs: recordedIntervalMs,
            onIntervalSelect: handleIntervalSelect,
            ...columnSummary === null ? {} : { columnSummary },
        },
    };
    const settings = (
        <SettingsDrawer
            isFloating={!isWide}
            isOpen={isDrawerOpen}
            onOpenChange={setIsDrawerOpen}
        />
    );

    return (
        <div className="flex h-dvh flex-col bg-abyss-900 pt-[env(safe-area-inset-top)]">
            {isWide && <ChartHeader {...chartControls} drawings={drawings} settings={settings} />}
            <main ref={surfaceRef} className="relative min-h-0 flex-1">
                <ChartSurface />

                {/* The one thing the chart has to say for itself, and only when
                    it has one. Everything the strip up here used to report is
                    either drawn on the chart or answered by a control. */}
                <ChartAlert />

                {/* The way into everything a reader can change, and whatever
                    the layers on the chart put over it. The page mounts those
                    without knowing which layer any of them is. */}
                <div className="pointer-events-none absolute left-3 top-3 flex items-start gap-2">
                    {!isWide && settings}

                    {listDrawnOverlays(addedIndicators).map(({ instanceId, Overlay }) => (
                        <Overlay key={instanceId} />
                    ))}
                </div>


                <IndicatorOverlay controls={indicators} />

                {/* An island rather than a bar of its own: drawing is done in
                    bursts, and a full row of chrome for it costs the chart its
                    height for as long as the page is open. What can be changed
                    about the selected mark stacks directly above it.

                    Clear of the time axis, whose labels are read while a mark is
                    being placed and would otherwise sit under the island. */}
                <div
                    className="pointer-events-none absolute inset-x-0 flex flex-col items-center gap-2 px-2"
                    style={{ bottom: TIME_AXIS_CLEARANCE_PX }}
                >
                    {/* Right-aligned above the islands, which on a phone are
                        as wide as the screen: anywhere beside them collides. */}
                    {!isFollowingLive && (
                        <div className="flex w-full justify-end">
                            <ReturnToLive onReturn={handleReturnToLive} />
                        </div>
                    )}

                    <DrawingActions controls={drawings} />
                    {!isWide && <ChartDock
                        {...chartControls}
                        drawings={drawings}
                    />}
                </div>


                {phase === 'initialising' && <SurfaceNotice message={translate('page.probing')} translate={translate} />}
                {phase === 'empty' && (
                    <SurfaceNotice
                        message={translate('page.empty')}
                        tone="warning"
                        translate={translate}
                    />
                )}
                {phase === 'failed' && (
                    <SurfaceNotice
                        message={translate(failureKey ?? 'failure.silent')}
                        tone="warning"
                        translate={translate}
                        onRetry={() => { void kernel.chart.initialize(); }}
                    />
                )}
            </main>

            <div className="shrink-0 pb-[env(safe-area-inset-bottom)]" />
        </div>
    );
}

interface SurfaceNoticeProps {
    readonly message: string;
    readonly translate: Translate;
    readonly tone?: 'neutral' | 'warning';
    readonly onRetry?: () => void;
}

function SurfaceNotice({ message, translate, tone = 'neutral', onRetry }: SurfaceNoticeProps): ReactElement {
    return (
        <div className="absolute inset-0 grid place-items-center bg-abyss-950/80 px-6 backdrop-blur-sm">
            <div className="max-w-sm space-y-3 text-center">
                {tone === 'warning' && <TriangleAlert className="mx-auto size-6 text-amber" />}
                <p className="text-sm leading-relaxed text-ink-300">{message}</p>
                {onRetry !== undefined && (
                    <ControlButton onClick={onRetry} className="mx-auto">
                        <RefreshCw className="size-4" />
                        {translate('page.retry')}
                    </ControlButton>
                )}
            </div>
        </div>
    );
}
