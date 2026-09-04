/**
 * The shape the editor takes, held apart from both things that draw it.
 *
 * Its own module because the panel is loaded on demand — it carries a compiler
 * — and the placeholder shown while that arrives cannot wait for the download
 * to learn what shape to be. Both read the shape from here, so what stands in
 * for the panel cannot be a different shape from the panel.
 */

/**
 * A sheet from the bottom on a phone, a rail beside the chart on a desk.
 *
 * A phone is held by its lower half and a rail on the right is a regrip away,
 * which is the reasoning the drawing controls already follow — and half a
 * narrow screen is not a chart worth checking against anyway.
 */
export const EDITOR_SHELL_CLASSES = 'fixed inset-x-0 bottom-0 z-40 flex min-w-0 flex-col rounded-t-xl border-t border-hairline bg-abyss-850 shadow-2xl shadow-black/80 lg:relative lg:inset-auto lg:h-auto lg:rounded-none lg:border-l lg:border-t-0';

/**
 * Two sizes, one per shape.
 *
 * A width dragged on a desk means nothing to a sheet on a phone, and
 * remembering one as the other would open every phone at the width of
 * somebody's monitor.
 */
export const RAIL = {
    slot: 'fathom.addons.railWidth',
    growsAlong: 'width',
    openingRatio: 0.32,
    smallest: 0.2,
    largest: 0.6,
} as const;

export const SHEET = {
    slot: 'fathom.addons.sheetHeight',
    growsAlong: 'height',
    openingRatio: 0.6,
    smallest: 0.25,
    largest: 0.85,
} as const;
