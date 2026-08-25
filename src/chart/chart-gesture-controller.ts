import {
    type ChartViewport,
    panViewport,
    zoomViewportPrice,
    zoomViewportTime,
} from './chart-viewport.ts';
import type { PointerReadout } from './painting/heatmap-renderer.ts';
import type { ViewRequest } from './chart-controller.ts';

/** One wheel notch, chosen so a few clicks cross a zoom level without overshooting. */
const WHEEL_ZOOM_FACTOR = 1.18;

/** A pinch narrower than this is one finger's noise, not an intended scale. */
const MINIMUM_PINCH_DISTANCE_PX = 24;

/** How close to the clock the right edge must stay to count as still following. */
const LIVE_EDGE_TOLERANCE_MS = 5_000;

export interface SurfaceSize {
    readonly width: number;
    readonly height: number;
}

export interface ChartGestureControllerConfig {
    readonly surface: HTMLElement;
    readonly readViewport: () => ChartViewport;
    readonly readSurfaceSize: () => SurfaceSize;
    readonly onView: (request: ViewRequest) => void;
    readonly onPointerMove: (pointer: PointerReadout | null) => void;
}

interface PointerPosition {
    readonly x: number;
    readonly y: number;
}

interface DragOrigin {
    readonly viewport: ChartViewport;
    readonly pointer: PointerPosition;
}

interface PinchOrigin {
    readonly viewport: ChartViewport;
    readonly distanceX: number;
    readonly distanceY: number;
    readonly centroid: PointerPosition;
}

/**
 * Turns pointer, wheel, and touch input into viewport changes.
 *
 * Both gestures recompute from the viewport captured when the gesture began
 * rather than accumulating per event. Incremental application drifts under the
 * clamping the controller applies, which on a pinch shows up as the chart
 * sliding away under the fingers.
 */
export class ChartGestureController {
    private readonly config: ChartGestureControllerConfig;
    private readonly activePointers = new Map<number, PointerPosition>();

    private dragOrigin: DragOrigin | null = null;
    private pinchOrigin: PinchOrigin | null = null;
    private isAttached = false;

    constructor(config: ChartGestureControllerConfig) {
        this.config = config;
        this.handlePointerDown = this.handlePointerDown.bind(this);
        this.handlePointerMove = this.handlePointerMove.bind(this);
        this.handlePointerUp = this.handlePointerUp.bind(this);
        this.handlePointerLeave = this.handlePointerLeave.bind(this);
        this.handleWheel = this.handleWheel.bind(this);
        this.handleDoubleClick = this.handleDoubleClick.bind(this);
    }

    /**
     * Binds every input listener to the surface.
     */
    attach(): void {
        if (this.isAttached) {
            throw new Error('This gesture controller is already attached');
        }
        this.isAttached = true;

        const { surface } = this.config;
        surface.addEventListener('pointerdown', this.handlePointerDown);
        surface.addEventListener('pointermove', this.handlePointerMove);
        surface.addEventListener('pointerup', this.handlePointerUp);
        surface.addEventListener('pointercancel', this.handlePointerUp);
        surface.addEventListener('pointerleave', this.handlePointerLeave);
        surface.addEventListener('wheel', this.handleWheel, { passive: false });
        surface.addEventListener('dblclick', this.handleDoubleClick);
    }

    /**
     * Removes every listener and forgets any gesture in progress.
     */
    detach(): void {
        const { surface } = this.config;
        surface.removeEventListener('pointerdown', this.handlePointerDown);
        surface.removeEventListener('pointermove', this.handlePointerMove);
        surface.removeEventListener('pointerup', this.handlePointerUp);
        surface.removeEventListener('pointercancel', this.handlePointerUp);
        surface.removeEventListener('pointerleave', this.handlePointerLeave);
        surface.removeEventListener('wheel', this.handleWheel);
        surface.removeEventListener('dblclick', this.handleDoubleClick);

        this.activePointers.clear();
        this.dragOrigin = null;
        this.pinchOrigin = null;
        this.isAttached = false;
    }

    private handlePointerDown(event: PointerEvent): void {
        this.config.surface.setPointerCapture(event.pointerId);
        this.activePointers.set(event.pointerId, this.toLocalPosition(event));
        this.beginGesture();
    }

    private handlePointerMove(event: PointerEvent): void {
        const position = this.toLocalPosition(event);

        if (!this.activePointers.has(event.pointerId)) {
            this.config.onPointerMove(position);
            return;
        }

        this.activePointers.set(event.pointerId, position);
        if (this.activePointers.size >= 2) {
            this.applyPinch();
            return;
        }
        this.applyDrag(position);
        this.config.onPointerMove(position);
    }

    private handlePointerUp(event: PointerEvent): void {
        this.activePointers.delete(event.pointerId);
        if (this.config.surface.hasPointerCapture(event.pointerId)) {
            this.config.surface.releasePointerCapture(event.pointerId);
        }
        this.beginGesture();
    }

    private handlePointerLeave(): void {
        this.config.onPointerMove(null);
    }

    private handleWheel(event: WheelEvent): void {
        event.preventDefault();

        const size = this.config.readSurfaceSize();
        const position = this.toLocalPosition(event);
        const factor = event.deltaY > 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;

        // A trackpad pinch arrives as a wheel event with ctrlKey set, and reads
        // as a request to scale the whole view rather than just the time axis.
        const shouldZoomPrice = event.shiftKey || event.ctrlKey;
        const shouldZoomTime = !event.shiftKey;

        let viewport = this.config.readViewport();
        if (shouldZoomTime) {
            viewport = zoomViewportTime({
                viewport,
                anchorRatio: clampRatio(position.x / Math.max(1, size.width)),
                factor,
            });
        }
        if (shouldZoomPrice) {
            viewport = zoomViewportPrice({
                viewport,
                anchorRatio: clampRatio(position.y / Math.max(1, size.height)),
                factor,
            });
        }

        this.publish(viewport);
    }

    private handleDoubleClick(event: MouseEvent): void {
        event.preventDefault();

        const viewport = this.config.readViewport();
        const spanMs = viewport.toMs - viewport.fromMs;
        const nowMs = Date.now();

        this.config.onView({
            viewport: { ...viewport, fromMs: nowMs - spanMs, toMs: nowMs },
            surfaceWidthPx: this.config.readSurfaceSize().width,
            isFollowingLive: true,
        });
    }

    private beginGesture(): void {
        const positions = [...this.activePointers.values()];
        const viewport = this.config.readViewport();

        if (positions.length >= 2) {
            const [first, second] = positions as [PointerPosition, PointerPosition];
            this.dragOrigin = null;
            this.pinchOrigin = {
                viewport,
                distanceX: Math.abs(second.x - first.x),
                distanceY: Math.abs(second.y - first.y),
                centroid: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
            };
            return;
        }

        this.pinchOrigin = null;
        this.dragOrigin = positions[0] === undefined ? null : { viewport, pointer: positions[0] };
    }

    private applyDrag(position: PointerPosition): void {
        const origin = this.dragOrigin;
        if (origin === null) {
            return;
        }

        const size = this.config.readSurfaceSize();
        const spanMs = origin.viewport.toMs - origin.viewport.fromMs;
        const priceSpan = origin.viewport.highPrice - origin.viewport.lowPrice;

        this.publish(panViewport({
            viewport: origin.viewport,
            deltaMs: -((position.x - origin.pointer.x) / Math.max(1, size.width)) * spanMs,
            deltaPrice: ((position.y - origin.pointer.y) / Math.max(1, size.height)) * priceSpan,
        }));
    }

    private applyPinch(): void {
        const origin = this.pinchOrigin;
        const positions = [...this.activePointers.values()];
        if (origin === null || positions.length < 2) {
            return;
        }

        const [first, second] = positions as [PointerPosition, PointerPosition];
        const size = this.config.readSurfaceSize();
        const centroid = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };

        let viewport = zoomViewportTime({
            viewport: origin.viewport,
            anchorRatio: clampRatio(origin.centroid.x / Math.max(1, size.width)),
            factor: resolveScaleFactor(origin.distanceX, Math.abs(second.x - first.x)),
        });
        viewport = zoomViewportPrice({
            viewport,
            anchorRatio: clampRatio(origin.centroid.y / Math.max(1, size.height)),
            factor: resolveScaleFactor(origin.distanceY, Math.abs(second.y - first.y)),
        });

        const spanMs = viewport.toMs - viewport.fromMs;
        const priceSpan = viewport.highPrice - viewport.lowPrice;
        this.publish(panViewport({
            viewport,
            deltaMs: -((centroid.x - origin.centroid.x) / Math.max(1, size.width)) * spanMs,
            deltaPrice: ((centroid.y - origin.centroid.y) / Math.max(1, size.height)) * priceSpan,
        }));
    }

    private publish(viewport: ChartViewport): void {
        this.config.onView({
            viewport,
            surfaceWidthPx: this.config.readSurfaceSize().width,
            isFollowingLive: viewport.toMs >= Date.now() - LIVE_EDGE_TOLERANCE_MS,
        });
    }

    private toLocalPosition(event: PointerEvent | WheelEvent): PointerPosition {
        const bounds = this.config.surface.getBoundingClientRect();
        return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    }
}

function resolveScaleFactor(originDistance: number, currentDistance: number): number {
    if (originDistance < MINIMUM_PINCH_DISTANCE_PX || currentDistance < MINIMUM_PINCH_DISTANCE_PX) {
        return 1;
    }
    return originDistance / currentDistance;
}

function clampRatio(ratio: number): number {
    return Math.min(1, Math.max(0, ratio));
}
