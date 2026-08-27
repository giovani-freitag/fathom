/**
 * One height for every control the reader presses, wherever it sits.
 *
 * Written once because it was written four ways in one bar: a select at
 * forty-four pixels beside one at thirty-two, span chips at forty-four and icon
 * buttons at forty. A row of controls that do the same kind of thing at four
 * different heights reads as a row that was assembled rather than designed.
 *
 * Forty, which is a comfortable target for a thumb and not a large one for a
 * cursor.
 */
export const CONTROL_HEIGHT = 'h-10';

/**
 * A control the reader picks between, whatever shape it is laid out in.
 *
 * The width and the justification are left to whoever lays it out: a chip in a
 * row is a target and is centred on its word, a choice on a line of its own
 * reads left to right like the rest of the panel. Everything else about it —
 * the height, the border, the weight, what it looks like unpickable — is the
 * same wherever it appears.
 */
export const CONTROL_CHIP_CLASSES =
    `inline-flex ${CONTROL_HEIGHT} items-center gap-2 rounded-lg border px-3 text-xs`
    + ' font-semibold tracking-wide transition-colors disabled:opacity-40';

/** What a control looks like once it is the one in force. */
export const CONTROL_CHOSEN_CLASSES = 'border-phosphor/60 bg-phosphor/12 text-phosphor';

/** What it looks like while it is only on offer. */
export const CONTROL_OFFERED_CLASSES =
    'border-hairline bg-abyss-800/80 text-ink-300 hover:border-hairline-bright hover:text-ink-100';

/**
 * A field the reader types into, at the same height as everything else.
 *
 * It had drifted too: a search box at forty beside a number field at
 * thirty-six, in panels that open one above the other.
 */
export const CONTROL_INPUT_CLASSES =
    `${CONTROL_HEIGHT} w-full rounded-lg border border-hairline bg-abyss-900 text-sm text-ink-100`
    + ' outline-none transition-colors focus:border-phosphor/60';

/** A control that is only a glyph, square at that height. */
export const CONTROL_BUTTON_CLASSES =
    `grid ${CONTROL_HEIGHT} min-w-10 shrink-0 place-items-center rounded-lg px-1 transition-colors`;

export const CONTROL_ACTIVE_CLASSES = 'bg-phosphor/15 text-phosphor';
export const CONTROL_RESTING_CLASSES = 'text-ink-400 hover:bg-abyss-700 hover:text-ink-100';

/**
 * What every surface that floats over the chart is made of.
 *
 * The shape is left to whoever is floating: an island is a rounded bar, a panel
 * is a card, a notice is a pill. What they must agree on is the material — the
 * same hairline, the same slightly translucent ground, the same blur — or the
 * chart looks like it is wearing three different interfaces at once.
 */
export const FLOATING_SURFACE_CLASSES = 'border border-hairline bg-abyss-800/95 backdrop-blur';

/** The shell every floating island shares, so they read as one family. */
export const FLOATING_PANEL_CLASSES =
    `pointer-events-auto flex items-center gap-1 rounded-2xl ${FLOATING_SURFACE_CLASSES}`
    + ' px-1.5 py-1 shadow-lg';

/** The shell every panel that opens over the chart shares. */
export const FLOATING_CARD_CLASSES =
    `pointer-events-auto rounded-xl ${FLOATING_SURFACE_CLASSES} p-3 shadow-2xl shadow-black/50`;
