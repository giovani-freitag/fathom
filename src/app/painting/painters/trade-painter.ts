import { toBucketCentrePrice } from '../../../shared/core/price-bucket.ts';
import { RENDER_METRICS } from '../render-palette.ts';
import type { PaintContext } from '../render-types.ts';

/**
 * Side of the screen cell prints are merged into, in CSS pixels.
 *
 * Two prints landing closer than the smallest bubble cannot be told apart, so
 * drawing both spends fill rate on pixels the second one hides. A day of a
 * liquid contract puts several prints inside one column, and one column is
 * under a pixel wide.
 */
const MERGE_CELL_PX = 3;

/** Rows a cell key may encode, which is more than a plot can be tall. */
const CELL_KEY_STRIDE = 8_192;

interface PrintCell {
    x: number;
    y: number;
    buyQuantity: number;
    sellQuantity: number;
}

/**
 * Draws aggressive executions as bubbles over the depth field.
 */
export class TradePainter {
    /**
     * Draws every execution visible in the plot, merged where they overlap.
     *
     * @param paint - The shared paint context.
     */
    paint(paint: PaintContext): void {
        const cells = this.mergePrints(paint);
        if (cells.length === 0) {
            return;
        }

        let largestVolume = 0;
        for (const cell of cells) {
            largestVolume = Math.max(largestVolume, cell.buyQuantity + cell.sellQuantity);
        }
        if (largestVolume <= 0) {
            return;
        }

        const { minimumBubbleRadius, maximumBubbleRadius } = RENDER_METRICS;
        const radiusSpan = (paint.layout.isCompact ? 0.7 : 1)
            * (maximumBubbleRadius - minimumBubbleRadius);

        for (const cell of cells) {
            this.paintBubble(paint, cell, largestVolume, radiusSpan);
        }
    }

    /**
     * The prints inside the plot, one entry per cell they share.
     */
    private mergePrints(paint: PaintContext): PrintCell[] {
        const { layout, projector, request } = paint;
        const { clusters, clusterPriceBucketSize } = request.dataset;
        const cells = new Map<number, PrintCell>();

        for (const cluster of clusters) {
            if (cluster.executedAtMs < request.viewport.fromMs
                || cluster.executedAtMs > request.viewport.toMs) {
                continue;
            }
            const y = projector.priceToY(
                toBucketCentrePrice(cluster.priceBucketIndex, clusterPriceBucketSize),
            );
            // Culled here rather than clipped by the canvas: a print far outside
            // the price band still costs a path and a fill before it is discarded.
            const margin = RENDER_METRICS.maximumBubbleRadius;
            if (y < -margin || y > layout.plotHeight + margin) {
                continue;
            }

            const x = projector.timeToX(cluster.executedAtMs);
            const key = Math.round(x / MERGE_CELL_PX) * CELL_KEY_STRIDE
                + Math.round(y / MERGE_CELL_PX);

            const found = cells.get(key);
            if (found === undefined) {
                cells.set(key, {
                    x,
                    y,
                    buyQuantity: cluster.buyQuantity,
                    sellQuantity: cluster.sellQuantity,
                });
                continue;
            }
            found.buyQuantity += cluster.buyQuantity;
            found.sellQuantity += cluster.sellQuantity;
        }

        return [...cells.values()];
    }

    private paintBubble(
        paint: PaintContext,
        cell: PrintCell,
        largestVolume: number,
        radiusSpan: number,
    ): void {
        const { context } = paint;
        const share = Math.sqrt((cell.buyQuantity + cell.sellQuantity) / largestVolume);

        // Every second on a liquid contract carries a print, so a flat alpha
        // draws a continuous dotted line and hides the prints that matter.
        const emphasis = 0.22 + 0.6 * share;

        context.beginPath();
        context.arc(
            cell.x,
            cell.y,
            RENDER_METRICS.minimumBubbleRadius + radiusSpan * share,
            0,
            Math.PI * 2,
        );
        context.fillStyle = cell.buyQuantity >= cell.sellQuantity
            ? `rgba(43, 212, 168, ${emphasis.toFixed(2)})`
            : `rgba(255, 92, 114, ${emphasis.toFixed(2)})`;
        context.fill();
    }
}
