import { Radar, RefreshCw, TriangleAlert } from 'lucide-react';
import { type ReactElement, useCallback, useEffect } from 'react';
import { useKernel } from '@react/kernel-context';
import { useChartState } from '@react/use-chart-state';
import { ControlButton } from '@ui/primitives/control-button';
import { ChartSurface } from './components/chart-surface';
import { CoverageStrip } from './components/coverage-strip';
import { DepthLegend } from './components/depth-legend';
import { DisplaySettingsSheet } from './components/display-settings-sheet';
import { InstrumentPicker } from './components/instrument-picker';
import { SpanPresets } from './components/span-presets';

/**
 * The whole product: one chart, and just enough chrome to explain it.
 */
export function HeatmapPage(): ReactElement {
    const kernel = useKernel();
    const state = useChartState();

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

    const selectedInstrument = state.instruments.find(
        (candidate) => candidate.instrumentSymbol === state.instrumentSymbol,
    );
    const recordedSpanMs = selectedInstrument === undefined
        || selectedInstrument.firstFrameAtMs === null
        || selectedInstrument.lastFrameAtMs === null
        ? 0
        : selectedInstrument.lastFrameAtMs - selectedInstrument.firstFrameAtMs;

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
                    <ControlButton onClick={handleReturnToLive} aria-label="Voltar ao tempo real">
                        <Radar className="size-4" />
                    </ControlButton>
                )}
                <DisplaySettingsSheet
                    state={state}
                    onChange={(patch) => { kernel.chart.updateSettings(patch); }}
                />
            </header>

            <main className="relative min-h-0 flex-1">
                <ChartSurface />

                <div className="pointer-events-none absolute left-3 top-3">
                    <DepthLegend
                        saturationQuantity={state.dataset.saturationQuantity}
                        colourGain={state.colourGain}
                    />
                </div>

                {state.phase === 'initialising' && <SurfaceNotice message="Sondando o arquivo…" />}
                {state.phase === 'empty' && (
                    <SurfaceNotice
                        message="Nada gravado ainda. O coletor precisa estar rodando — o histórico do livro não é recuperável depois."
                        tone="warning"
                    />
                )}
                {state.phase === 'failed' && (
                    <SurfaceNotice
                        message={state.errorMessage ?? 'O gateway não respondeu.'}
                        tone="warning"
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
    readonly tone?: 'neutral' | 'warning';
    readonly onRetry?: () => void;
}

function SurfaceNotice({ message, tone = 'neutral', onRetry }: SurfaceNoticeProps): ReactElement {
    return (
        <div className="absolute inset-0 grid place-items-center bg-abyss-950/80 px-6 backdrop-blur-sm">
            <div className="max-w-sm space-y-3 text-center">
                {tone === 'warning' && <TriangleAlert className="mx-auto size-6 text-amber" />}
                <p className="text-sm leading-relaxed text-ink-300">{message}</p>
                {onRetry !== undefined && (
                    <ControlButton onClick={onRetry} className="mx-auto">
                        <RefreshCw className="size-4" />
                        Tentar de novo
                    </ControlButton>
                )}
            </div>
        </div>
    );
}
