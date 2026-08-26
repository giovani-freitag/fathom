import { RefreshCw, TriangleAlert } from 'lucide-react';
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { resolveRecordedSpanMs } from '../core/viewport-policy.ts';
import { useKernel } from '../react/kernel-context.ts';
import { useChartState } from '../react/use-chart-state.ts';
import { useTranslate } from '../react/use-appearance.ts';
import type { Translate } from '../i18n/translator.ts';
import { ControlButton } from './control-button.tsx';
import { ChartSurface } from './chart-surface.tsx';
import { ReturnToLive } from './return-to-live.tsx';
import { CoverageStrip } from './coverage-strip.tsx';
import { listDrawnOverlays } from '../indicators/layer-contributions.ts';
import { SettingsDrawer } from './settings-drawer.tsx';
import { InstrumentPicker } from './instrument-picker.tsx';
import { IntervalPicker } from './interval-picker.tsx';
import { SpanPresets } from './span-presets.tsx';
import { IndicatorOverlay, IndicatorTrigger } from './indicators/indicator-controls.tsx';
import { useIndicators } from '../react/use-indicators.ts';
import { useChartLayout } from '../react/use-chart-layout.ts';

/**
 * The whole product: one chart, and just enough chrome to explain it.
 */
export function HeatmapPage(): ReactElement {
    const kernel = useKernel();
    const state = useChartState();
    const translate = useTranslate();
    const indicators = useIndicators();
    // Measured here rather than read back from the renderer, so the rows placed
    // over each band are placed by the same arithmetic that drew it.
    const surfaceRef = useRef<HTMLElement>(null);
    const surfaceLayout = useChartLayout(surfaceRef);
    // The drawer is where a layer is configured, so a row on the chart has to be
    // able to open it onto itself rather than carrying a panel of its own.
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [expandedLayer, setExpandedLayer] = useState<string | null>(null);

    const handleOpenSettings = useCallback((instanceId: string) => {
        setExpandedLayer(instanceId);
        setIsDrawerOpen(true);
    }, []);

    // Started, never torn down: the chart outlives this page. Whoever built the
    // container owns its lifetime, and a page that disposed it would leave a
    // dead controller behind for the next mount to draw nothing from.
    useEffect(() => {
        void kernel.chart.initialize();
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

    const recordedSpanMs = resolveRecordedSpanMs(state.instruments, state.instrumentSymbol);
    // The grid the contract is recorded on, not the one this window happens to
    // be sampled at: sampling coarsens as the view widens, and the rungs a
    // reader may pick must not come and go with the zoom.
    const recordedIntervalMs = state.instruments.find(
        (instrument) => instrument.instrumentSymbol === state.instrumentSymbol,
    )?.frameIntervalMs ?? 1_000;

    return (
        <div className="flex h-dvh flex-col bg-abyss-900 pt-[env(safe-area-inset-top)]">
            <header className="flex shrink-0 items-center gap-2 border-b border-hairline px-3 py-2">
                <InstrumentPicker
                    instruments={state.instruments}
                    selectedSymbol={state.instrumentSymbol}
                    onSelect={(symbol) => { kernel.chart.selectInstrument(symbol); }}
                />

                <IntervalPicker
                    chosen={state.barIntervalMs}
                    effectiveMs={state.dataset.bars.intervalMs}
                    frameIntervalMs={recordedIntervalMs}
                    onSelect={(intervalMs) => { kernel.chart.selectBarInterval(intervalMs); }}
                />

                <div className="min-w-0 flex-1 overflow-hidden">
                    <CoverageStrip state={state} />
                </div>

                <IndicatorTrigger controls={indicators} />
                <SettingsDrawer
                    state={state}
                    controls={indicators}
                    isOpen={isDrawerOpen}
                    onOpenChange={setIsDrawerOpen}
                    expandedLayer={expandedLayer}
                    onExpandedLayerChange={setExpandedLayer}
                />
            </header>

            <main ref={surfaceRef} className="relative min-h-0 flex-1">
                <ChartSurface />

                {/* Whatever the layers on the chart put over it. The page
                    mounts them without knowing which layer any of them is. */}
                <div className="pointer-events-none absolute left-3 top-3">
                    {listDrawnOverlays(state.addedIndicators).map(({ instanceId, Overlay }) => (
                        <Overlay key={instanceId} state={state} />
                    ))}
                </div>

                <IndicatorOverlay
                    controls={indicators}
                    layout={surfaceLayout}
                    onOpenSettings={handleOpenSettings}
                />

                {!state.isFollowingLive && <ReturnToLive onReturn={handleReturnToLive} />}

                

                {state.phase === 'initialising' && <SurfaceNotice message={translate('page.probing')} translate={translate} />}
                {state.phase === 'empty' && (
                    <SurfaceNotice
                        message={translate('page.empty')}
                        tone="warning"
                        translate={translate}
                    />
                )}
                {state.phase === 'failed' && (
                    <SurfaceNotice
                        message={translate(state.failureKey ?? 'failure.silent')}
                        tone="warning"
                        translate={translate}
                        onRetry={() => { void kernel.chart.initialize(); }}
                    />
                )}
            </main>

            <footer className="shrink-0 border-t border-hairline pb-[env(safe-area-inset-bottom)]">
                <SpanPresets
                    activeSpanMs={state.viewport.toMs - state.viewport.fromMs}
                    recordedSpanMs={recordedSpanMs}
                    onSelect={handleSpanSelect}
                />
            </footer>
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
