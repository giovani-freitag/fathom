import { toBucketCentrePrice } from '../../../shared/core/price-bucket.ts';
import { RENDER_PALETTE } from '../render-palette.ts';
import type { PaintContext } from '../render-types.ts';

interface ProfileRow {
    readonly y: number;
    readonly buyQuantity: number;
    readonly sellQuantity: number;
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
        this.paintPointOfControl(paint, profile);
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

        const row = { y, buyQuantity: volume.buyQuantity, sellQuantity: volume.sellQuantity };
        const total = volume.buyQuantity + volume.sellQuantity;
        if (total > maximumVolume) {
            maximumVolume = total;
            busiestRow = row;
        }
        rows.push(row);
    }

    return { rows, maximumVolume, busiestRow };
}
