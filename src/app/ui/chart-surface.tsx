import { useChartSurface } from '../react/use-chart-surface.ts';
import type { ReactElement } from 'react';

/**
 * The two stacked canvases the chart is drawn on.
 */
export function ChartSurface(): ReactElement {
    const { containerRef, depthCanvasRef, overlayCanvasRef } = useChartSurface();

    return (
        <div
            ref={containerRef}
            className="chart-surface abyss-grain relative size-full cursor-crosshair overflow-hidden bg-abyss-950"
            role="img"
            aria-label="Order book liquidity heat map"
        >
            <canvas ref={depthCanvasRef} className="absolute inset-0" />
            <canvas ref={overlayCanvasRef} className="absolute inset-0" />
        </div>
    );
}
