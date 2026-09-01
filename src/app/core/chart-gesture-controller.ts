import {
    type ChartViewport,
    panViewport,
    zoomViewportPrice,
    zoomViewportTime,
} from './chart-viewport.ts';
import type { ChartLayout } from '../painting/render-types.ts';
import type { PointerReadout } from '../painting/heatmap-renderer.ts';
import type { ViewRequest } from './chart-controller.ts';

/** One wheel notch, chosen so a few clicks cross a zoom level without overshooting. */
/**
 * How long after the last notch a turn of the wheel counts as over.
 *
 * A wheel reports about every sixteen milliseconds while it is being turned, so
 * this is a notch and a half: long enough never to cut a continuous turn in two,
 * short enough that the reader is not left looking at the old picture.
 */
const WHEEL_SETTLE_MS = 90;

const WHEEL_ZOOM_FACTOR = 1.18;

/** A pinch narrower than this is one finger's noise, not an intended scale. */
const MINIMUM_PINCH_DISTANCE_PX = 24;

/** How close to the clock the right edge must stay to count as still following. */
const LIVE_EDGE_TOLERANCE_MS = 5_000;

/** Pointer travel along an axis that doubles the span it governs. */
const AXIS_SCALE_DISTANCE_PX = 180;

/**
 * Which band of the surface a gesture started on.
 */
type SurfaceRegion = 'plot' | 'price-scale' | 'time-scale';

/**
 * How far a press has to move to have been a pan rather than a tap.
 *
 * The same allowance a claimed press gets before it moves a mark: no hand is
 * perfectly still between pressing and letting go.
 */
const TAP_TRAVEL_TOLERANCE_PX = 4;

/**
 * Whether a press went far enough to have been a drag.
 *
 * @param from - Where it went down.
 * @param to - Where it came up.
 * @returns True when it travelled further than a hand's own tremor.
 */
function hasTravelled(from: PointerPosition, to: PointerPosition): boolean {
    return Math.hypot(to.x - from.x, to.y - from.y) >= TAP_TRAVEL_TOLERANCE_PX;
}

const REGION_CURSORS: Record<SurfaceRegion, string> = {
    plot: 'crosshair',
    'price-scale': 'ns-resize',
    'time-scale': 'ew-resize',
};

export interface SurfaceSize {
    readonly width: number;
    readonly height: number;
}

/**
 * Whoever gets first refusal on a press over the plot.
 *
 * A tool that draws and a mark that is being dragged both take the pointer that
 * would otherwise pan: without asking, arming a tool would move the view under
 * the very line the reader is trying to place.
 */
export interface PointerClaimant {
    /**
     * Offers it a press over the plot, before the viewport takes it.
     *
     * Offered rather than asked, so declining is something it hears about: a
     * press somewhere else is how a reader says they are done with what they
     * had selected.
     *
     * @param point - Where the press landed, in surface pixels.
     * @returns True to take the whole gesture.
     */
    offerPress(point: PointerPosition): boolean;
    /** Told where the pointer is while the claim is held. */
    moveClaim(point: PointerPosition): void;
    /** Told the claim is over. */
    settleClaim(): void;
    /**
     * Offered a press it declined that turned out to go nowhere.
     *
     * A press over the plot has to be free to pan, so what it landed on cannot
     * be decided when it goes down. A press that never moved was not a pan, and
     * this is the only point at which that is known.
     *
     * @param point - Where the press landed, in surface pixels.
     */
    offerTap(point: PointerPosition): void;
    /**
     * What the pointer should look like resting over the plot.
     *
     * Asked because the claimant is the only one that knows a press there would
     * mean something other than a pan, and a reader who cannot tell has to find
     * out by pressing.
     *
     * @param point - Where the pointer is resting, in surface pixels.
     * @returns A CSS cursor, or null to leave the region's own.
     */
    describeCursor(point: PointerPosition): string | null;
}

export interface ChartGestureControllerConfig {
    readonly surface: HTMLElement;
    readonly readViewport: () => ChartViewport;
    readonly readSurfaceSize: () => SurfaceSize;
    readonly readLayout: () => ChartLayout;
    readonly onView: (request: ViewRequest) => void;
    readonly onPointerMove: (pointer: PointerReadout | null) => void;
    /** Asked for when the reader double-clicks the price axis. */
    readonly onRefitPrice: () => void;
    /** Absent when nothing but the viewport wants the pointer. */
    readonly claimant?: PointerClaimant;
}

export interface PointerPosition {
    readonly x: number;
    readonly y: number;
}

interface DragOrigin {
    readonly viewport: ChartViewport;
    readonly pointer: PointerPosition;
    readonly region: SurfaceRegion;
}

interface PinchOrigin {
    readonly viewport: ChartViewport;
    readonly distanceX: number;
    readonly distanceY: number;
    readonly centroid: PointerPosition;
}

/**
 * Turns pointer, wheel, and touch input into viewport changes.
 */
export class ChartGestureController {
    private readonly config: ChartGestureControllerConfig;
    private readonly activePointers = new Map<number, PointerPosition>();

    private dragOrigin: DragOrigin | null = null;
    private pinchOrigin: PinchOrigin | null = null;
    private claimedPointerId: number | null = null;
    /** Running while a turn of the wheel may still be going on. */
    private wheelEndTimer: ReturnType<typeof setTimeout> | null = null;
    private isAttached = false;

    constructor(config: ChartGestureControllerConfig) {
        this.config = config;
        this.handlePointerDown = this.handlePointerDown.bind(this);
        this.handlePointerMove = this.handlePointerMove.bind(this);
        this.handlePointerUp = this.handlePointerUp.bind(this);
        this.handlePointerLeave = this.handlePointerLeave.bind(this);
        this.handleWheel = this.handleWheel.bind(this);
        this.handleDoubleClick = this.handleDoubleClick.bind(this);
        this.handleWheelEnd = this.handleWheelEnd.bind(this);
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
        this.claimedPointerId = null;
        this.isAttached = false;
        if (this.wheelEndTimer !== null) {
            clearTimeout(this.wheelEndTimer);
            this.wheelEndTimer = null;
        }
    }

    private handlePointerDown(event: PointerEvent): void {
        this.config.surface.setPointerCapture(event.pointerId);
        const position = this.toLocalPosition(event);

        // A second finger while one is drawing is a hand resting on the glass,
        // not a pinch: taking it would scale the view out from under the mark.
        if (this.claimedPointerId !== null) {
            return;
        }

        // Claimed presses never reach the pointer book, so no drag and no pinch
        // can be built from one: the view holds still while the reader draws.
        if (this.resolveRegion(position) === 'plot' && this.config.claimant?.offerPress(position) === true) {
            this.claimedPointerId = event.pointerId;
            return;
        }

        this.activePointers.set(event.pointerId, position);
        this.beginGesture();
    }

    private handlePointerMove(event: PointerEvent): void {
        const position = this.toLocalPosition(event);

        if (this.claimedPointerId === event.pointerId) {
            this.config.claimant?.moveClaim(position);
            this.config.onPointerMove(position);
            return;
        }

        if (!this.activePointers.has(event.pointerId)) {
            this.config.surface.style.cursor = this.resolveCursor(position);
            this.config.onPointerMove(position);
            return;
        }

        this.activePointers.set(event.pointerId, position);
        if (this.activePointers.size >= 2) {
            this.applyPinch();
            return;
        }

        this.applyDrag(position);
        if (this.dragOrigin?.region === 'plot') {
            this.config.onPointerMove(position);
        }
    }

    private handlePointerUp(event: PointerEvent): void {
        const position = this.toLocalPosition(event);
        this.activePointers.delete(event.pointerId);
        if (this.config.surface.hasPointerCapture(event.pointerId)) {
            this.config.surface.releasePointerCapture(event.pointerId);
        }

        if (this.claimedPointerId === event.pointerId) {
            this.claimedPointerId = null;
            this.config.claimant?.settleClaim();
            return;
        }

        const origin = this.dragOrigin;
        if (origin !== null && origin.region === 'plot' && !hasTravelled(origin.pointer, position)) {
            this.config.claimant?.offerTap(position);
        }
        this.beginGesture();

        // Said once the hand has left, so whatever the view now needs can be
        // asked for straight away. Everything a drag writes before this is one
        // frame of a movement still happening, and asking on each of those is
        // what the settling time exists to stop.
        if (this.activePointers.size === 0) {
            this.config.onView({
                viewport: this.config.readViewport(),
                surfaceWidthPx: this.config.readSurfaceSize().width,
                pricePaneHeightPx: this.config.readLayout().pricePaneHeight,
                isGestureOver: true,
            });
        }
    }

    private handlePointerLeave(): void {
        this.config.onPointerMove(null);
    }

    private handleWheel(event: WheelEvent): void {
        event.preventDefault();

        const plot = this.config.readLayout();
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
                anchorRatio: clampRatio(position.x / Math.max(1, plot.plotWidth)),
                factor,
            });
        }
        if (shouldZoomPrice) {
            viewport = zoomViewportPrice({
                viewport,
                anchorRatio: clampRatio(position.y / Math.max(1, plot.pricePaneHeight)),
                factor,
            });
        }

        this.publish(viewport);
        this.awaitWheelEnd();
    }

    /**
     * Says a turn of the wheel is over once no more of it arrives.
     *
     * A wheel has no lifting hand to say when it has finished, so without this
     * every zoom pays the settling time in full — a fifth of a second of the
     * old picture after the reader has stopped turning. A notch and a half at
     * the rate a wheel reports is long enough that a continuous turn is never
     * cut in two.
     */
    private awaitWheelEnd(): void {
        if (this.wheelEndTimer !== null) {
            clearTimeout(this.wheelEndTimer);
        }
        this.wheelEndTimer = setTimeout(this.handleWheelEnd, WHEEL_SETTLE_MS);
    }

    private handleWheelEnd(): void {
        this.wheelEndTimer = null;
        this.config.onView({
            viewport: this.config.readViewport(),
            surfaceWidthPx: this.config.readSurfaceSize().width,
            pricePaneHeightPx: this.config.readLayout().pricePaneHeight,
            isGestureOver: true,
        });
    }

    private handleDoubleClick(event: MouseEvent): void {
        event.preventDefault();

        // On the price axis it means the axis, which is the only way back from
        // a band the reader has dragged or one a wide window has widened.
        if (this.resolveRegion(this.toLocalPosition(event)) === 'price-scale') {
            this.config.onRefitPrice();
            return;
        }

        const viewport = this.config.readViewport();
        const spanMs = viewport.toMs - viewport.fromMs;
        const nowMs = Date.now();

        this.config.onView({
            viewport: { ...viewport, fromMs: nowMs - spanMs, toMs: nowMs },
            surfaceWidthPx: this.config.readSurfaceSize().width,
            pricePaneHeightPx: this.config.readLayout().pricePaneHeight,
            isFollowingLive: true,
            isFollowingPrice: true,
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
        const pointer = positions[0];
        this.dragOrigin = pointer === undefined
            ? null
            : { viewport, pointer, region: this.resolveRegion(pointer) };
    }

    /**
     * Which band the given point falls in.
     */
    /**
     * What the pointer looks like where it is resting.
     */
    private resolveCursor(position: PointerPosition): string {
        const region = this.resolveRegion(position);
        if (region !== 'plot') {
            return REGION_CURSORS[region];
        }
        return this.config.claimant?.describeCursor(position) ?? REGION_CURSORS.plot;
    }

    private resolveRegion(position: PointerPosition): SurfaceRegion {
        const layout = this.config.readLayout();
        const priceScaleX = layout.isCompact ? layout.priceAxisX : layout.profileX;

        if (position.x >= priceScaleX) {
            return 'price-scale';
        }
        if (!layout.isCompact && position.y >= layout.paneStackHeight) {
            return 'time-scale';
        }
        return 'plot';
    }

    private applyDrag(position: PointerPosition): void {
        const origin = this.dragOrigin;
        if (origin === null) {
            return;
        }

        if (origin.region === 'price-scale') {
            this.applyPriceScaleDrag(origin, position);
            return;
        }
        if (origin.region === 'time-scale') {
            this.applyTimeScaleDrag(origin, position);
            return;
        }
        this.applyPan(origin, position);
    }

    private applyPriceScaleDrag(origin: DragOrigin, position: PointerPosition): void {
        this.publish(zoomViewportPrice({
            viewport: origin.viewport,
            anchorRatio: 0.5,
            factor: resolveAxisScaleFactor(position.y - origin.pointer.y),
        }));
    }

    private applyTimeScaleDrag(origin: DragOrigin, position: PointerPosition): void {
        // Anchored at the right edge so stretching time does not push the live
        // edge out of view, which is where the reader is looking.
        this.publish(zoomViewportTime({
            viewport: origin.viewport,
            anchorRatio: 1,
            factor: resolveAxisScaleFactor(origin.pointer.x - position.x),
        }));
    }

    private applyPan(origin: DragOrigin, position: PointerPosition): void {
        const plot = this.config.readLayout();
        const spanMs = origin.viewport.toMs - origin.viewport.fromMs;
        const priceSpan = origin.viewport.highPrice - origin.viewport.lowPrice;

        this.publish(panViewport({
            viewport: origin.viewport,
            deltaMs: -((position.x - origin.pointer.x) / Math.max(1, plot.plotWidth)) * spanMs,
            deltaPrice: ((position.y - origin.pointer.y) / Math.max(1, plot.pricePaneHeight)) * priceSpan,
        }));
    }

    private applyPinch(): void {
        const origin = this.pinchOrigin;
        const positions = [...this.activePointers.values()];
        if (origin === null || positions.length < 2) {
            return;
        }

        const [first, second] = positions as [PointerPosition, PointerPosition];
        const plot = this.config.readLayout();
        const centroid = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };

        let viewport = zoomViewportTime({
            viewport: origin.viewport,
            anchorRatio: clampRatio(origin.centroid.x / Math.max(1, plot.plotWidth)),
            factor: resolveScaleFactor(origin.distanceX, Math.abs(second.x - first.x)),
        });
        viewport = zoomViewportPrice({
            viewport,
            anchorRatio: clampRatio(origin.centroid.y / Math.max(1, plot.pricePaneHeight)),
            factor: resolveScaleFactor(origin.distanceY, Math.abs(second.y - first.y)),
        });

        const spanMs = viewport.toMs - viewport.fromMs;
        const priceSpan = viewport.highPrice - viewport.lowPrice;
        this.publish(panViewport({
            viewport,
            deltaMs: -((centroid.x - origin.centroid.x) / Math.max(1, plot.plotWidth)) * spanMs,
            deltaPrice: ((centroid.y - origin.centroid.y) / Math.max(1, plot.pricePaneHeight)) * priceSpan,
        }));
    }

    /**
     * Hands a gesture's viewport to the controller.
     */
    private publish(viewport: ChartViewport): void {
        const current = this.config.readViewport();
        const didChoosePriceBand = viewport.lowPrice !== current.lowPrice
            || viewport.highPrice !== current.highPrice;

        this.config.onView({
            viewport,
            surfaceWidthPx: this.config.readSurfaceSize().width,
            pricePaneHeightPx: this.config.readLayout().pricePaneHeight,
            isFollowingLive: viewport.toMs >= Date.now() - LIVE_EDGE_TOLERANCE_MS,
            ...(didChoosePriceBand ? { isFollowingPrice: false } : {}),
        });
    }

    private toLocalPosition(event: MouseEvent): PointerPosition {
        const bounds = this.config.surface.getBoundingClientRect();
        return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    }
}

/**
 * Turns pointer travel along an axis into a span multiplier.
 *
 * @param travelPx - Pixels dragged in the direction that widens the span.
 * @returns The factor to scale the span by.
 */
function resolveAxisScaleFactor(travelPx: number): number {
    return Math.exp(travelPx / AXIS_SCALE_DISTANCE_PX);
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
