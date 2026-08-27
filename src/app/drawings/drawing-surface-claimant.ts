import type { DrawingAnchor } from '../../shared/core/drawing.ts';
import type { PointerClaimant, PointerPosition } from '../core/chart-gesture-controller.ts';
import type { DrawingsController } from './drawings-controller.ts';
import { findDrawingAt } from './drawing-hit-test.ts';
import type { ViewportProjector } from '../core/viewport-projector.ts';

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
        const hitId = this.findHit(point);
        if (armedTool === null && hitId === null) {
            // Declined, so the press pans. A reader pressing away from what they
            // had selected is a reader done with it.
            this.config.drawings.select(null);
            return false;
        }

        this.config.drawings.begin({ anchor, hitId });
        return true;
    }

    /**
     * Carries the claimed gesture to where the pointer is now.
     *
     * @param point - Where the pointer is, in surface pixels.
     */
    moveClaim(point: PointerPosition): void {
        const anchor = this.toAnchor(point);
        if (anchor !== null) {
            this.config.drawings.drag(anchor);
        }
    }

    /**
     * Ends the claimed gesture, keeping whatever it drew or moved.
     */
    settleClaim(): void {
        this.config.drawings.settle();
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
