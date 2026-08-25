import type { ResolvedTheme } from '../core/theme.ts';

const RAMP_ENTRY_COUNT = 256;
const CHANNELS_PER_ENTRY = 4;

/**
 * Contrast of the logarithmic response.
 */
const LOG_CONTRAST = 4;

interface RampStop {
    readonly position: number;
    readonly red: number;
    readonly green: number;
    readonly blue: number;
    readonly alpha: number;
}

// Sounding palette: the abyss stays transparent, ordinary depth reads as cold
// water, and only a genuine wall climbs into the hot end.
const DARK_RAMP_STOPS: readonly RampStop[] = [
    { position: 0.000, red: 8, green: 16, blue: 30, alpha: 0 },
    { position: 0.120, red: 12, green: 26, blue: 52, alpha: 56 },
    { position: 0.320, red: 14, green: 44, blue: 80, alpha: 110 },
    { position: 0.520, red: 17, green: 66, blue: 110, alpha: 155 },
    { position: 0.680, red: 22, green: 100, blue: 138, alpha: 190 },
    { position: 0.790, red: 30, green: 145, blue: 155, alpha: 215 },
    { position: 0.860, red: 60, green: 190, blue: 140, alpha: 232 },
    { position: 0.910, red: 160, green: 212, blue: 95, alpha: 242 },
    { position: 0.950, red: 255, green: 200, blue: 80, alpha: 248 },
    { position: 0.975, red: 255, green: 135, blue: 58, alpha: 251 },
    { position: 0.990, red: 255, green: 62, blue: 58, alpha: 253 },
    { position: 1.000, red: 255, green: 238, blue: 230, alpha: 255 },
];

// The same climb read against paper: the cold end has to darken instead of
// lighten, because on a pale ground a lighter colour reads as less depth.
const LIGHT_RAMP_STOPS: readonly RampStop[] = [
    { position: 0.000, red: 196, green: 216, blue: 236, alpha: 0 },
    { position: 0.120, red: 150, green: 185, blue: 225, alpha: 26 },
    { position: 0.320, red: 96, green: 150, blue: 210, alpha: 58 },
    { position: 0.520, red: 46, green: 116, blue: 190, alpha: 96 },
    { position: 0.680, red: 20, green: 104, blue: 172, alpha: 136 },
    { position: 0.790, red: 12, green: 132, blue: 150, alpha: 176 },
    { position: 0.860, red: 20, green: 152, blue: 104, alpha: 206 },
    { position: 0.910, red: 112, green: 168, blue: 44, alpha: 228 },
    { position: 0.950, red: 222, green: 148, blue: 16, alpha: 242 },
    { position: 0.975, red: 226, green: 94, blue: 20, alpha: 250 },
    { position: 0.990, red: 206, green: 28, blue: 40, alpha: 254 },
    { position: 1.000, red: 122, green: 8, blue: 28, alpha: 255 },
];

const RAMP_STOPS_BY_THEME: Record<ResolvedTheme, readonly RampStop[]> = {
    dark: DARK_RAMP_STOPS,
    light: LIGHT_RAMP_STOPS,
};

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
 */
export class DepthColourScale {
    private static rampCache: Uint8ClampedArray | null = null;
    private static rampTheme: ResolvedTheme = 'dark';

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
        DepthColourScale.rampCache ??= buildRamp(DepthColourScale.rampTheme);
        return DepthColourScale.rampCache;
    }

    /**
     * Points the shared table at a theme, rebuilt on the next paint.
     *
     * @param theme - The theme to build the ramp for.
     */
    static applyTheme(theme: ResolvedTheme): void {
        if (theme === DepthColourScale.rampTheme) {
            return;
        }
        DepthColourScale.rampTheme = theme;
        DepthColourScale.rampCache = null;
    }
}

/**
 * Resting size that should reach the hot end of the ramp for a window.
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

function buildRamp(theme: ResolvedTheme): Uint8ClampedArray {
    const stops = RAMP_STOPS_BY_THEME[theme];
    const ramp = new Uint8ClampedArray(RAMP_ENTRY_COUNT * CHANNELS_PER_ENTRY);

    for (let entry = 0; entry < RAMP_ENTRY_COUNT; entry += 1) {
        const position = entry / (RAMP_ENTRY_COUNT - 1);
        const { lower, upper } = locateStops(stops, position);
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

function locateStops(
    stops: readonly RampStop[],
    position: number,
): { lower: RampStop; upper: RampStop } {
    let lower = stops[0]!;
    let upper = stops[stops.length - 1]!;

    for (let index = 0; index < stops.length - 1; index += 1) {
        const candidate = stops[index]!;
        const next = stops[index + 1]!;
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
