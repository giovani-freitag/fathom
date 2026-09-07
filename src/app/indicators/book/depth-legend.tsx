import { CircleDashed } from 'lucide-react';
import { DepthColourScale } from './depth-colour-scale.ts';
import type { LayerOverlayProps } from '../layer-contributions.ts';
import { useIndicators } from '../../react/use-indicators.ts';
import { formatQuantity, resolveBaseAsset } from '../../core/formatting.ts';
import { type ReactElement, useEffect, useRef } from 'react';
import { useAppearance, useTranslate } from '../../react/use-appearance.ts';
import { useChartState } from '../../react/use-chart-state.ts';

/** What the mark is made of, whichever of the two it is showing. */
const SHELL_CLASSES =
    'flex select-none items-center rounded-md border border-hairline bg-abyss-900/80 px-2 py-1.5 backdrop-blur-sm';

/**
 * The colour ramp, with the sizes at each of its ends.
 *
 * Or, on a contract nothing recorded, the way to start recording one. A book is
 * the one thing here that cannot be fetched after the fact, so a reader looking
 * at a pair whose candles came from the venue is one press from keeping its
 * book too — and told, rather than left to read an empty ramp as a quiet market.
 */
export function DepthLegend({ instanceId }: LayerOverlayProps): ReactElement {
    const state = useChartState();
    const indicators = useIndicators();
    const { colourGain, instrumentSymbol } = state;
    const { floorQuantity, saturationQuantity } = state.dataset;
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const translate = useTranslate();
    const { resolvedTheme } = useAppearance();

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (canvas === null || context === null || context === undefined) {
            return;
        }

        const ramp = DepthColourScale.ramp();
        const image = context.createImageData(canvas.width, canvas.height);
        for (let column = 0; column < canvas.width; column += 1) {
            const rampOffset = Math.round((column / (canvas.width - 1)) * 255) * 4;
            for (let row = 0; row < canvas.height; row += 1) {
                const pixelOffset = (row * canvas.width + column) * 4;
                image.data[pixelOffset] = ramp[rampOffset]!;
                image.data[pixelOffset + 1] = ramp[rampOffset + 1]!;
                image.data[pixelOffset + 2] = ramp[rampOffset + 2]!;
                image.data[pixelOffset + 3] = ramp[rampOffset + 3]!;
            }
        }
        context.putImageData(image, 0, 0);
        // Redrawn on a theme change: the ramp itself is rebuilt, and a legend
        // painted once would keep showing the colours of the theme it was born in.
    }, [resolvedTheme]);

    if (!state.isRecorded) {
        return (
            <button
                type="button"
                aria-label={translate('legend.recordThis', { symbol: instrumentSymbol ?? '' })}
                onClick={() => { indicators.pick(instanceId); }}
                className={`${SHELL_CLASSES} pointer-events-auto gap-1.5 text-ink-400 transition-colors hover:border-hairline-bright hover:text-ink-100`}
            >
                <CircleDashed className="size-3 shrink-0" />
                <span className="text-[10px] font-semibold uppercase tracking-widest">
                    {translate('legend.notRecorded')}
                </span>
            </button>
        );
    }

    return (
        <div className={`${SHELL_CLASSES} pointer-events-none gap-2`}>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-500">
                {translate('legend.book')}
            </span>
            <span className="numeric text-[10px] text-ink-500">
                {formatQuantity(floorQuantity)}
            </span>
            <canvas ref={canvasRef} width={72} height={6} className="rounded-sm" />
            <span className="numeric text-[10px] text-ink-300">
                {formatQuantity(saturationQuantity / Math.max(colourGain, 0.01))}
                {instrumentSymbol === null ? '' : ` ${resolveBaseAsset(instrumentSymbol)}`}
            </span>
        </div>
    );
}
