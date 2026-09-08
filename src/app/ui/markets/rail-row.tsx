import { CONTROL_CHOSEN_CLASSES, CONTROL_HEIGHT } from '../control-shell.ts';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { ReactElement } from 'react';

/**
 * The rail's own vocabulary, written once.
 *
 * Two listings have a rail down their side — the pairs a reader keeps, and the
 * pairs a venue offers to record — and a second set of rows written to look
 * like the first is a set that stops looking like it on the next change.
 */

/**
 * What a control on a row looks like: nothing, until the row is under a pointer.
 *
 * Kept out of the row's own reading. A rail of tags with a pencil and a bin on
 * every line is a column of icons with names among them, and the names are what
 * a reader came down the rail to read.
 */
const ROW_ACTION_CLASSES =
    'mr-1 hidden size-7 shrink-0 place-items-center rounded text-ink-500 transition-colors hover:bg-abyss-700 group-hover:grid group-focus-within:grid';

export interface RailHeadingProps {
    readonly said: string;
    /** Absent where nothing may be added under this heading. */
    readonly onAdd?: (() => void) | undefined;
    readonly addLabel?: string | undefined;
}

/**
 * A heading in the rail, which lies down with it on a phone.
 *
 * The offer to add one more sits on the heading rather than at the foot of what
 * it names. A dashed row down there is the width of a target and reads as
 * another entry in the column, so the eye counts it among the tags — and with
 * two sections stacked, the reader has to know which list a row at the bottom
 * belongs to. Beside the label there is nothing to work out.
 */
export function RailHeading({ said, onAdd, addLabel }: RailHeadingProps): ReactElement {
    return (
        <div className="flex items-center gap-1 pb-1 pt-3 first:pt-1">
            <h3 className="min-w-0 flex-1 truncate px-2 field-label">{said}</h3>
            {onAdd !== undefined && (
                <button
                    type="button"
                    aria-label={addLabel ?? said}
                    title={addLabel ?? said}
                    onClick={onAdd}
                    className="mr-1 grid size-6 shrink-0 place-items-center rounded text-ink-500 transition-colors hover:bg-abyss-700 hover:text-ink-100"
                >
                    <Plus className="size-3.5" />
                </button>
            )}
        </div>
    );
}

export interface RailRowProps {
    readonly said: string;
    readonly count?: number;
    /** True where the listing is showing this one. */
    readonly isOn: boolean;
    readonly onPress: () => void;
    readonly onRemove?: (() => void) | undefined;
    readonly removeLabel?: string | undefined;
    readonly onEdit?: (() => void) | undefined;
    readonly editLabel?: string | undefined;
    readonly children?: ReactElement | undefined;
}

/** One target in the rail: a venue to browse, or a tag with its mark on it. */
export function RailRow({
    said,
    count,
    isOn,
    onPress,
    onRemove,
    removeLabel,
    onEdit,
    editLabel,
    children,
}: RailRowProps): ReactElement {
    return (
        <div className={`group flex shrink-0 items-center rounded-lg ${isOn ? CONTROL_CHOSEN_CLASSES : ''}`}>
            <button
                type="button"
                aria-current={isOn}
                onClick={onPress}
                className={`flex ${CONTROL_HEIGHT} min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 text-left text-xs font-semibold transition-colors ${
                    isOn ? '' : 'text-ink-300 hover:bg-abyss-700 hover:text-ink-100'
                } ${children === undefined ? '' : 'pl-2'}`}
            >
                {/* Inside the target rather than beside it: a mark is what the
                    eye lands on first, and a row where pressing the picture did
                    nothing while pressing the word beside it worked reads as a
                    row that is broken. */}
                {children}
                <span className="truncate">{said}</span>
                {/* Drawn, not read: glued to the row's own words it announced
                    "binance-futures5", a name with a stray digit on the end. */}
                {count !== undefined && count > 0 && (
                    <span
                        aria-hidden
                        className="ml-auto shrink-0 rounded-full bg-current/15 px-1.5 text-[10px]"
                    >
                        {count}
                    </span>
                )}
            </button>
            {onEdit !== undefined && (
                <button
                    type="button"
                    aria-label={`${editLabel ?? ''} ${said}`.trim()}
                    onClick={onEdit}
                    className={`${ROW_ACTION_CLASSES} hover:text-ink-100`}
                >
                    <Pencil size={13} />
                </button>
            )}
            {onRemove !== undefined && (
                <button
                    type="button"
                    aria-label={`${removeLabel ?? ''} ${said}`.trim()}
                    onClick={onRemove}
                    className={`${ROW_ACTION_CLASSES} hover:text-amber`}
                >
                    <Trash2 size={13} />
                </button>
            )}
        </div>
    );
}
