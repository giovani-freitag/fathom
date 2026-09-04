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

/**
 * The shell a bar of controls shares, top or bottom.
 *
 * Scrollable sideways rather than wrapping: a bar that wraps onto two lines has
 * stopped being a bar, and on a phone the tools run past the edge of the screen
 * however few of them there are.
 *
 * The scrollbar is hidden because a scrollbar over a chart is furniture, and
 * the edges are faded because hiding it left nothing at all to say there was
 * more. On a phone that was six of thirteen tools — Measure and the tool lock
 * among them — off screen behind a row that looked complete. A control cut by a
 * fade reads as one that continues; a control cut by the frame reads as the
 * last one.
 */
export const CONTROL_BAR_CLASSES =
    'flex shrink-0 items-center gap-2 px-3 py-2 max-w-full overflow-x-auto'
    + ' [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
    + ' [mask-image:linear-gradient(to_right,transparent_0,black_14px,'
    + 'black_calc(100%-14px),transparent_100%)]';

/** The shell every panel that opens over the chart shares. */
export const FLOATING_CARD_CLASSES =
    `pointer-events-auto rounded-xl ${FLOATING_SURFACE_CLASSES} p-3 shadow-2xl shadow-black/50`;

/**
 * The way to add one more of something, wherever the offer is made.
 *
 * Dashed because it is an outline waiting to be filled rather than a control
 * that does something to what is already there. Written once because it was
 * written three ways in one popover, at two radii and two borders.
 */
export const PANEL_ADD_CLASSES =
    'flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-hairline'
    + ' px-3 py-2 text-xs font-semibold text-ink-400 transition-colors'
    + ' hover:border-hairline-bright hover:text-ink-100 disabled:opacity-40';

/**
 * What a panel calls itself, wherever one opens.
 *
 * Written once because it is the first thing read in every panel, and three
 * spellings of it is three panels that look like they came from three places.
 */
/**
 * What is behind anything that takes over the screen.
 *
 * The same wash under every one of them: a dialog that dims the chart more
 * than the one before it reads as a different kind of interruption.
 */
export const OVERLAY_CLASSES = 'fixed inset-0 z-40 bg-black/25';

export const PANEL_TITLE_CLASSES = 'text-sm font-semibold tracking-wide text-ink-100';
