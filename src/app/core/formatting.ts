const priceFormatter = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
});

const compactFormatter = new Intl.NumberFormat('pt-BR', {
    notation: 'compact',
    maximumFractionDigits: 1,
});

const quantityFormatter = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
});

const preciseQuantityFormatter = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
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

const calendarFormatter = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
});

const signedPriceFormatter = new Intl.NumberFormat('pt-BR', {
    signDisplay: 'exceptZero',
    maximumFractionDigits: 0,
});

const signedPercentFormatter = new Intl.NumberFormat('pt-BR', {
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
 * Localised rather than fixed to a dot, because the prices beside it separate
 * thousands with one: `9.435` next to `80.750` reads as nine thousand.
 *
 * @param quantity - Size in base currency.
 * @returns The formatted size, abbreviated above a thousand.
 */
export function formatQuantity(quantity: number): string {
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
 * A tick landing on midnight names its day rather than reading `00:00`. Over a
 * window wide enough to cross one, a row of clock times gives no way to tell
 * which side of the wrap a wall was on.
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
    if (spanMs > SIX_HOURS_MS && isStartOfDay(moment)) {
        return dayFormatter.format(moment);
    }
    return clockFormatter.format(moment).slice(0, spanMs > ONE_HOUR_MS ? 5 : 8);
}

function isStartOfDay(moment: Date): boolean {
    return moment.getHours() === 0 && moment.getMinutes() === 0 && moment.getSeconds() === 0;
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

/**
 * Quote currencies a perpetual's symbol can end in.
 *
 * Ordered longest first so `BTCUSDT` resolves against `USDT` rather than `USD`.
 */
const QUOTE_SUFFIXES = ['USDT', 'USDC', 'BUSD', 'USD'];

/**
 * The asset a contract is denominated in, read off its symbol.
 *
 * Sizes on this chart are in the base asset, and a bare number leaves the reader
 * guessing whether a wall of 316 is contracts, coins, or dollars.
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
 * The year is spelled out because a heatmap is read weeks after the fact as
 * often as live, and `24 ago` alone cannot say which year's flash crash this is.
 *
 * @param timestampMs - Unix milliseconds.
 * @returns The formatted moment.
 */
export function formatReadoutMoment(timestampMs: number): string {
    const moment = new Date(timestampMs);
    // Assembled from parts because pt-BR spells the long form as
    // `24 de ago. de 2026`, which is half the width of the readout box.
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
