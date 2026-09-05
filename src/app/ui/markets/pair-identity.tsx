import type { ReactElement } from 'react';

interface PairIdentityProps {
    readonly symbol: string;
    /** The two assets, or empty where the row knows only the symbol. */
    readonly base?: string;
    readonly quote?: string;
}

/**
 * What a pair is called, in the two columns every listing names it in.
 *
 * The same widths wherever pairs are listed, so the eye running down one
 * listing lands in the same place in the next. The assets are absent on a row
 * that came from a tag rather than from a venue: a tag holds a venue and a
 * symbol, and rendering the pair anyway draws a lone slash in a column of them.
 */
export function PairIdentity({ symbol, base = '', quote = '' }: PairIdentityProps): ReactElement {
    return (
        <>
            <span className="w-32 shrink-0 truncate text-sm font-semibold sm:w-40">{symbol}</span>
            {base !== '' && (
                <span className="hidden w-28 shrink-0 truncate text-xs text-ink-400 sm:inline">
                    {base}/{quote}
                </span>
            )}
        </>
    );
}
