import {
    createColumnHelper,
    createCoreRowModel,
    flexRender,
    tableFeatures,
    useTable,
} from '@tanstack/react-table';
import { memo, type ReactElement, useMemo, useState } from 'react';
import type { MarketPair, PairTag } from '../../../shared/core/pair-tags.ts';
import { PairMarks, PairTagMenu } from './pair-tag-menu.tsx';
import type { Translate } from '../../i18n/translator.ts';
import { useWholeWhenIdle } from '../../react/use-long-listing.ts';

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

/**
 * What every row is asked and answered in, which the reader never sees.
 *
 * A table with no headings at all is a layout table, and a reader on a screen
 * reader is handed four unnamed columns to work out for themselves. Named here
 * and hidden, they are read out with the cell that answers them.
 */
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

/** What a cell is handed, beyond the row it belongs to. */
interface CellContext {
    readonly tagging: string | null;
    readonly setTagging: (at: string | null) => void;
    readonly props: PairTableProps;
}

/**
 * What this table does, which is hold columns and rows and nothing else.
 *
 * Declared rather than taken wholesale: the sorting, filtering, grouping and
 * pagination this library can do are all done elsewhere or not at all here, and
 * a feature named is a feature shipped to the reader's browser.
 */
const FEATURES = tableFeatures({ coreRowModel: createCoreRowModel() });

const column = createColumnHelper<typeof FEATURES, PairRow>();

/**
 * The listing itself, filling whatever the card has left.
 *
 * A table, and a real one: every row answers the same questions, and answering
 * them in the same places down the card is what lets a reader run an eye down
 * one of them instead of reading each row whole. Laid out by hand it could not
 * do that and use the room at once — a fixed name column truncated the long
 * names with a third of the row empty beside them, and a name free to grow
 * left every row a different width. The browser's own table layout is the one
 * thing that sizes a column to the longest entry in it and shares what is left,
 * across every row, in one pass.
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
    // Which row's marks were pressed. Only that one builds a menu; the rest
    // draw the same button without one behind it.
    const [tagging, setTagging] = useState<string | null>(null);

    const isWhole = useWholeWhenIdle(props.rows);
    const drawn = useMemo(
        () => (isWhole ? props.rows : props.rows.slice(0, ROWS_AT_ONCE)),
        [isWhole, props.rows],
    );

    // Rebuilt only when what a cell needs changes. The row model is derived from
    // these, and a new array of columns on every keystroke is a new model.
    const columns = useMemo(() => buildColumns({
        hasVenueColumn: props.hasVenueColumn,
        context: { tagging, setTagging, props },
    }), [props, tagging]);

    const table = useTable<typeof FEATURES, PairRow>({
        features: FEATURES,
        data: drawn,
        columns,
    });

    return (
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            <table className="w-full table-auto border-collapse text-left">
                <thead className="sr-only">
                    {table.getHeaderGroups().map((group) => (
                        <tr key={group.id}>
                            {group.headers.map((header) => (
                                <th key={header.id} scope="col">
                                    {flexRender(header.column.columnDef.header, header.getContext())}
                                </th>
                            ))}
                        </tr>
                    ))}
                </thead>
                <tbody>
                    {table.getRowModel().rows.map((built) => {
                        const row = built.original;
                        const isShowing = props.open !== null
                            && props.open.venue === row.pair.venue
                            && props.open.symbol === row.pair.symbol;

                        return (
                            // The row is the positioning context the press
                            // reaches across: the name's own button carries an
                            // overlay pinned to this box, so a press anywhere
                            // along the row opens the pair — which is what the
                            // listing did before it was a table, and what a
                            // thumb on a phone needs it to go on doing.
                            <tr
                                key={built.id}
                                className={`relative border-b border-hairline/40 transition-colors ${
                                    row.isOpenable ? 'hover:bg-abyss-700' : ''
                                } ${isShowing ? 'text-phosphor' : 'text-ink-100'}`}
                            >
                                {built.getAllCells().map((cell) => (
                                    <td
                                        key={cell.id}
                                        className={cellClassOf(cell.column.id)}
                                    >
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </td>
                                ))}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
});

/**
 * What each column is worth on the row, which is what the table shares by.
 *
 * The name is the only one allowed to take the room: a cell at a hundred per
 * cent takes everything the others do not need, and they ask for exactly what
 * they hold. That is the whole of the layout — the browser sizes the rest.
 *
 * @param columnId - Which column.
 * @returns The classes its cells carry.
 */
function cellClassOf(columnId: string): string {
    if (columnId === 'marks') {
        // Above the overlay that carries the press, so its own menu opens
        // rather than the pair behind it.
        return 'relative z-10 w-px py-1 pl-1';
    }
    if (columnId === 'symbol') {
        // A hundred per cent takes what the others leave, and nought for the
        // most it may be is what lets it give way when they leave nothing. A
        // table sizes a column to the longest thing in it, so without this the
        // longest name on a venue decides how wide the card is — measured on a
        // phone, a listing of bybit made the sheet four hundred and eighty-five
        // pixels wide on a three hundred and ninety pixel screen, and pushed the
        // chart out from under it.
        return 'w-full max-w-0 py-1';
    }
    if (columnId === 'named') {
        // The name says it on a narrow card, and the pair spelled out beside it
        // is the same answer twice in the room there is for one.
        return 'hidden py-1 pr-2 whitespace-nowrap @md:table-cell';
    }
    return 'w-px py-1 pr-2 whitespace-nowrap';
}

/**
 * The columns, in the order a reader reads them.
 *
 * @param request - Whether the venue is shown, and what the cells reach through.
 * @returns The column definitions.
 */
function buildColumns(request: {
    hasVenueColumn: boolean;
    context: CellContext;
}) {
    const { context } = request;
    const { props, tagging, setTagging } = context;
    const { translate } = props;

    const marks = column.display({
        id: 'marks',
        header: () => translate('markets.tagsColumn'),
        cell: ({ row }) => {
            const one = row.original;
            const at = `${one.pair.venue}/${one.pair.symbol}`;
            return tagging === at
                ? (
                    <PairTagMenu
                        isOpen
                        onOpenChange={(isOpen) => { setTagging(isOpen ? at : null); }}
                        pair={one.pair}
                        tags={props.tags}
                        held={one.held}
                        translate={translate}
                        onToggle={(tagId, isOn) => { props.onKeep(one.pair, tagId, isOn); }}
                    />
                )
                : (
                    <PairMarks
                        pair={one.pair}
                        tags={props.tags}
                        held={one.held}
                        translate={translate}
                        onOpen={() => { setTagging(at); }}
                    />
                );
        },
    });

    const symbol = column.accessor((one) => one.pair.symbol, {
        id: 'symbol',
        header: () => translate('markets.pairColumn'),
        cell: ({ row }) => {
            const one = row.original;
            return (
                <button
                    type="button"
                    disabled={!one.isOpenable}
                    title={one.isOpenable ? undefined : one.whyNot}
                    aria-label={one.isOpenable
                        ? translate('markets.openIt', { symbol: one.pair.symbol })
                        : `${one.pair.symbol} — ${one.whyNot}`}
                    onClick={() => { props.onOpen(one.pair); }}
                    // The overlay is what makes the whole row the target. It is
                    // on the name rather than on the row itself because a row is
                    // not a control, and a control is what a reader tabs to.
                    className="block w-full truncate px-2 py-2 text-left text-sm font-semibold after:absolute after:inset-0 disabled:after:hidden"
                >
                    {one.pair.symbol}
                </button>
            );
        },
    });

    const named = column.accessor((one) => (one.base === '' ? '' : `${one.base}/${one.quote}`), {
        id: 'named',
        header: () => translate('markets.baseQuoteColumn'),
        cell: ({ getValue }) => (
            <span className="text-xs text-ink-400">{getValue()}</span>
        ),
    });

    const venue = column.accessor((one) => one.pair.venue, {
        id: 'venue',
        header: () => translate('markets.venueColumn'),
        cell: ({ getValue }) => <span className="text-xs text-ink-500">{getValue()}</span>,
    });

    const note = column.accessor((one) => one.note, {
        id: 'note',
        header: () => translate('markets.noteColumn'),
        // Lit where the row can be opened, because on a venue listing that is
        // the rare fact: a thousand rows say the same thing in grey, and the
        // four worth pressing are lost among them.
        cell: ({ row, getValue }) => (
            <span className={`text-[11px] ${row.original.isOpenable ? 'text-phosphor/80' : 'text-ink-500'}`}>
                {getValue()}
            </span>
        ),
    });

    // Through the helper's own gatherer, which is what keeps each column's
    // value type rather than widening the array to one shared shape.
    return request.hasVenueColumn
        ? column.columns([marks, symbol, named, venue, note])
        : column.columns([marks, symbol, named, note]);
}
