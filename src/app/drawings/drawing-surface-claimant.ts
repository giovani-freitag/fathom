import type { DrawingAnchor } from '../../shared/core/drawing.ts';
import type { PointerClaimant, PointerPosition } from '../core/chart-gesture-controller.ts';
import type { DrawingsController } from './drawings-controller.ts';
import { findAnchorAt, findDrawingAt } from './drawing-hit-test.ts';
import type { ViewportProjector } from '../core/viewport-projector.ts';

/**
 * How far a press has to travel before it is moving something.
 *
 * A click is never perfectly still — a hand twitches a pixel or two between
 * pressing and letting go — and without this every press meant to select a mark
 * nudges it off the price it was drawn about, one undo step at a time.
 */
export const DRAWING_DRAG_THRESHOLD_PX = 4;

export interface DrawingSurfaceClaimantConfig {
    readonly drawings: DrawingsController;
    /**
     * What turns surface pixels into chart coordinates right now.
     *
     * Read per press rather than held: the projection follows the viewport and
     * the surface size, and both move under a gesture.
     */
    readonly readProjector: () => ViewportProjector | null;
    /** The contract on the chart, so a press only meets marks drawn about it. */
    readonly readInstrumentSymbol: () => string | null;
}

/**
 * Turns presses over the plot into marks, when a mark is what they mean.
 */
export class DrawingSurfaceClaimant implements PointerClaimant {
    private readonly config: DrawingSurfaceClaimantConfig;
    /** Where the held press went down, for a move measured against it. */
    private pressedAt: PointerPosition | null = null;
    /** Set once the press has travelled far enough to be a drag rather than a click. */
    private hasTravelled = false;

    constructor(config: DrawingSurfaceClaimantConfig) {
        this.config = config;
    }

    /**
     * Takes the press when a tool is armed or a mark is under it.
     *
     * @param point - Where the press landed, in surface pixels.
     * @returns True when the gesture draws or moves rather than panning.
     */
    offerPress(point: PointerPosition): boolean {
        const anchor = this.toAnchor(point);
        if (anchor === null) {
            return false;
        }

        const { armedTool } = this.config.drawings.store.read();
        const grabbedAnchorIndex = armedTool === null ? this.findGrabbedAnchor(point) : null;
        // An end of the selected mark counts as that mark even when the pointer
        // is past where the line itself stops, which is where a grip half sits.
        const hitId = grabbedAnchorIndex === null
            ? this.findHit(point)
            : this.config.drawings.store.read().selectedId;
        if (armedTool === null && hitId === null) {
            // Declined, so the press pans. A reader pressing away from what they
            // had selected is a reader done with it.
            this.config.drawings.select(null);
            return false;
        }

        this.pressedAt = point;
        this.hasTravelled = false;
        this.config.drawings.begin({ anchor, hitId, grabbedAnchorIndex });
        return true;
    }

    /**
     * Carries the claimed gesture to where the pointer is now.
     *
     * @param point - Where the pointer is, in surface pixels.
     */
    moveClaim(point: PointerPosition): void {
        if (!this.hasTravelled && !this.hasLeft(point)) {
            return;
        }
        this.hasTravelled = true;

        const anchor = this.toAnchor(point);
        if (anchor !== null) {
            this.config.drawings.drag(anchor);
        }
    }

    /**
     * Ends the claimed gesture, keeping whatever it drew or moved.
     */
    settleClaim(): void {
        this.pressedAt = null;
        this.config.drawings.settle();
    }

    /**
     * What the pointer looks like resting over the plot.
     *
     * A mark under it is shown as something to grab, which is the whole of what
     * tells a reader they are on it: a line one pixel wide gives no other sign,
     * and pressing to find out moves the view when they have missed.
     *
     * @param point - Where the pointer is resting, in surface pixels.
     * @returns A CSS cursor, or null to leave the plot's own.
     */
    describeCursor(point: PointerPosition): string | null {
        if (this.config.drawings.store.read().armedTool !== null) {
            return null;
        }
        if (this.findGrabbedAnchor(point) !== null) {
            return 'grab';
        }
        return this.findHit(point) === null ? null : 'move';
    }

    /**
     * Which end of the selected mark is under the pointer, if any.
     *
     * Only the selected one has ends to grab: its grips are the only ones drawn,
     * and reshaping a mark by what looks like a press on it is not something a
     * reader asked for.
     */
    private findGrabbedAnchor(point: PointerPosition): number | null {
        const projector = this.config.readProjector();
        const { drawings, selectedId } = this.config.drawings.store.read();
        const selected = drawings.find((drawing) => drawing.id === selectedId);
        if (projector === null || selected === undefined) {
            return null;
        }
        return findAnchorAt({ drawing: selected, projector, point });
    }

    /**
     * Whether the pointer has left the press far enough behind to be dragging.
     */
    private hasLeft(point: PointerPosition): boolean {
        const from = this.pressedAt;
        if (from === null) {
            return true;
        }
        return Math.hypot(point.x - from.x, point.y - from.y) >= DRAWING_DRAG_THRESHOLD_PX;
    }

    /**
     * The mark under a point, among those drawn about this contract.
     */
    private findHit(point: PointerPosition): string | null {
        const projector = this.config.readProjector();
        const instrumentSymbol = this.config.readInstrumentSymbol();
        if (projector === null || instrumentSymbol === null) {
            return null;
        }

        return findDrawingAt({
            drawings: this.config.drawings.store.read().drawings.filter(
                (drawing) => drawing.instrumentSymbol === instrumentSymbol,
            ),
            projector,
            point,
        });
    }

    /**
     * Where a surface point sits in the chart's own coordinates.
     */
    private toAnchor(point: PointerPosition): DrawingAnchor | null {
        const projector = this.config.readProjector();
        if (projector === null) {
            return null;
        }
        return { atMs: projector.xToTime(point.x), price: projector.yToPrice(point.y) };
    }
}
