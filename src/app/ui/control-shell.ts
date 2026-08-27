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

/** A control that is only a glyph, square at that height. */
export const CONTROL_BUTTON_CLASSES =
    `grid ${CONTROL_HEIGHT} min-w-10 shrink-0 place-items-center rounded-lg px-1 transition-colors`;

export const CONTROL_ACTIVE_CLASSES = 'bg-phosphor/15 text-phosphor';
export const CONTROL_RESTING_CLASSES = 'text-ink-400 hover:bg-abyss-700 hover:text-ink-100';

/** The shell every floating island shares, so they read as one family. */
export const FLOATING_PANEL_CLASSES =
    'pointer-events-auto flex items-center gap-1 rounded-2xl border border-hairline'
    + ' bg-abyss-800/95 px-1.5 py-1 shadow-lg backdrop-blur';
