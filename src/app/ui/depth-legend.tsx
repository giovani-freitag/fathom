import { DepthColourScale } from '../painting/depth-colour-scale.ts';
import { formatQuantity, resolveBaseAsset } from '../core/formatting.ts';
import { type ReactElement, useEffect, useRef } from 'react';

interface DepthLegendProps {
    readonly saturationQuantity: number;
    readonly colourGain: number;
    readonly instrumentSymbol: string | null;
}

/**
 * The colour ramp, with the size it saturates at.
 *
 * Intensity is relative to the loaded window rather than absolute, so without
 * the number beside it the ramp says nothing about how large a wall actually is.
 */
export function DepthLegend({
    saturationQuantity,
    colourGain,
    instrumentSymbol,
}: DepthLegendProps): ReactElement {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

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
    }, []);

    return (
        <div className="pointer-events-none flex select-none items-center gap-2 rounded-md border border-hairline bg-abyss-900/80 px-2 py-1.5 backdrop-blur-sm">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-500">
                livro
            </span>
            <canvas ref={canvasRef} width={72} height={6} className="rounded-sm" />
            <span className="numeric text-[10px] text-ink-300">
                {formatQuantity(saturationQuantity / Math.max(colourGain, 0.01))}
                {instrumentSymbol === null ? '' : ` ${resolveBaseAsset(instrumentSymbol)}`}
            </span>
        </div>
    );
}
