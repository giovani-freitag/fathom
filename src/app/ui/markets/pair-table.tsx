import type { ReactElement } from 'react';
import type { MarketPair } from '../../../shared/core/pair-tags.ts';
import type { PlotTone } from '../../../shared/core/draw-plan.ts';
import { ToneSwatch } from '../indicators/tone-swatch.tsx';
import type { Translate } from '../../i18n/translator.ts';

/** How many of a pair's other tags are marked before the row runs out of room. */
const MARKS_SHOWN = 3;

/** One row of the listing, whichever half of the card it came from. */
export interface PairRow {
    readonly pair: MarketPair;
    readonly base: string;
    readonly quote: string;
    /** True where a press would take it out from under the open tag. */
    readonly isKept: boolean;
    /** The colours of the other tags it carries, in the order they were made. */
    readonly otherTones: readonly PlotTone[];
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
    /** True while a tag is being shown, where rows can span venues. */
    readonly hasVenueColumn: boolean;
    /** Which pair the chart is on, so the table can say which. */
    readonly open: MarketPair | null;
    /** What the tag a press files under is called, for the row's own label. */
    readonly tagLabel: string;
    /** The colour that tag marks its pairs in. */
    readonly tagTone: PlotTone;
    readonly translate: Translate;
    readonly onOpen: (pair: MarketPair) => void;
    readonly onKeep: (pair: MarketPair, isKept: boolean) => void;
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
        <ul className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
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
                                tag: props.tagLabel,
                            })}
                            onClick={() => { props.onKeep(row.pair, row.isKept); }}
                            className="group grid w-10 shrink-0 place-items-center transition-colors hover:bg-abyss-700"
                        >
                            {/* The tag's own colour, filled where the pair
                                carries it. Hollow it stays the same mark in the
                                same place, so a reader running an eye down the
                                column reads one shape rather than two. */}
                            {row.isKept
                                ? <ToneSwatch tone={props.tagTone} className="size-3" />
                                : <span className="block size-3 rounded-full border border-ink-500 transition-colors group-hover:border-ink-300" />}
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
                            {/* Absent on a kept pair: a tag holds a venue and a
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
                            {/* What else this pair is filed under. The colour is
                                the whole of it: the labels are in the rail a
                                finger away, and spelling them out here is the
                                row wide enough to scroll again. */}
                            {row.otherTones.length > 0 && (
                                <span className="ml-auto flex shrink-0 items-center gap-1 pl-2">
                                    {row.otherTones.slice(0, MARKS_SHOWN).map((tone) => (
                                        <ToneSwatch key={tone} tone={tone} className="size-2" />
                                    ))}
                                </span>
                            )}
                            {/* Last, where an empty cell costs nothing, and
                                allowed to shrink: held at its own width, one
                                long note pushed every row wider than the card
                                and gave the whole list a sideways scroll. */}
                            <span className={`min-w-0 truncate pl-2 text-[11px] text-ink-500 ${
                                row.otherTones.length > 0 ? '' : 'ml-auto'
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
}
