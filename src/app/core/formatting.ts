import type { Locale } from '../i18n/locale.ts';
import type { Translate } from '../i18n/translator.ts';

/** The tag each supported language formats numbers and dates under. */
const FORMATTING_TAGS: Record<Locale, string> = {
    'en': 'en-US',
    'pt-BR': 'pt-BR',
};

interface Formatters {
    readonly price: Intl.NumberFormat;
    readonly compact: Intl.NumberFormat;
    readonly quantity: Intl.NumberFormat;
    readonly preciseQuantity: Intl.NumberFormat;
    readonly axisTag: Intl.NumberFormat;
    readonly wholeAxisTag: Intl.NumberFormat;
    readonly clock: Intl.DateTimeFormat;
    readonly day: Intl.DateTimeFormat;
    readonly calendar: Intl.DateTimeFormat;
    readonly signedPrice: Intl.NumberFormat;
    readonly signedChange: Intl.NumberFormat;
    readonly signedPercent: Intl.NumberFormat;
}

function buildFormatters(tag: string): Formatters {
    return {
        price: new Intl.NumberFormat(tag, { minimumFractionDigits: 0, maximumFractionDigits: 2 }),
        compact: new Intl.NumberFormat(tag, { notation: 'compact', maximumFractionDigits: 1 }),
        quantity: new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
        preciseQuantity: new Intl.NumberFormat(tag, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
        axisTag: new Intl.NumberFormat(tag, { minimumFractionDigits: 0, maximumFractionDigits: 1 }),
        // The same tag on a narrow axis, which has no room for the decimal.
        wholeAxisTag: new Intl.NumberFormat(tag, { maximumFractionDigits: 0 }),
        // Pinned to twenty-four hours in every language: a market chart reads
        // times against each other, and the axis truncates the clock by
        // character count, which a trailing AM would carry into the label.
        clock: new Intl.DateTimeFormat(tag, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        }),
        day: new Intl.DateTimeFormat(tag, { day: '2-digit', month: 'short' }),
        calendar: new Intl.DateTimeFormat(tag, { day: '2-digit', month: 'short', year: 'numeric' }),
        signedPrice: new Intl.NumberFormat(tag, { signDisplay: 'exceptZero', maximumFractionDigits: 0 }),
        // Two decimals where a price has them: a bar that moved half a unit did
        // not move one, and rounding it away is the difference between a doji
        // and a body.
        signedChange: new Intl.NumberFormat(tag, {
            signDisplay: 'exceptZero',
            maximumFractionDigits: 2,
        }),
        signedPercent: new Intl.NumberFormat(tag, {
            style: 'percent',
            signDisplay: 'exceptZero',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }),
    };
}

let formatters = buildFormatters(FORMATTING_TAGS.en);

/** Built on demand, because the digit counts callers ask for are open-ended. */
const fixedFormatters = new Map<number, Intl.NumberFormat>();
let formattingTag = FORMATTING_TAGS.en;

/**
 * Re-points every number and date on screen at a language.
 *
 * @param locale - The language the interface is being read in.
 */
export function applyFormattingLocale(locale: Locale): void {
    formattingTag = FORMATTING_TAGS[locale];
    formatters = buildFormatters(formattingTag);
    fixedFormatters.clear();
}

/**
 * Renders a number to a fixed number of decimals, in the reader's language.
 *
 * @param value - The number to render.
 * @param fractionDigits - How many decimals to show, padded when short.
 * @returns The formatted number.
 */
export function formatFixed(value: number, fractionDigits: number): string {
    let formatter = fixedFormatters.get(fractionDigits);
    if (formatter === undefined) {
        formatter = new Intl.NumberFormat(formattingTag, {
            minimumFractionDigits: fractionDigits,
            maximumFractionDigits: fractionDigits,
        });
        fixedFormatters.set(fractionDigits, formatter);
    }
    return formatter.format(value);
}

/**
 * Renders a price for an axis label or readout.
 *
 * @param price - Price in quote currency.
 * @returns The formatted price.
 */
export function formatPrice(price: number): string {
    return formatters.price.format(price);
}

/**
 * Renders a price for a tag pinned inside the price axis.
 *
 * @param price - Price in quote currency.
 * @returns The formatted price.
 */
export function formatAxisTagPrice(price: number, isCompact = false): string {
    // One decimal, not two: the axis is only as wide as its widest label, and a
    // tag that overflows it is unreadable exactly when it matters most.
    //
    // None at all on a phone, where the axis is narrower than the decimal fits.
    // The unit is kept, so the tag is still exact to inside one price bucket,
    // and the figure to the tenth is a touch away in the readout.
    return isCompact
        ? formatters.wholeAxisTag.format(price)
        : formatters.axisTag.format(price);
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
        return formatters.compact.format(quantity);
    }
    return quantity >= 10
        ? formatters.quantity.format(quantity)
        : formatters.preciseQuantity.format(quantity);
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
export function formatAxisTime(
    timestampMs: number,
    spanMs: number,
    previousTickMs?: number,
): string {
    const moment = new Date(timestampMs);
    if (spanMs > THREE_DAYS_MS) {
        return formatters.day.format(moment);
    }
    // Across a window wide enough to cross midnight, a row of clock times gives
    // no way to tell which side of the wrap a wall was on.
    //
    // The first tick of each day carries the date, rather than a tick that
    // happens to land on midnight. A grid that steps by six hours from some
    // other hour never lands on one, and a phone showing three ticks over three
    // days showed the same clock reading three times and no date at all.
    if (spanMs > SIX_HOURS_MS && opensADay(moment, previousTickMs)) {
        return formatters.day.format(moment);
    }
    return formatters.clock.format(moment).slice(0, spanMs > ONE_HOUR_MS ? 5 : 8);
}

/**
 * Whether a tick is the first of its day among the ticks being drawn.
 */
function opensADay(moment: Date, previousTickMs: number | undefined): boolean {
    if (previousTickMs === undefined) {
        return true;
    }
    const previous = new Date(previousTickMs);
    return previous.getDate() !== moment.getDate()
        || previous.getMonth() !== moment.getMonth()
        || previous.getFullYear() !== moment.getFullYear();
}

/**
 * Renders an instant as a wall clock reading, always to the second.
 *
 * @param timestampMs - Unix milliseconds.
 * @returns The formatted time of day.
 */
export function formatClockTime(timestampMs: number): string {
    return formatters.clock.format(new Date(timestampMs));
}

/**
 * Renders a duration in the largest unit that fits it.
 *
 * @param durationMs - Length in milliseconds.
 * @param translate - Renders the unit, which every language abbreviates its own way.
 * @returns The formatted duration.
 */
export function formatDuration(durationMs: number, translate: Translate): string {
    const seconds = Math.round(durationMs / 1_000);
    if (seconds < 60) {
        return translate('unit.seconds', { value: seconds });
    }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
        return translate('unit.minutes', { value: minutes });
    }
    const hours = Math.round(minutes / 60);
    return hours < 48
        ? translate('unit.hours', { value: hours })
        : translate('unit.days', { value: Math.round(hours / 24) });
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
    const calendar = formatters.calendar
        .formatToParts(moment)
        .filter((part) => part.type === 'day' || part.type === 'month' || part.type === 'year')
        .map((part) => part.value.replace('.', ''))
        .join(' ');

    return `${calendar} · ${formatters.clock.format(moment)}`;
}

/**
 * Renders a price difference with its direction attached.
 *
 * @param deltaPrice - Difference in quote currency, signed.
 * @returns The formatted difference, always carrying a sign.
 */
export function formatSignedPrice(deltaPrice: number): string {
    return formatters.signedPrice.format(deltaPrice);
}

/**
 * Renders how far a price moved, to the precision a price carries.
 *
 * @param deltaPrice - Difference in quote currency, signed.
 * @returns The formatted difference, always carrying a sign.
 */
export function formatSignedChange(deltaPrice: number): string {
    return formatters.signedChange.format(deltaPrice);
}

/**
 * Renders a proportion of a price as a signed percentage.
 *
 * @param ratio - Difference expressed as a fraction of the reference price.
 * @returns The formatted percentage, always carrying a sign.
 */
export function formatSignedPercent(ratio: number): string {
    return formatters.signedPercent.format(ratio);
}

/**
 * Renders a price short enough for a narrow axis.
 *
 * Abbreviated only where the ticks are far enough apart to stay distinct: over
 * a hundred-unit range, `80.2K` and `80.3K` are the same label twice.
 *
 * @param price - Price in quote currency.
 * @param tickSpacing - How much price lies between two labels.
 * @returns The formatted price, in thousands where that still tells them apart.
 */
export function formatShortAxisPrice(price: number, tickSpacing: number): string {
    if (Math.abs(price) < 10_000 || tickSpacing < 100) {
        return formatPrice(price);
    }
    return `${formatFixed(price / 1_000, tickSpacing >= 1_000 ? 1 : 2)}K`;
}
