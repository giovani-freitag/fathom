import { toBucketCentrePrice } from '@fathom/contracts';
import { RENDER_PALETTE } from '../render-palette';
import type { PaintContext } from '../render-types';

interface ProfileRow {
    readonly y: number;
    readonly buyQuantity: number;
    readonly sellQuantity: number;
}

interface VolumeProfile {
    readonly rows: readonly ProfileRow[];
    readonly maximumVolume: number;
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

        this.paintBars(paint, buildVolumeProfile(paint));
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

    for (const [bucketIndex, volume] of volumeByBucket) {
        const price = toBucketCentrePrice(bucketIndex, request.dataset.clusterPriceBucketSize);
        const y = projector.priceToY(price);
        if (y < 0 || y > layout.plotHeight) {
            continue;
        }
        maximumVolume = Math.max(maximumVolume, volume.buyQuantity + volume.sellQuantity);
        rows.push({ y, buyQuantity: volume.buyQuantity, sellQuantity: volume.sellQuantity });
    }

    return { rows, maximumVolume };
}
