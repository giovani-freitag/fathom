const RAMP_ENTRY_COUNT = 256;
const CHANNELS_PER_ENTRY = 4;

/**
 * Contrast of the logarithmic response.
 *
 * Tuned against real depth: on a liquid perpetual the typical bucket holds a few
 * percent of what a wall holds, and the whole point of the chart is that the
 * difference is obvious. A steeper curve lifts that typical bucket into the warm
 * half of the ramp and floods the field, leaving nothing for a wall to stand out
 * against.
 */
const LOG_CONTRAST = 4;

interface RampStop {
    readonly position: number;
    readonly red: number;
    readonly green: number;
    readonly blue: number;
    readonly alpha: number;
}

/**
 * Sounding palette: the abyss stays transparent, ordinary depth reads as cold
 * water, and only genuine walls climb into the hot end.
 */
const RAMP_STOPS: readonly RampStop[] = [
    { position: 0.00, red: 8, green: 16, blue: 30, alpha: 0 },
    { position: 0.06, red: 12, green: 28, blue: 56, alpha: 64 },
    { position: 0.18, red: 16, green: 60, blue: 104, alpha: 148 },
    { position: 0.34, red: 20, green: 104, blue: 132, alpha: 198 },
    { position: 0.50, red: 30, green: 158, blue: 150, alpha: 224 },
    { position: 0.62, red: 60, green: 200, blue: 140, alpha: 238 },
    { position: 0.72, red: 150, green: 215, blue: 85, alpha: 245 },
    { position: 0.82, red: 255, green: 205, blue: 75, alpha: 250 },
    { position: 0.90, red: 255, green: 140, blue: 60, alpha: 252 },
    { position: 0.96, red: 255, green: 66, blue: 62, alpha: 254 },
    { position: 1.00, red: 255, green: 238, blue: 232, alpha: 255 },
];

export interface DepthColourScaleConfig {
    /** Resting size below which the ramp stays at its cold, empty end. */
    readonly floorQuantity: number;
    /** Resting size that reaches the hot end of the ramp. */
    readonly saturationQuantity: number;
    /** Viewer multiplier applied before normalisation; above 1 brightens. */
    readonly gain: number;
}

/** The two cuts that decide which part of the distribution the ramp spends itself on. */
export interface DepthRange {
    readonly floorQuantity: number;
    readonly saturationQuantity: number;
}

/**
 * Turns resting size into a colour.
 *
 * The ramp itself is built once for the process; an instance only carries the
 * normalisation, so changing gain never rebuilds the table.
 */
export class DepthColourScale {
    private static rampCache: Uint8ClampedArray | null = null;

    private readonly floorQuantity: number;
    private readonly spanQuantity: number;
    private readonly gain: number;
    private readonly logDenominator: number;

    constructor(config: DepthColourScaleConfig) {
        this.floorQuantity = Math.max(0, config.floorQuantity);
        this.spanQuantity = Math.max(
            Number.EPSILON,
            config.saturationQuantity - this.floorQuantity,
        );
        this.gain = Math.max(Number.EPSILON, config.gain);
        this.logDenominator = Math.log1p(LOG_CONTRAST);
    }

    /**
     * Position of a resting size on the ramp.
     *
     * @param quantity - Resting size in base currency.
     * @returns An index from 0 to 255.
     */
    toRampIndex(quantity: number): number {
        // Everything under the floor is the market's background hum: quotes
        // placed and pulled by the second. Spending ramp on it lights the whole
        // field and leaves a real wall nothing to stand out against.
        if (quantity <= this.floorQuantity) {
            return 0;
        }
        const normalised = ((quantity - this.floorQuantity) / this.spanQuantity) * this.gain;
        const compressed = Math.log1p(Math.min(normalised, 1) * LOG_CONTRAST) / this.logDenominator;
        return Math.min(RAMP_ENTRY_COUNT - 1, Math.round(compressed * (RAMP_ENTRY_COUNT - 1)));
    }

    /**
     * The shared colour table.
     *
     * @returns 256 entries of RGBA, four bytes each.
     */
    static ramp(): Uint8ClampedArray {
        DepthColourScale.rampCache ??= buildRamp();
        return DepthColourScale.rampCache;
    }
}

/**
 * Resting size that should reach the hot end of the ramp for a window.
 *
 * A fixed ceiling is wrong at every zoom level: a one-minute window and a
 * two-week window differ by orders of magnitude in what counts as a wall. Taking
 * a high percentile instead of the maximum keeps one outlier from washing the
 * whole field out.
 *
 * @param quantities - Every non-empty bucket in the window.
 * @param percentile - Fraction from 0 to 1 to saturate at.
 * @returns The saturation quantity, or 1 when the window is empty.
 */
export function resolveSaturationQuantity(
    quantities: readonly number[],
    percentile: number,
): number {
    if (quantities.length === 0) {
        return 1;
    }
    const sorted = Float64Array.from(quantities).sort();
    return readPercentile(sorted, percentile);
}

/**
 * Both ends of the ramp for a window, from one sort.
 *
 * @param quantities - Every non-empty bucket in the window.
 * @param floorPercentile - Fraction below which size reads as empty.
 * @param saturationPercentile - Fraction at which size reaches the hot end.
 * @returns The two cuts, with the floor held below the saturation.
 */
export function resolveDepthRange(
    quantities: readonly number[],
    floorPercentile: number,
    saturationPercentile: number,
): DepthRange {
    if (quantities.length === 0) {
        return { floorQuantity: 0, saturationQuantity: 1 };
    }

    const sorted = Float64Array.from(quantities).sort();
    const saturationQuantity = readPercentile(sorted, saturationPercentile);

    return {
        floorQuantity: Math.min(readPercentile(sorted, floorPercentile), saturationQuantity / 2),
        saturationQuantity,
    };
}

function readPercentile(sorted: Float64Array, percentile: number): number {
    const index = Math.min(sorted.length - 1, Math.floor(sorted.length * percentile));
    return Math.max(Number.EPSILON, sorted[index]!);
}

function buildRamp(): Uint8ClampedArray {
    const ramp = new Uint8ClampedArray(RAMP_ENTRY_COUNT * CHANNELS_PER_ENTRY);

    for (let entry = 0; entry < RAMP_ENTRY_COUNT; entry += 1) {
        const position = entry / (RAMP_ENTRY_COUNT - 1);
        const { lower, upper } = locateStops(position);
        const stopSpan = upper.position - lower.position;
        const blend = stopSpan === 0 ? 0 : (position - lower.position) / stopSpan;
        const offset = entry * CHANNELS_PER_ENTRY;

        ramp[offset] = interpolate(lower.red, upper.red, blend);
        ramp[offset + 1] = interpolate(lower.green, upper.green, blend);
        ramp[offset + 2] = interpolate(lower.blue, upper.blue, blend);
        ramp[offset + 3] = interpolate(lower.alpha, upper.alpha, blend);
    }

    return ramp;
}

function locateStops(position: number): { lower: RampStop; upper: RampStop } {
    let lower = RAMP_STOPS[0]!;
    let upper = RAMP_STOPS[RAMP_STOPS.length - 1]!;

    for (let index = 0; index < RAMP_STOPS.length - 1; index += 1) {
        const candidate = RAMP_STOPS[index]!;
        const next = RAMP_STOPS[index + 1]!;
        if (position >= candidate.position && position <= next.position) {
            lower = candidate;
            upper = next;
            break;
        }
    }

    return { lower, upper };
}

function interpolate(from: number, to: number, blend: number): number {
    return from + (to - from) * blend;
}
