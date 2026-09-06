import { LIST_ROW_CLASSES } from '../control-shell.ts';
import { memo, type ReactElement, useEffect, useState } from 'react';
import type { MarketPair, PairTag } from '../../../shared/core/pair-tags.ts';
import { PairIdentity } from './pair-identity.tsx';
import { PairMarks, PairTagMenu } from './pair-tag-menu.tsx';
import type { Translate } from '../../i18n/translator.ts';

/** One row of the listing, whichever half of the card it came from. */
export interface PairRow {
    readonly pair: MarketPair;
    readonly base: string;
    readonly quote: string;
    /** Which tags it carries, which its own first cell both shows and changes. */
    readonly held: ReadonlySet<string>;
    /** False where nothing can be drawn for it, with `whyNot` saying why. */
    readonly isOpenable: boolean;
    readonly whyNot: string;
    /**
     * The one word at the end of the row, or nothing.
     *
     * Decided by whoever built the row rather than here, because the useful
     * thing to say differs by half: on a listing of nine hundred pairs the four
     * this chart has are the rare fact worth marking, and on a list a reader
     * kept themselves the rare fact is the one that cannot be opened.
     */
    readonly note: string;
}

/**
 * How many rows are built in the tick the answer lands.
 *
 * More than a sheet shows, so a reader who scrolls at once finds rows under
 * their thumb rather than a gap, and few enough that building them is not felt.
 */
const ROWS_AT_ONCE = 30;

interface PairTableProps {
    readonly rows: readonly PairRow[];
    /** True while a tag is being shown, where rows can span venues. */
    readonly hasVenueColumn: boolean;
    /** Which pair the chart is on, so the table can say which. */
    readonly open: MarketPair | null;
    /** Every tag there is, because any row may be filed under any of them. */
    readonly tags: readonly PairTag[];
    readonly translate: Translate;
    readonly onOpen: (pair: MarketPair) => void;
    readonly onKeep: (pair: MarketPair, tagId: string, isOn: boolean) => void;
}

/**
 * The listing itself, filling whatever the card has left.
 *
 * A table rather than a stack of chips: every row answers the same four
 * questions, and answering them in the same four places down the card is what
 * lets a reader run an eye down one of them instead of reading each row whole.
 */
/**
 * The listing itself, rebuilt only when the rows change.
 *
 * Memoised because the rows are the expensive part and almost nothing that
 * happens above them touches them: a character typed into the search box
 * re-renders the panel, and without this React reconciles a hundred and fifty
 * rows — thirteen hundred elements — to arrive at the same list. Measured, that
 * was most of the hundred and fifty milliseconds a keystroke cost.
 *
 * Its callbacks have to be stable for this to be worth anything; the panel
 * holds them in `useCallback` for that reason.
 */
export const PairTable = memo(function PairTable(props: PairTableProps): ReactElement {
    const { translate } = props;

    // Which row's marks were pressed. Only that one builds a menu; the rest
    // draw the same button without one behind it.
    const [tagging, setTagging] = useState<string | null>(null);

    // The rest of the rows are built once the thread is free. A listing is a
    // hundred and fifty rows and a sheet shows a dozen: building all of them in
    // the tick the answer arrives spends a third of a second in which nothing
    // the reader does is answered, to draw rows they have not scrolled to.
    // Keyed on the rows themselves, so a new listing starts short again without
    // an effect having to reset it.
    const [whole, setWhole] = useState<readonly PairRow[] | null>(null);
    const isWhole = whole === props.rows;
    useEffect(() => {
        const idle = globalThis.requestIdleCallback;
        if (typeof idle !== 'function') {
            const soon = setTimeout(() => { setWhole(props.rows); }, 120);
            return () => { clearTimeout(soon); };
        }
        const asked = idle(() => { setWhole(props.rows); }, { timeout: 500 });
        return () => { globalThis.cancelIdleCallback(asked); };
    }, [props.rows]);

    const drawn = isWhole ? props.rows : props.rows.slice(0, ROWS_AT_ONCE);

    return (
        <ul className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            {drawn.map((row) => {
                const at = `${row.pair.venue}/${row.pair.symbol}`;
                const isShowing = props.open !== null
                    && props.open.venue === row.pair.venue
                    && props.open.symbol === row.pair.symbol;

                return (
                    <li
                        key={`${row.pair.venue}/${row.pair.symbol}`}
                        className="flex items-stretch border-b border-hairline/40"
                    >
                        {tagging === at
                            ? (
                                <PairTagMenu
                                    isOpen
                                    onOpenChange={(isOpen) => { setTagging(isOpen ? at : null); }}
                                    pair={row.pair}
                                    tags={props.tags}
                                    held={row.held}
                                    translate={translate}
                                    onToggle={(tagId, isOn) => { props.onKeep(row.pair, tagId, isOn); }}
                                />
                            )
                            : (
                                <PairMarks
                                    pair={row.pair}
                                    tags={props.tags}
                                    held={row.held}
                                    translate={translate}
                                    onOpen={() => { setTagging(at); }}
                                />
                            )}

                        <button
                            type="button"
                            disabled={!row.isOpenable}
                            aria-current={isShowing}
                            title={row.isOpenable ? undefined : row.whyNot}
                            aria-label={row.isOpenable
                                ? translate('markets.openIt', { symbol: row.pair.symbol })
                                : `${row.pair.symbol} — ${row.whyNot}`}
                            onClick={() => { props.onOpen(row.pair); }}
                            className={`${LIST_ROW_CLASSES} min-w-0 flex-1 px-2 transition-colors hover:bg-abyss-700 disabled:hover:bg-transparent ${
                                isShowing ? 'text-phosphor' : 'text-ink-100'
                            }`}
                        >
                            <PairIdentity symbol={row.pair.symbol} base={row.base} quote={row.quote} />
                            {props.hasVenueColumn && (
                                <span className="w-28 shrink-0 truncate text-xs text-ink-500">
                                    {row.pair.venue}
                                </span>
                            )}
                            {/* Last, where an empty cell costs nothing, and
                                allowed to shrink: held at its own width, one
                                long note pushed every row wider than the card
                                and gave the whole list a sideways scroll.

                                Lit where the row can be opened, because on a
                                venue listing that is the rare fact: a thousand
                                rows say the same thing in grey, and the four
                                worth pressing are lost among them. */}
                            <span className={`ml-auto min-w-0 truncate pl-2 text-[11px] ${
                                row.isOpenable ? 'text-phosphor/80' : 'text-ink-500'
                            }`}
                            >
                                {row.note}
                            </span>
                        </button>
                    </li>
                );
            })}
        </ul>
    );
});
