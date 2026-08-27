import { DepthColourScale } from './depth-colour-scale.ts';
import { formatQuantity, resolveBaseAsset } from '../../core/formatting.ts';
import { type ReactElement, useEffect, useRef } from 'react';
import { useAppearance, useTranslate } from '../../react/use-appearance.ts';
import { useChartState } from '../../react/use-chart-state.ts';

/**
 * The colour ramp, with the sizes at each of its ends.
 */
export function DepthLegend(): ReactElement {
    const state = useChartState();
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

    return (
        <div className="pointer-events-none flex select-none items-center gap-2 rounded-md border border-hairline bg-abyss-900/80 px-2 py-1.5 backdrop-blur-sm">
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
