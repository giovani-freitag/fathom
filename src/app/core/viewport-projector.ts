import type { ChartViewport } from './chart-viewport.ts';

export interface ViewportProjectorConfig {
    readonly viewport: ChartViewport;
    readonly width: number;
    readonly height: number;
}

/**
 * Maps between chart coordinates and surface pixels.
 */
export class ViewportProjector {
    private readonly viewport: ChartViewport;
    private readonly width: number;
    private readonly height: number;
    private readonly spanMs: number;
    private readonly priceSpan: number;

    constructor(config: ViewportProjectorConfig) {
        this.viewport = config.viewport;
        this.width = config.width;
        this.height = config.height;
        this.spanMs = Math.max(1, config.viewport.toMs - config.viewport.fromMs);
        this.priceSpan = Math.max(Number.EPSILON, config.viewport.highPrice - config.viewport.lowPrice);
    }

    /**
     * How wide the plot is.
     *
     * Read by whatever is placed across the whole of it rather than at an
     * instant, which a projection from time cannot answer.
     */
    get plotWidth(): number {
        return this.width;
    }

    /**
     * Horizontal position of an instant.
     *
     * @param timestampMs - Unix milliseconds.
     * @returns The x coordinate, which may fall outside the surface.
     */
    timeToX(timestampMs: number): number {
        return ((timestampMs - this.viewport.fromMs) / this.spanMs) * this.width;
    }

    /**
     * Instant at a horizontal position.
     *
     * @param x - The x coordinate.
     * @returns Unix milliseconds.
     */
    xToTime(x: number): number {
        return this.viewport.fromMs + (x / this.width) * this.spanMs;
    }

    /**
     * Vertical position of a price, with price growing upward.
     *
     * @param price - Price in quote currency.
     * @returns The y coordinate, which may fall outside the surface.
     */
    priceToY(price: number): number {
        return ((this.viewport.highPrice - price) / this.priceSpan) * this.height;
    }

    /**
     * The vertical position a value sits at, reading it as a price.
     *
     * @param value - A price.
     * @returns A y in surface pixels.
     */
    valueToY(value: number): number {
        return this.priceToY(value);
    }

    /**
     * Price at a vertical position.
     *
     * @param y - The y coordinate.
     * @returns Price in quote currency.
     */
    yToPrice(y: number): number {
        return this.viewport.highPrice - (y / this.height) * this.priceSpan;
    }

    /**
     * Height on screen of one price bucket.
     *
     * @param priceBucketSize - Bucket height in quote currency.
     * @returns The height in pixels.
     */
    bucketHeight(priceBucketSize: number): number {
        return (priceBucketSize / this.priceSpan) * this.height;
    }
}
