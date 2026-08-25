import { findClusterAt, findFrameNearest } from '../../dataset-lookup.ts';
import { formatQuantity } from '../../formatting.ts';
import { RENDER_PALETTE } from '../render-palette.ts';
import type { PaintContext, PointerReadout } from '../render-types.ts';
import type { AxisPainter } from './axis-painter.ts';

const READOUT_LINE_HEIGHT = 15;

interface ReadoutLine {
    readonly label: string;
    readonly colour: string;
}

export interface CrosshairPainterConfig {
    readonly axisPainter: AxisPainter;
}

/**
 * Draws the crosshair and what sits under it.
 *
 * The readout answers both questions a reader has at a point: how much is
 * resting there, and how much actually traded. Either alone invites the wrong
 * conclusion — a thick wall nobody hit reads very differently from one being
 * eaten.
 */
export class CrosshairPainter {
    private readonly axisPainter: AxisPainter;

    constructor(config: CrosshairPainterConfig) {
        this.axisPainter = config.axisPainter;
    }

    /**
     * Draws the crosshair, its two axis tags, and the readout box.
     *
     * @param paint - The shared paint context.
     */
    paint(paint: PaintContext): void {
        const pointer = paint.request.pointer;
        if (pointer === null || paint.crosshairY === null) {
            return;
        }

        this.paintLines(paint, pointer);

        const price = paint.projector.yToPrice(pointer.y);
        const timestampMs = paint.projector.xToTime(pointer.x);

        this.axisPainter.paintPriceTag(paint, {
            price,
            y: pointer.y,
            background: RENDER_PALETTE.inkPrimary,
            foreground: RENDER_PALETTE.surface,
        });
        this.paintReadout(paint, pointer, price, timestampMs);
    }

    private paintLines(paint: PaintContext, pointer: PointerReadout): void {
        const { context, layout } = paint;

        context.strokeStyle = RENDER_PALETTE.crosshair;
        context.lineWidth = 1;
        context.setLineDash([2, 4]);
        context.beginPath();
        context.moveTo(Math.round(pointer.x) + 0.5, 0);
        context.lineTo(Math.round(pointer.x) + 0.5, layout.plotHeight);
        context.moveTo(0, Math.round(pointer.y) + 0.5);
        context.lineTo(layout.plotWidth, Math.round(pointer.y) + 0.5);
        context.stroke();
        context.setLineDash([]);
    }

    private paintReadout(
        paint: PaintContext,
        pointer: PointerReadout,
        price: number,
        timestampMs: number,
    ): void {
        const { dataset } = paint.request;
        // The frame under the cursor, not the newest one: while the view is
        // parked in history the newest frame describes a different minute, and a
        // readout that silently reports it is worse than no readout at all.
        const frame = findFrameNearest(dataset.frames, timestampMs);
        if (frame === undefined) {
            return;
        }

        const lines: ReadoutLine[] = [];
        const bucketIndex = Math.floor(price / dataset.priceBucketSize);
        const bidQuantity = frame.bids.quantities[bucketIndex - frame.bids.lowestBucketIndex] ?? 0;
        const askQuantity = frame.asks.quantities[bucketIndex - frame.asks.lowestBucketIndex] ?? 0;
        const restingQuantity = bidQuantity > 0 ? bidQuantity : askQuantity;

        if (restingQuantity > 0) {
            lines.push({
                label: `livro ${formatQuantity(restingQuantity)}`,
                colour: bidQuantity > 0 ? RENDER_PALETTE.bid : RENDER_PALETTE.ask,
            });
        }

        const cluster = findClusterAt(dataset, price, timestampMs);
        if (cluster !== null) {
            lines.push({
                label: `negoc. ${formatQuantity(cluster.buyQuantity + cluster.sellQuantity)} · ${cluster.tradeCount}x`,
                colour: cluster.buyQuantity >= cluster.sellQuantity
                    ? RENDER_PALETTE.bid
                    : RENDER_PALETTE.ask,
            });
        }

        this.paintReadoutBox(paint, lines, pointer);
    }

    /**
     * Draws the readout beside the cursor, flipping it before it runs off an edge.
     */
    private paintReadoutBox(
        paint: PaintContext,
        lines: readonly ReadoutLine[],
        pointer: PointerReadout,
    ): void {
        if (lines.length === 0) {
            return;
        }

        const { context, layout } = paint;
        const widest = Math.max(...lines.map((line) => context.measureText(line.label).width));
        const boxWidth = widest + 12;
        const boxHeight = lines.length * READOUT_LINE_HEIGHT + 6;
        const preferredX = pointer.x + 12;
        const boxX = preferredX + boxWidth > layout.plotWidth ? pointer.x - 12 - boxWidth : preferredX;
        const boxY = Math.max(0, Math.min(pointer.y - boxHeight - 8, layout.plotHeight - boxHeight));

        context.fillStyle = RENDER_PALETTE.axisBackdrop;
        context.fillRect(boxX, boxY, boxWidth, boxHeight);
        context.strokeStyle = RENDER_PALETTE.hairline;
        context.strokeRect(boxX + 0.5, boxY + 0.5, boxWidth - 1, boxHeight - 1);

        context.textAlign = 'left';
        context.textBaseline = 'middle';
        for (const [index, line] of lines.entries()) {
            context.fillStyle = line.colour;
            context.fillText(line.label, boxX + 6, boxY + 3 + READOUT_LINE_HEIGHT * (index + 0.5));
        }
    }
}
