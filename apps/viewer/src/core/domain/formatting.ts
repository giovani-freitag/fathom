const priceFormatter = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
});

const compactFormatter = new Intl.NumberFormat('pt-BR', {
    notation: 'compact',
    maximumFractionDigits: 1,
});

const axisTagFormatter = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
});

const clockFormatter = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
});

const dayFormatter = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
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
 * One decimal rather than two: the axis is only as wide as its widest label, and
 * a tag that overflows it is unreadable exactly when it matters most.
 *
 * @param price - Price in quote currency.
 * @returns The formatted price.
 */
export function formatAxisTagPrice(price: number): string {
    return axisTagFormatter.format(price);
}

/**
 * Renders a resting or traded size compactly.
 *
 * @param quantity - Size in base currency.
 * @returns The formatted size, abbreviated above a thousand.
 */
export function formatQuantity(quantity: number): string {
    if (quantity >= 1_000) {
        return compactFormatter.format(quantity);
    }
    return quantity.toFixed(quantity >= 10 ? 1 : 3);
}

/**
 * Renders a time axis label at the granularity the span calls for.
 *
 * @param timestampMs - Unix milliseconds.
 * @param spanMs - Width of the visible window, which decides the granularity.
 * @returns The formatted label.
 */
export function formatAxisTime(timestampMs: number, spanMs: number): string {
    const moment = new Date(timestampMs);
    if (spanMs > 3 * 24 * 60 * 60 * 1_000) {
        return dayFormatter.format(moment);
    }
    return clockFormatter.format(moment).slice(0, spanMs > 60 * 60 * 1_000 ? 5 : 8);
}

/**
 * Renders an instant as a wall clock reading.
 *
 * Always to the second, unlike the axis labels: the crosshair exists to answer
 * "when exactly", and a label rounded to the minute cannot.
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
