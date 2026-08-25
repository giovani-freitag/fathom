import { useChartSurface } from '../react/use-chart-surface.ts';
import type { ReactElement } from 'react';

/**
 * The two stacked canvases the chart is drawn on.
 *
 * Depth sits underneath as a single scaled image and the chrome on top, so a
 * pointer move repaints only the thin overlay instead of the whole field.
 */
export function ChartSurface(): ReactElement {
    const { containerRef, depthCanvasRef, overlayCanvasRef } = useChartSurface();

    return (
        <div
            ref={containerRef}
            className="chart-surface abyss-grain relative size-full cursor-crosshair overflow-hidden bg-abyss-950"
            role="img"
            aria-label="Mapa de calor de liquidez do livro de ofertas"
        >
            <canvas ref={depthCanvasRef} className="absolute inset-0" />
            <canvas ref={overlayCanvasRef} className="absolute inset-0" />
        </div>
    );
}
