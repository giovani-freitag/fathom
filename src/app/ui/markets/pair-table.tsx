import type { ReactElement } from 'react';
import { Star } from 'lucide-react';
import type { Translate } from '../../i18n/translator.ts';
import type { WatchedPair } from '../../../shared/core/watch-lists.ts';

/** One row of the listing, whichever half of the card it came from. */
export interface PairRow {
    readonly pair: WatchedPair;
    readonly base: string;
    readonly quote: string;
    /** True where a star would take it out rather than put it in. */
    readonly isKept: boolean;
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

interface PairTableProps {
    readonly rows: readonly PairRow[];
    /** True while a list is being shown, where rows can span venues. */
    readonly hasVenueColumn: boolean;
    /** Which pair the chart is on, so the table can say which. */
    readonly open: WatchedPair | null;
    readonly listName: string;
    readonly translate: Translate;
    readonly onOpen: (pair: WatchedPair) => void;
    readonly onKeep: (pair: WatchedPair, isKept: boolean) => void;
}

/**
 * The listing itself, filling whatever the card has left.
 *
 * A table rather than a stack of chips: every row answers the same four
 * questions, and answering them in the same four places down the card is what
 * lets a reader run an eye down one of them instead of reading each row whole.
 */
export function PairTable(props: PairTableProps): ReactElement {
    const { translate } = props;

    return (
        <ul className="min-h-0 flex-1 overflow-y-auto">
            {props.rows.map((row) => {
                const isShowing = props.open !== null
                    && props.open.venue === row.pair.venue
                    && props.open.symbol === row.pair.symbol;

                return (
                    <li
                        key={`${row.pair.venue}/${row.pair.symbol}`}
                        className="flex items-stretch border-b border-hairline/40"
                    >
                        <button
                            type="button"
                            aria-pressed={row.isKept}
                            aria-label={translate(row.isKept ? 'markets.removeFrom' : 'markets.addTo', {
                                symbol: row.pair.symbol,
                                list: props.listName,
                            })}
                            onClick={() => { props.onKeep(row.pair, row.isKept); }}
                            className="grid w-10 shrink-0 place-items-center transition-colors hover:bg-abyss-700"
                        >
                            <Star
                                size={15}
                                className={row.isKept ? 'fill-current text-phosphor' : 'text-ink-500'}
                            />
                        </button>

                        <button
                            type="button"
                            disabled={!row.isOpenable}
                            aria-current={isShowing}
                            title={row.isOpenable ? undefined : row.whyNot}
                            aria-label={row.isOpenable
                                ? translate('markets.openIt', { symbol: row.pair.symbol })
                                : `${row.pair.symbol} — ${row.whyNot}`}
                            onClick={() => { props.onOpen(row.pair); }}
                            className={`flex min-w-0 flex-1 items-center gap-3 px-2 py-2 text-left transition-colors hover:bg-abyss-700 disabled:hover:bg-transparent ${
                                isShowing ? 'text-phosphor' : 'text-ink-100'
                            }`}
                        >
                            <span className="w-32 shrink-0 truncate text-sm font-semibold sm:w-40">
                                {row.pair.symbol}
                            </span>
                            {/* Absent on a kept pair: a list holds a venue and a
                                symbol, and nothing it knows says what the two
                                assets were. Rendered anyway, it draws a lone
                                slash in a column of them. */}
                            {row.base !== '' && (
                                <span className="hidden w-28 shrink-0 truncate text-xs text-ink-400 sm:inline">
                                    {row.base}/{row.quote}
                                </span>
                            )}
                            {props.hasVenueColumn && (
                                <span className="w-28 shrink-0 truncate text-xs text-ink-500">
                                    {row.pair.venue}
                                </span>
                            )}
                            {/* The one column that is usually empty, so it sits
                                at the end where an empty cell costs nothing. */}
                            <span className="ml-auto shrink-0 truncate pl-2 text-[11px] text-ink-500">
                                {row.note}
                            </span>
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}
