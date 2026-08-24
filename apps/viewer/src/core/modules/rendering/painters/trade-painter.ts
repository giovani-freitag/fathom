import { toBucketCentrePrice } from '@fathom/contracts';
import { RENDER_METRICS } from '../render-palette';
import type { PaintContext } from '../render-types';

/**
 * Draws aggressive executions as bubbles over the depth field.
 *
 * Size carries volume on a square-root scale so a print ten times larger reads
 * as roughly three times wider rather than ten, which is what keeps one outsized
 * trade from covering its whole neighbourhood.
 */
export class TradePainter {
    /**
     * Draws every execution cell in the visible range.
     *
     * @param paint - The shared paint context.
     */
    paint(paint: PaintContext): void {
        const { context, layout, projector, request } = paint;
        const visibleClusters = request.dataset.clusters.filter(
            (cluster) => cluster.executedAtMs >= request.viewport.fromMs
                && cluster.executedAtMs <= request.viewport.toMs,
        );
        if (visibleClusters.length === 0) {
            return;
        }

        const largestVolume = visibleClusters.reduce(
            (running, cluster) => Math.max(running, cluster.buyQuantity + cluster.sellQuantity),
            0,
        );
        if (largestVolume <= 0) {
            return;
        }

        const { minimumBubbleRadius, maximumBubbleRadius } = RENDER_METRICS;
        const radiusSpan = (layout.isCompact ? 0.7 : 1) * (maximumBubbleRadius - minimumBubbleRadius);

        for (const cluster of visibleClusters) {
            const volume = cluster.buyQuantity + cluster.sellQuantity;
            const price = toBucketCentrePrice(
                cluster.priceBucketIndex,
                request.dataset.clusterPriceBucketSize,
            );
            const share = Math.sqrt(volume / largestVolume);

            // Every second on a liquid contract carries a print, so a flat alpha
            // draws a continuous dotted line and hides the prints that matter.
            const emphasis = 0.22 + 0.6 * share;

            context.beginPath();
            context.arc(
                projector.timeToX(cluster.executedAtMs),
                projector.priceToY(price),
                minimumBubbleRadius + radiusSpan * share,
                0,
                Math.PI * 2,
            );
            context.fillStyle = cluster.buyQuantity >= cluster.sellQuantity
                ? `rgba(43, 212, 168, ${emphasis.toFixed(3)})`
                : `rgba(255, 92, 114, ${emphasis.toFixed(3)})`;
            context.fill();
        }
    }
}
