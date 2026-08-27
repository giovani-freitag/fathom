/** The slice of time and price currently on screen. */
export interface ChartViewport {
    readonly fromMs: number;
    readonly toMs: number;
    readonly lowPrice: number;
    readonly highPrice: number;
}

/**
 * The narrowest window a chart opens on, however little has been recorded.
 *
 * The same as the narrowest span offered: below it a reader is looking at slabs
 * rather than a chart, and a recording that has just started is exactly when
 * they most need it to look like one.
 */
/** Hard bounds a viewport is never allowed past. */
export interface ViewportBounds {
    readonly earliestMs: number;
    readonly latestMs: number;
    readonly minimumSpanMs: number;
    readonly maximumSpanMs: number;
    readonly minimumPriceSpan: number;
}

export interface ViewportPanRequest {
    readonly viewport: ChartViewport;
    readonly deltaMs: number;
    readonly deltaPrice: number;
}

export interface ViewportZoomRequest {
    readonly viewport: ChartViewport;
    /** Where the gesture is anchored, as a 0..1 fraction of the axis. */
    readonly anchorRatio: number;
    /** Above 1 widens the span, below 1 narrows it. */
    readonly factor: number;
}

/**
 * Slides a viewport without changing either span.
 *
 * @param request - The viewport and the offsets to apply.
 * @returns The shifted viewport.
 */
export function panViewport(request: ViewportPanRequest): ChartViewport {
    const { viewport, deltaMs, deltaPrice } = request;
    return {
        fromMs: viewport.fromMs + deltaMs,
        toMs: viewport.toMs + deltaMs,
        lowPrice: viewport.lowPrice + deltaPrice,
        highPrice: viewport.highPrice + deltaPrice,
    };
}

/**
 * Scales the time span around an anchor.
 *
 * @param request - The viewport, the anchor, and the scale factor.
 * @returns The zoomed viewport.
 */
export function zoomViewportTime(request: ViewportZoomRequest): ChartViewport {
    const { viewport, anchorRatio, factor } = request;
    const spanMs = viewport.toMs - viewport.fromMs;
    const anchorMs = viewport.fromMs + spanMs * anchorRatio;
    const nextSpanMs = spanMs * factor;

    return {
        ...viewport,
        fromMs: anchorMs - nextSpanMs * anchorRatio,
        toMs: anchorMs + nextSpanMs * (1 - anchorRatio),
    };
}

/**
 * Scales the price span around an anchor.
 *
 * @param request - The viewport, the anchor, and the scale factor.
 * @returns The zoomed viewport.
 */
export function zoomViewportPrice(request: ViewportZoomRequest): ChartViewport {
    const { viewport, anchorRatio, factor } = request;
    const span = viewport.highPrice - viewport.lowPrice;
    // The anchor arrives as a fraction down the surface, and price grows upward.
    const anchorPrice = viewport.highPrice - span * anchorRatio;
    const nextSpan = span * factor;

    return {
        ...viewport,
        highPrice: anchorPrice + nextSpan * anchorRatio,
        lowPrice: anchorPrice - nextSpan * (1 - anchorRatio),
    };
}

/**
 * Pulls a viewport back inside its bounds.
 *
 * @param viewport - The viewport to constrain.
 * @param bounds - The limits to respect.
 * @returns A viewport within bounds, preserving the requested span where possible.
 */
export function clampViewport(viewport: ChartViewport, bounds: ViewportBounds): ChartViewport {
    // A span wider than the whole allowed range has nowhere to sit: pushing its
    // start back to the earliest would push its end past the clock, and the
    // chart would show empty future instead of what it was asked for.
    //
    // It used to be floored at a minute as well, so an archive seconds old did
    // not open on seconds of slabs. That floor is gone with the reason for it:
    // the range now reaches back to where candles are published rather than to
    // the first frame recorded, so it is never seconds wide.
    const availableSpanMs = bounds.latestMs - bounds.earliestMs;
    const requestedSpanMs = viewport.toMs - viewport.fromMs;
    const spanMs = Math.min(
        Math.max(requestedSpanMs, bounds.minimumSpanMs),
        bounds.maximumSpanMs,
        availableSpanMs,
    );

    let fromMs = viewport.fromMs;
    if (fromMs + spanMs > bounds.latestMs) {
        fromMs = bounds.latestMs - spanMs;
    }
    if (fromMs < bounds.earliestMs) {
        fromMs = bounds.earliestMs;
    }

    const priceSpan = Math.max(viewport.highPrice - viewport.lowPrice, bounds.minimumPriceSpan);
    const priceCentre = (viewport.highPrice + viewport.lowPrice) / 2;

    return {
        fromMs,
        toMs: fromMs + spanMs,
        lowPrice: priceCentre - priceSpan / 2,
        highPrice: priceCentre + priceSpan / 2,
    };
}
