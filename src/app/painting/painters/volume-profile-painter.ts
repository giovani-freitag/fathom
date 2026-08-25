import { toBucketCentrePrice, toPriceBucketIndex } from '../../../shared/core/price-bucket.ts';
import { formatQuantity } from '../../core/formatting.ts';
import { RENDER_PALETTE } from '../render-palette.ts';
import type { PaintContext } from '../render-types.ts';

/** Row height below which a number cannot be read, so only the bar is drawn. */
const LEGIBLE_ROW_HEIGHT_PX = 11;

/** Panel width below which only one of the two columns fits. */
const TWO_COLUMN_WIDTH_PX = 70;

const ROW_FONT = '10px ui-monospace, SFMono-Regular, Menlo, monospace';

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
 *
 * A band rather than an overlay: drawn across the field the bars sit on top of
 * the newest depth and read as a stain on the data instead of a measurement
 * beside it.
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
        this.paintBars(paint, profile);
        this.paintRowNumbers(paint, profile);
        this.paintPointOfControl(paint, profile);
    }

    /**
     * Writes the resting and traded size on each row.
     *
     * Only once the rows are tall enough to hold a digit. Zoomed out the same
     * pass would stack overlapping numbers into a grey smear that hides the
     * bars underneath, so below that height the bars speak alone.
     */
    private paintRowNumbers(paint: PaintContext, profile: VolumeProfile): void {
        const { context, layout, projector, request } = paint;
        const rowHeight = projector.bucketHeight(request.dataset.clusterPriceBucketSize);
        if (rowHeight < LEGIBLE_ROW_HEIGHT_PX) {
            return;
        }

        const hasRoomForBoth = layout.profileWidth >= TWO_COLUMN_WIDTH_PX;
        const previousFont = context.font;
        context.font = ROW_FONT;
        context.textBaseline = 'middle';

        for (const row of profile.rows) {
            this.paintTradedNumber(paint, row);
            if (hasRoomForBoth && row.restingQuantity > 0) {
                context.textAlign = 'left';
                context.fillStyle = RENDER_PALETTE.inkMuted;
                context.fillText(formatQuantity(row.restingQuantity), layout.profileX + 4, row.y);
            }
        }

        context.font = previousFont;
    }

    private paintTradedNumber(paint: PaintContext, row: ProfileRow): void {
        const { context, layout } = paint;
        const traded = row.buyQuantity + row.sellQuantity;
        if (traded <= 0) {
            return;
        }

        context.textAlign = 'right';
        context.fillStyle = RENDER_PALETTE.inkPrimary;
        context.fillText(formatQuantity(traded), layout.profileX + layout.profileWidth - 4, row.y);
    }

    /**
     * Marks the price level that traded the most in view.
     *
     * The busiest level is where the most positions were opened, and price
     * returning to it is one of the few things a volume profile actually says.
     * Without the mark a reader has to eyeball which of several long bars wins.
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

    private paintBars(paint: PaintContext, profile: VolumeProfile): void {
        if (profile.maximumVolume <= 0) {
            return;
        }

        const { context, layout, projector, request } = paint;
        const maximumWidth = layout.profileWidth - 2;
        const rightEdge = layout.profileX + layout.profileWidth;
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
 *
 * The newest rather than a sum over the window: resting size is a level, not a
 * flow, and adding a wall to itself once per second measures nothing.
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
