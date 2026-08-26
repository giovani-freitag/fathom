import { Radar, RefreshCw, TriangleAlert } from 'lucide-react';
import { type ReactElement, useCallback, useEffect, useRef } from 'react';
import { resolveRecordedSpanMs } from '../core/viewport-policy.ts';
import { useKernel } from '../react/kernel-context.ts';
import { useChartState } from '../react/use-chart-state.ts';
import { useTranslate } from '../react/use-appearance.ts';
import type { Translate } from '../i18n/translator.ts';
import { ControlButton } from './control-button.tsx';
import { ChartSurface } from './chart-surface.tsx';
import { CoverageStrip } from './coverage-strip.tsx';
import { DepthLegend } from './depth-legend.tsx';
import { SettingsDrawer } from './settings-drawer.tsx';
import { InstrumentPicker } from './instrument-picker.tsx';
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

    useEffect(() => {
        void kernel.chart.initialize();
        return () => {
            kernel.chart.dispose();
        };
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

    return (
        <div className="flex h-dvh flex-col bg-abyss-900 pt-[env(safe-area-inset-top)]">
            <header className="flex shrink-0 items-center gap-2 border-b border-hairline px-3 py-2">
                <InstrumentPicker
                    instruments={state.instruments}
                    selectedSymbol={state.instrumentSymbol}
                    onSelect={(symbol) => { kernel.chart.selectInstrument(symbol); }}
                />

                <div className="min-w-0 flex-1 overflow-hidden">
                    <CoverageStrip state={state} />
                </div>

                {!state.isFollowingLive && (
                    <ControlButton onClick={handleReturnToLive} aria-label={translate('page.returnToLive')}>
                        <Radar className="size-4" />
                    </ControlButton>
                )}
                <IndicatorTrigger controls={indicators} />
                <SettingsDrawer
                    recording={kernel.recording}
                    onContractsChanged={() => { void kernel.chart.refreshInstruments(); }}
                    state={state}
                />
            </header>

            <main ref={surfaceRef} className="relative min-h-0 flex-1">
                <ChartSurface />

                <div className="pointer-events-none absolute left-3 top-3">
                    {state.isDepthVisible && <DepthLegend
                        saturationQuantity={state.dataset.saturationQuantity}
                        floorQuantity={state.dataset.floorQuantity}
                        colourGain={state.colourGain}
                        instrumentSymbol={state.instrumentSymbol}
                    />}
                </div>

                <IndicatorOverlay controls={indicators} layout={surfaceLayout} />

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
