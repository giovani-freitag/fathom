import { toBucketCentrePrice, toPriceBucketIndex } from '../../../shared/core/price-bucket.ts';
import { formatQuantity } from '../../core/formatting.ts';
import { RENDER_PALETTE } from '../render-palette.ts';
import type { PaintContext } from '../render-types.ts';

/**
 * Row height below which a number is not worth drawing.
 */
const LEGIBLE_ROW_HEIGHT_PX = 15;

/** Panel width below which only one of the two columns fits. */
const TWO_COLUMN_WIDTH_PX = 70;

/** Share of the panel given to the resting column when both fit. */
const RESTING_COLUMN_SHARE = 0.44;

const HEADER_HEIGHT_PX = 16;

/** Breathing room between a number and the panel edge. */
const EDGE_PADDING_PX = 8;

/** Breathing room between the two columns, which is what separates them. */
const COLUMN_GAP_PX = 10;

const ROW_FONT = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
const HEADER_FONT = '9px ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * How the panel is divided for the current zoom.
 */
interface ProfileColumns {
    readonly hasNumbers: boolean;
    readonly hasRestingColumn: boolean;
    /** Where the resting column ends and the traded column begins. */
    readonly splitX: number;
    readonly rightEdge: number;
}

interface ProfileRow {
    readonly y: number;
    readonly buyQuantity: number;
    readonly sellQuantity: number;
    /** What was resting at this level in the newest frame on screen. */
    readonly restingQuantity: number;
}

interface VolumeProfile {
    readonly rows: readonly ProfileRow[];
    readonly maximumVolume: number;
    /** Row that traded the most, which is where price tends to come back to. */
    readonly busiestRow: ProfileRow | null;
}

/**
 * Draws traded volume per price level, in its own band beside the plot.
 */
export class VolumeProfilePainter {
    /**
     * Draws the panel and its bars.
     *
     * @param paint - The shared paint context.
     */
    paint(paint: PaintContext): void {
        const { context, layout } = paint;
        if (layout.profileWidth === 0) {
            return;
        }

        context.fillStyle = RENDER_PALETTE.profileBackdrop;
        context.fillRect(layout.profileX, 0, layout.profileWidth, layout.plotHeight);
        context.strokeStyle = RENDER_PALETTE.hairline;
        context.beginPath();
        context.moveTo(layout.profileX + 0.5, 0);
        context.lineTo(layout.profileX + 0.5, layout.plotHeight);
        context.stroke();

        const profile = buildVolumeProfile(paint);
        const columns = resolveProfileColumns(paint);
        this.paintBars(paint, profile, columns);
        this.paintRowNumbers(paint, profile, columns);
        this.paintPointOfControl(paint, profile);
        this.paintHeader(paint, columns);
    }

    /**
     * Names the columns once, quietly, at the top.
     */
    private paintHeader(paint: PaintContext, columns: ProfileColumns): void {
        if (!columns.hasNumbers) {
            return;
        }

        const { context } = paint;
        const previousFont = context.font;
        context.font = HEADER_FONT;
        context.textBaseline = 'middle';
        context.textAlign = 'right';
        context.fillStyle = RENDER_PALETTE.inkMuted;

        if (columns.hasRestingColumn) {
            context.fillText('BOOK', columns.splitX - COLUMN_GAP_PX, HEADER_HEIGHT_PX / 2);
        }
        context.fillText('TRADED', columns.rightEdge - EDGE_PADDING_PX, HEADER_HEIGHT_PX / 2);
        context.font = previousFont;
    }

    /**
     * Writes the resting and traded size on each row.
     */
    private paintRowNumbers(
        paint: PaintContext,
        profile: VolumeProfile,
        columns: ProfileColumns,
    ): void {
        if (!columns.hasNumbers) {
            return;
        }

        const { context } = paint;
        const previousFont = context.font;
        context.font = ROW_FONT;
        context.textBaseline = 'middle';
        context.textAlign = 'right';

        for (const row of profile.rows) {
            if (row.y < HEADER_HEIGHT_PX) {
                continue;
            }
            this.paintTradedNumber(paint, row, columns);
            if (columns.hasRestingColumn && row.restingQuantity > 0) {
                context.fillStyle = RENDER_PALETTE.inkMuted;
                context.fillText(
                    formatQuantity(row.restingQuantity),
                    columns.splitX - COLUMN_GAP_PX,
                    row.y,
                );
            }
        }

        context.font = previousFont;
    }

    private paintTradedNumber(
        paint: PaintContext,
        row: ProfileRow,
        columns: ProfileColumns,
    ): void {
        const traded = row.buyQuantity + row.sellQuantity;
        if (traded <= 0) {
            return;
        }

        paint.context.fillStyle = RENDER_PALETTE.inkPrimary;
        paint.context.fillText(formatQuantity(traded), columns.rightEdge - EDGE_PADDING_PX, row.y);
    }

    /**
     * Marks the price level that traded the most in view.
     */
    private paintPointOfControl(paint: PaintContext, profile: VolumeProfile): void {
        const busiestRow = profile.busiestRow;
        if (busiestRow === null) {
            return;
        }

        const { context, layout } = paint;
        const y = Math.round(busiestRow.y) + 0.5;

        context.strokeStyle = RENDER_PALETTE.amber;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(layout.profileX, y);
        context.lineTo(layout.profileX + layout.profileWidth, y);
        context.stroke();
    }

    private paintBars(
        paint: PaintContext,
        profile: VolumeProfile,
        columns: ProfileColumns,
    ): void {
        if (profile.maximumVolume <= 0) {
            return;
        }

        const { context, layout, projector, request } = paint;
        const rightEdge = columns.rightEdge;
        // Once the resting column exists the bars are confined to their own, so
        // a long bar cannot run underneath a number that belongs to the other.
        const maximumWidth = columns.hasRestingColumn
            ? rightEdge - columns.splitX - EDGE_PADDING_PX
            : layout.profileWidth - 2;
        const barHeight = Math.max(
            1,
            projector.bucketHeight(request.dataset.clusterPriceBucketSize) - 0.5,
        );

        for (const row of profile.rows) {
            const buyWidth = (row.buyQuantity / profile.maximumVolume) * maximumWidth;
            const sellWidth = (row.sellQuantity / profile.maximumVolume) * maximumWidth;
            const top = row.y - barHeight / 2;

            context.fillStyle = RENDER_PALETTE.profileBuy;
            context.fillRect(rightEdge - buyWidth, top, buyWidth, barHeight);
            context.fillStyle = RENDER_PALETTE.profileSell;
            context.fillRect(rightEdge - buyWidth - sellWidth, top, sellWidth, barHeight);

            // Over a lit depth field a translucent bar reads as a stain rather
            // than a measurement; the cap gives it an edge to read against.
            context.fillStyle = RENDER_PALETTE.profileEdge;
            context.fillRect(rightEdge - buyWidth - sellWidth, top, 1, barHeight);
        }
    }
}

function buildVolumeProfile(paint: PaintContext): VolumeProfile {
    const { layout, projector, request } = paint;
    const volumeByBucket = new Map<number, { buyQuantity: number; sellQuantity: number }>();

    for (const cluster of request.dataset.clusters) {
        if (cluster.executedAtMs < request.viewport.fromMs || cluster.executedAtMs > request.viewport.toMs) {
            continue;
        }
        const existing = volumeByBucket.get(cluster.priceBucketIndex)
            ?? { buyQuantity: 0, sellQuantity: 0 };
        existing.buyQuantity += cluster.buyQuantity;
        existing.sellQuantity += cluster.sellQuantity;
        volumeByBucket.set(cluster.priceBucketIndex, existing);
    }

    const rows: ProfileRow[] = [];
    let maximumVolume = 0;
    let busiestRow: ProfileRow | null = null;

    for (const [bucketIndex, volume] of volumeByBucket) {
        const price = toBucketCentrePrice(bucketIndex, request.dataset.clusterPriceBucketSize);
        const y = projector.priceToY(price);
        if (y < 0 || y > layout.plotHeight) {
            continue;
        }

        const row = {
            y,
            buyQuantity: volume.buyQuantity,
            sellQuantity: volume.sellQuantity,
            restingQuantity: readRestingQuantity(paint, price),
        };
        const total = volume.buyQuantity + volume.sellQuantity;
        if (total > maximumVolume) {
            maximumVolume = total;
            busiestRow = row;
        }
        rows.push(row);
    }

    return { rows, maximumVolume, busiestRow };
}

/**
 * What is resting at a price in the newest frame on screen.
 */
function readRestingQuantity(paint: PaintContext, price: number): number {
    const { dataset } = paint.request;
    const frame = dataset.frames[dataset.frames.length - 1];
    if (frame === undefined) {
        return 0;
    }

    const bucketIndex = toPriceBucketIndex(price, dataset.priceBucketSize);
    return (frame.bids.quantities[bucketIndex - frame.bids.lowestBucketIndex] ?? 0)
        + (frame.asks.quantities[bucketIndex - frame.asks.lowestBucketIndex] ?? 0);
}

/**
 * Decides how much of a table the panel can be at this zoom.
 *
 * @param paint - The shared paint context.
 * @returns Where the columns sit and which of them are drawn.
 */
function resolveProfileColumns(paint: PaintContext): ProfileColumns {
    const { layout, projector, request } = paint;
    const rowHeight = projector.bucketHeight(request.dataset.clusterPriceBucketSize);
    const hasNumbers = rowHeight >= LEGIBLE_ROW_HEIGHT_PX;
    const hasRestingColumn = hasNumbers && layout.profileWidth >= TWO_COLUMN_WIDTH_PX;

    return {
        hasNumbers,
        hasRestingColumn,
        splitX: layout.profileX + Math.round(layout.profileWidth * RESTING_COLUMN_SHARE),
        rightEdge: layout.profileX + layout.profileWidth,
    };
}
