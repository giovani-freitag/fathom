import { findClusterAt, findFrameNearest } from '../../core/dataset-lookup.ts';
import {
    formatPrice,
    formatQuantity,
    formatReadoutMoment,
    formatSignedPercent,
    formatSignedPrice,
    resolveBaseAsset,
} from '../../core/formatting.ts';
import { RENDER_PALETTE } from '../render-palette.ts';
import type { LiquidityFrame } from '../../../shared/core/liquidity-frame.ts';
import type { PaintContext, PointerReadout } from '../render-types.ts';
import type { AxisPainter } from './axis-painter.ts';

const READOUT_LINE_HEIGHT = 17;

/** Space between the text and the box edge, on each side. */
const READOUT_PADDING_X = 11;
const READOUT_PADDING_Y = 9;

const READOUT_CORNER_RADIUS = 7;

/** Gap between the cursor and the nearest corner of the box. */
const READOUT_CURSOR_GAP = 14;

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

        const bucketIndex = Math.floor(price / dataset.priceBucketSize);
        const bucketPrice = bucketIndex * dataset.priceBucketSize;
        const lines: ReadoutLine[] = [
            { label: formatReadoutMoment(frame.capturedAtMs), colour: RENDER_PALETTE.inkMuted },
            this.describeResting(paint, frame, bucketIndex, bucketPrice),
        ];

        if (!paint.layout.isCompact) {
            lines.push(this.describeDistance(frame, bucketPrice));
        }
        lines.push(...this.describeTrades(paint, price, timestampMs));

        this.paintReadoutBox(paint, lines, pointer);
    }

    /**
     * The side and size resting in the bucket under the cursor.
     */
    private describeResting(
        paint: PaintContext,
        frame: LiquidityFrame,
        bucketIndex: number,
        bucketPrice: number,
    ): ReadoutLine {
        const bidQuantity = frame.bids.quantities[bucketIndex - frame.bids.lowestBucketIndex] ?? 0;
        const askQuantity = frame.asks.quantities[bucketIndex - frame.asks.lowestBucketIndex] ?? 0;
        const asset = resolveBaseAsset(paint.request.dataset.instrumentSymbol);

        if (bidQuantity > 0) {
            return {
                label: `BID ${formatQuantity(bidQuantity)} ${asset} at ${formatPrice(bucketPrice)}`,
                colour: RENDER_PALETTE.bid,
            };
        }
        if (askQuantity > 0) {
            return {
                label: `ASK ${formatQuantity(askQuantity)} ${asset} at ${formatPrice(bucketPrice)}`,
                colour: RENDER_PALETTE.ask,
            };
        }
        return { label: `nothing resting at ${formatPrice(bucketPrice)}`, colour: RENDER_PALETTE.inkMuted };
    }

    /**
     * How far the bucket sat from the middle of the book at that moment.
     *
     * Measured against the frame under the cursor rather than the live price, so
     * the answer stays true when the reader is looking at an hour ago.
     */
    private describeDistance(frame: LiquidityFrame, bucketPrice: number): ReadoutLine {
        const midPrice = (frame.bestBidPrice + frame.bestAskPrice) / 2;
        const delta = bucketPrice - midPrice;

        return {
            label: `${formatSignedPrice(delta)} · ${formatSignedPercent(delta / midPrice)} from mid`,
            colour: RENDER_PALETTE.inkMuted,
        };
    }

    /**
     * What actually traded in the bucket, split by which side was the aggressor.
     */
    private describeTrades(
        paint: PaintContext,
        price: number,
        timestampMs: number,
    ): readonly ReadoutLine[] {
        const cluster = findClusterAt(paint.request.dataset, price, timestampMs);
        if (cluster === null) {
            return [];
        }

        const sides: string[] = [];
        if (cluster.buyQuantity > 0) {
            sides.push(`buy ${formatQuantity(cluster.buyQuantity)}`);
        }
        if (cluster.sellQuantity > 0) {
            sides.push(`sell ${formatQuantity(cluster.sellQuantity)}`);
        }

        const lines: ReadoutLine[] = [{
            label: `traded ${sides.join(' · ')}`,
            colour: cluster.buyQuantity >= cluster.sellQuantity
                ? RENDER_PALETTE.bid
                : RENDER_PALETTE.ask,
        }];

        if (!paint.layout.isCompact) {
            lines.push({
                label: `${cluster.tradeCount}x · largest ${formatQuantity(cluster.largestTradeQuantity)}`,
                colour: RENDER_PALETTE.inkMuted,
            });
        }
        return lines;
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
        const boxWidth = widest + READOUT_PADDING_X * 2;
        const boxHeight = lines.length * READOUT_LINE_HEIGHT + READOUT_PADDING_Y * 2;
        const preferredX = pointer.x + READOUT_CURSOR_GAP;
        const boxX = preferredX + boxWidth > layout.plotWidth
            ? pointer.x - READOUT_CURSOR_GAP - boxWidth
            : preferredX;
        const boxY = Math.max(
            0,
            Math.min(pointer.y - boxHeight - READOUT_CURSOR_GAP, layout.plotHeight - boxHeight),
        );

        context.beginPath();
        context.roundRect(boxX, boxY, boxWidth, boxHeight, READOUT_CORNER_RADIUS);

        // The shadow lifts the box off the field; stroking under it would ring
        // the border in a halo, so the outline goes on after the state is back.
        context.save();
        context.shadowColor = RENDER_PALETTE.readoutShadow;
        context.shadowBlur = 14;
        context.shadowOffsetY = 3;
        context.fillStyle = RENDER_PALETTE.readoutBackdrop;
        context.fill();
        context.restore();

        context.strokeStyle = RENDER_PALETTE.hairline;
        context.lineWidth = 1;
        context.stroke();

        context.textAlign = 'left';
        context.textBaseline = 'middle';
        for (const [index, line] of lines.entries()) {
            context.fillStyle = line.colour;
            context.fillText(
                line.label,
                boxX + READOUT_PADDING_X,
                boxY + READOUT_PADDING_Y + READOUT_LINE_HEIGHT * (index + 0.5),
            );
        }
    }
}
