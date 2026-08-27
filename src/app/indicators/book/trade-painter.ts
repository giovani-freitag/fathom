import { toBucketCentrePrice } from '../../../shared/core/price-bucket.ts';
import { RENDER_METRICS } from '../../painting/render-palette.ts';
import type { FieldLayerPainter, PaintContext, RenderRequest } from '../../painting/render-types.ts';

/**
 * Side of the cell prints are merged into, in CSS pixels.
 *
 * Two prints landing closer than the smallest bubble cannot be told apart, so
 * drawing both spends fill rate on pixels the second one hides. A day of a
 * liquid contract puts several prints inside one column, and one column is
 * under a pixel wide.
 */
const MERGE_CELL_PX = 3;

/**
 * Where the largest bubble is reached.
 *
 * A share rather than the maximum: one whale print would otherwise shrink every
 * ordinary one to the floor, and what a reader is comparing is the ordinary
 * ones against each other.
 */
const SATURATION_PERCENTILE = 0.99;

/**
 * One merged print, in the units it was recorded in.
 *
 * Never in pixels. A cell keyed on where it landed on screen is a cell that
 * moves as the chart is dragged: two prints sharing one at a given offset fall
 * into separate ones a pixel later, and the bubble visibly splits and rejoins.
 */
interface PrintCell {
    readonly atMs: number;
    readonly priceBucketIndex: number;
    buyQuantity: number;
    sellQuantity: number;
}

interface MergedPrints {
    readonly cells: readonly PrintCell[];
    /** The total a bubble reaches full size at. */
    readonly saturationQuantity: number;
}

interface MergeGrid {
    readonly cellMs: number;
    readonly cellBuckets: number;
}

const NOTHING: MergedPrints = { cells: [], saturationQuantity: 0 };

/**
 * Draws aggressive executions as bubbles over the depth field.
 */
export class TradePainter implements FieldLayerPainter {
    /** Last of the book, so an execution is never hidden by the price it happened at. */
    readonly order = 30;

    /**
     * Whether the chart is showing it.
     *
     * @param request - Everything the frame is being drawn from.
     * @returns True while the reading it draws is on the chart.
     */
    isDrawn(request: RenderRequest): boolean {
        return request.isTradeOverlayVisible;
    }

    private mergedKey: string | null = null;
    private merged: MergedPrints = NOTHING;

    /**
     * Draws every execution in the plot, merged where they would overlap.
     *
     * @param paint - The shared paint context.
     */
    paint(paint: PaintContext): void {
        const { cells, saturationQuantity } = this.resolveMerged(paint);
        if (saturationQuantity <= 0) {
            return;
        }

        const { minimumBubbleRadius, maximumBubbleRadius } = RENDER_METRICS;
        const radiusSpan = (paint.layout.isCompact ? 0.7 : 1)
            * (maximumBubbleRadius - minimumBubbleRadius);

        for (const cell of cells) {
            this.paintBubble(paint, cell, saturationQuantity, radiusSpan);
        }
    }

    /**
     * The merge in force, rebuilt only when what it was built from changed.
     *
     * Dragging changes neither the executions nor the size of a cell, so the
     * work of merging them does not belong on the gesture path.
     */
    private resolveMerged(paint: PaintContext): MergedPrints {
        const grid = resolveMergeGrid(paint);
        const { dataset } = paint.request;
        const key = [
            dataset.revision,
            dataset.instrumentSymbol,
            dataset.clusterPriceBucketSize,
            grid.cellMs,
            grid.cellBuckets,
        ].join('|');

        if (key !== this.mergedKey) {
            this.merged = mergePrints(paint, grid);
            this.mergedKey = key;
        }
        return this.merged;
    }

    private paintBubble(
        paint: PaintContext,
        cell: PrintCell,
        saturationQuantity: number,
        radiusSpan: number,
    ): void {
        const { context, layout, projector, request } = paint;
        if (cell.atMs < request.viewport.fromMs || cell.atMs > request.viewport.toMs) {
            return;
        }

        const y = projector.priceToY(
            toBucketCentrePrice(cell.priceBucketIndex, request.dataset.clusterPriceBucketSize),
        );
        // Culled here rather than clipped by the canvas: a print far outside the
        // price band still costs a path and a fill before it is discarded.
        const margin = RENDER_METRICS.maximumBubbleRadius;
        if (y < -margin || y > layout.pricePaneHeight + margin) {
            return;
        }

        const share = Math.min(1, Math.sqrt((cell.buyQuantity + cell.sellQuantity) / saturationQuantity));

        // Every second on a liquid contract carries a print, so a flat alpha
        // draws a continuous dotted line and hides the prints that matter.
        const emphasis = 0.22 + 0.6 * share;

        context.beginPath();
        context.arc(
            projector.timeToX(cell.atMs),
            y,
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

/**
 * How much time and price one cell covers, so it is about a bubble wide.
 *
 * Derived from the zoom rather than from where the chart happens to be scrolled
 * to, which is what keeps the grid still while it is dragged.
 */
function resolveMergeGrid(paint: PaintContext): MergeGrid {
    const { layout, request } = paint;
    const spanMs = Math.max(1, request.viewport.toMs - request.viewport.fromMs);
    const priceSpan = Math.max(
        Number.EPSILON,
        request.viewport.highPrice - request.viewport.lowPrice,
    );
    const bucketSize = Math.max(Number.EPSILON, request.dataset.clusterPriceBucketSize);
    const bucketsPerPixel = priceSpan / Math.max(1, layout.pricePaneHeight) / bucketSize;

    return {
        cellMs: Math.max(1, Math.round((spanMs / Math.max(1, layout.plotWidth)) * MERGE_CELL_PX)),
        cellBuckets: Math.max(1, Math.round(bucketsPerPixel * MERGE_CELL_PX)),
    };
}

/**
 * Every loaded print, gathered into the cells they share.
 *
 * Over everything loaded rather than everything visible, so that neither which
 * prints merge nor how large they are drawn depends on where the chart is
 * scrolled to.
 */
function mergePrints(paint: PaintContext, grid: MergeGrid): MergedPrints {
    const { clusters } = paint.request.dataset;
    // Keyed as a pair rather than packed into one number. A cell derived from
    // the epoch multiplied by any stride leaves the range integers are exact
    // in: below a minute of span the low digits are lost, and neighbouring
    // price cells silently merge into one bubble.
    const cells = new Map<string, PrintCell>();

    for (const cluster of clusters) {
        const timeCell = Math.floor(cluster.executedAtMs / grid.cellMs);
        const priceCell = Math.floor(cluster.priceBucketIndex / grid.cellBuckets);
        const key = `${timeCell}:${priceCell}`;

        const found = cells.get(key);
        if (found === undefined) {
            cells.set(key, {
                atMs: cluster.executedAtMs,
                priceBucketIndex: cluster.priceBucketIndex,
                buyQuantity: cluster.buyQuantity,
                sellQuantity: cluster.sellQuantity,
            });
            continue;
        }
        found.buyQuantity += cluster.buyQuantity;
        found.sellQuantity += cluster.sellQuantity;
    }

    const merged = [...cells.values()];
    return { cells: merged, saturationQuantity: resolveSaturation(merged) };
}

/**
 * The total a bubble is drawn at full size for.
 */
function resolveSaturation(cells: readonly PrintCell[]): number {
    if (cells.length === 0) {
        return 0;
    }
    const totals = cells
        .map((cell) => cell.buyQuantity + cell.sellQuantity)
        .sort((first, second) => first - second);

    // Rounded rather than truncated: with a handful of prints, truncating lands
    // on the smallest of them and every bubble is then drawn at full size.
    return totals[Math.round(SATURATION_PERCENTILE * (totals.length - 1))]!;
}
