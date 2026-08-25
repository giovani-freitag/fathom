const priceFormatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
});

const compactFormatter = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
});

const quantityFormatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
});

const preciseQuantityFormatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
});

const axisTagFormatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
});

const clockFormatter = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
});

const dayFormatter = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: 'short',
});

const calendarFormatter = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
});

const signedPriceFormatter = new Intl.NumberFormat('en-US', {
    signDisplay: 'exceptZero',
    maximumFractionDigits: 0,
});

const signedPercentFormatter = new Intl.NumberFormat('en-US', {
    style: 'percent',
    signDisplay: 'exceptZero',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

/**
 * Renders a price for an axis label or readout.
 *
 * @param price - Price in quote currency.
 * @returns The formatted price.
 */
export function formatPrice(price: number): string {
    return priceFormatter.format(price);
}

/**
 * Renders a price for a tag pinned inside the price axis.
 *
 * @param price - Price in quote currency.
 * @returns The formatted price.
 */
export function formatAxisTagPrice(price: number): string {
    // One decimal, not two: the axis is only as wide as its widest label, and a
    // tag that overflows it is unreadable exactly when it matters most.
    return axisTagFormatter.format(price);
}

/**
 * Renders a resting or traded size compactly.
 *
 * @param quantity - Size in base currency.
 * @returns The formatted size, abbreviated above a thousand.
 */
export function formatQuantity(quantity: number): string {
    // Localised rather than fixed to a dot: the prices beside it separate
    // thousands with one, and `9.435` next to `80,750` reads as nine thousand.
    if (quantity >= 1_000) {
        return compactFormatter.format(quantity);
    }
    return quantity >= 10
        ? quantityFormatter.format(quantity)
        : preciseQuantityFormatter.format(quantity);
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1_000;
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1_000;
const ONE_HOUR_MS = 60 * 60 * 1_000;

/**
 * Renders a time axis label at the granularity the span calls for.
 *
 * @param timestampMs - Unix milliseconds.
 * @param spanMs - Width of the visible window, which decides the granularity.
 * @returns The formatted label.
 */
export function formatAxisTime(timestampMs: number, spanMs: number): string {
    const moment = new Date(timestampMs);
    if (spanMs > THREE_DAYS_MS) {
        return dayFormatter.format(moment);
    }
    // Across a window wide enough to cross midnight, a row of clock times gives
    // no way to tell which side of the wrap a wall was on.
    if (spanMs > SIX_HOURS_MS && isStartOfDay(moment)) {
        return dayFormatter.format(moment);
    }
    return clockFormatter.format(moment).slice(0, spanMs > ONE_HOUR_MS ? 5 : 8);
}

function isStartOfDay(moment: Date): boolean {
    return moment.getHours() === 0 && moment.getMinutes() === 0 && moment.getSeconds() === 0;
}

/**
 * Renders an instant as a wall clock reading, always to the second.
 *
 * @param timestampMs - Unix milliseconds.
 * @returns The formatted time of day.
 */
export function formatClockTime(timestampMs: number): string {
    return clockFormatter.format(new Date(timestampMs));
}

/**
 * Renders a duration as a human-readable span.
 *
 * @param durationMs - Length in milliseconds.
 * @returns The formatted duration, in the largest unit that fits.
 */
export function formatDuration(durationMs: number): string {
    const seconds = Math.round(durationMs / 1_000);
    if (seconds < 60) {
        return `${seconds}s`;
    }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
        return `${minutes}min`;
    }
    const hours = Math.round(minutes / 60);
    return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

/**
 * Quote currencies a perpetual's symbol can end in.
 */
const QUOTE_SUFFIXES = ['USDT', 'USDC', 'BUSD', 'USD'];

/**
 * The asset a contract is denominated in, read off its symbol.
 *
 * @param instrumentSymbol - Venue symbol, such as `BTCUSDT`.
 * @returns The base asset, or the whole symbol when no known quote is found.
 */
export function resolveBaseAsset(instrumentSymbol: string): string {
    const suffix = QUOTE_SUFFIXES.find((candidate) => instrumentSymbol.endsWith(candidate));
    return suffix === undefined ? instrumentSymbol : instrumentSymbol.slice(0, -suffix.length);
}

/**
 * Renders an instant as a full calendar date and wall clock reading.
 *
 * @param timestampMs - Unix milliseconds.
 * @returns The formatted moment.
 */
export function formatReadoutMoment(timestampMs: number): string {
    const moment = new Date(timestampMs);
    // Assembled from parts because the long form spells out separators that
    // cost half the width of the readout box.
    const calendar = calendarFormatter
        .formatToParts(moment)
        .filter((part) => part.type === 'day' || part.type === 'month' || part.type === 'year')
        .map((part) => part.value.replace('.', ''))
        .join(' ');

    return `${calendar} · ${clockFormatter.format(moment)}`;
}

/**
 * Renders a price difference with its direction attached.
 *
 * @param deltaPrice - Difference in quote currency, signed.
 * @returns The formatted difference, always carrying a sign.
 */
export function formatSignedPrice(deltaPrice: number): string {
    return signedPriceFormatter.format(deltaPrice);
}

/**
 * Renders a proportion of a price as a signed percentage.
 *
 * @param ratio - Difference expressed as a fraction of the reference price.
 * @returns The formatted percentage, always carrying a sign.
 */
export function formatSignedPercent(ratio: number): string {
    return signedPercentFormatter.format(ratio);
}
