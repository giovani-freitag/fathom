import type { ReactElement } from 'react';

interface PairIdentityProps {
    readonly symbol: string;
    /** The two assets, or empty where the row knows only the symbol. */
    readonly base?: string;
    readonly quote?: string;
}

/**
 * What a pair is called, in the two columns the recording card names it in.
 *
 * The catalogue listing is a table and declares its own columns, so this is not
 * shared with it any more. It stays because the rows here are not a table and
 * should not become one: every control on them is a fixed width, so the room
 * left over is the same on every row, and the name takes all of it. Measured
 * across three hundred rows on two venues, in a card two hundred and eighty
 * eight pixels wide: every name a hundred and seventy-eight pixels, none of
 * them cut, including the nineteen-character ones. A table would line up what
 * is already lined up.
 *
 * The assets are absent on a row that came from a tag rather than from a venue:
 * a tag holds a venue and a symbol, and rendering the pair anyway draws a lone
 * slash in a column of them.
 */
export function PairIdentity({ symbol, base = '', quote = '' }: PairIdentityProps): ReactElement {
    return (
        <>
            {/* Measured against the card this sits in rather than against the
                window. A phone held sideways is 667 pixels wide, so the wide
                layout switched on inside a card still 288 pixels across: the
                row grew to 430 and its switch and delete button were clipped
                out of it entirely, with no scroll to reach them. What decides
                this is the room on the row, and only a container query asks
                about that.

                Wide enough to line the rows up, able to give way, and with a
                floor. Fixed, a long grid figure pushed the delete button off
                the screen; free to shrink to nothing, four of five recorded
                rows read "PAXGU…", "ETHU…", "LTCU…" — and LTCUSDC trades on the
                same venue, so the stub was genuinely ambiguous on the one row
                carrying a control that cannot be undone.

                A fixed column only where there is something to line it up
                against. On a narrow card the row carries the name and nothing
                else, so a fixed width truncated "1000000BABYDOGEUSDT" with half
                the row empty beside it — and every venue lists names that long.
                Wide, the column goes back to a fixed width, because there the
                venue and the note beside it are what a reader scans down. */}
            <span className="min-w-20 flex-1 truncate text-sm font-semibold @md:w-40 @md:flex-none">
                {symbol}
            </span>
            {base !== '' && (
                <span className="hidden w-28 shrink-0 truncate text-xs text-ink-400 @md:inline">
                    {base}/{quote}
                </span>
            )}
        </>
    );
}
