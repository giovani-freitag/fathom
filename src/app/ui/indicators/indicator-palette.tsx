import {
    CONTROL_CHIP_CLASSES,
    CONTROL_CHOSEN_CLASSES,
    CONTROL_INPUT_CLASSES,
    CONTROL_OFFERED_CLASSES,
    PANEL_ADD_CLASSES,
} from '../control-shell.ts';
import { type ReactElement, useMemo, useState } from 'react';
import type { FieldLayer, Indicator, Registered } from '../../../shared/core/draw-plan.ts';

import { CHART_LAYERS } from '../../indicators/indicator-catalogue.ts';
import { listAddons } from '../../addons/addon-registry.ts';
import { findFieldLayer } from '../../indicators/field-layers.ts';
import { ICON_SIZE_PX, LAYER_BUTTON_CLASSES } from './layer-list.tsx';
import { needsOwnBand } from '../../painting/pane-projector.ts';
import { Pencil, Plus, Search } from 'lucide-react';

type Offered = Registered<Indicator | FieldLayer>;
import { useTranslate } from '../../react/use-appearance.ts';
import { translateLabel } from '../../i18n/translator.ts';
import type { Translate } from '../../i18n/translator.ts';

/** Which half of the catalogue is being looked at. */
type Shelf = 'shipped' | 'yours';

interface IndicatorPaletteProps {
    readonly onAdd: (indicatorId: string) => void;
    readonly isFull: boolean;
    /** How many copies of each indicator the chart already holds. */
    readonly addedCounts: ReadonlyMap<string, number>;
    /** True where the palette owns the keyboard on open. */
    readonly hasAutoFocus?: boolean;
    /** Opens the editor, on a saved reading where one is named. */
    readonly onEdit?: (key?: string) => void;
}

/**
 * The catalogue, searchable, in two shelves.
 *
 * Split because the two ask different questions of a reader. Choosing one of
 * ours is "does adding this reshape my screen?", which is why they are grouped
 * by where they draw. Finding one you wrote is looking for a name you already
 * know, and grouping those by scale hides them among twenty others.
 */
export function IndicatorPalette({
    onAdd,
    isFull,
    addedCounts,
    hasAutoFocus = false,
    onEdit,
}: IndicatorPaletteProps): ReactElement {
    const translate = useTranslate();
    const [query, setQuery] = useState('');
    const [shelf, setShelf] = useState<Shelf>('shipped');

    const shipped = useMemo(() => findMatches(query, translate, CHART_LAYERS), [query, translate]);
    const yours = useMemo(() => findMatches(query, translate, listAddons()), [query, translate]);

    const shown = shelf === 'shipped' ? shipped : yours;
    const elsewhere = shelf === 'shipped' ? yours.length : shipped.length;

    return (
        <div className="flex w-72 flex-col gap-2">
            {/* Held at the top of the panel that scrolls rather than given a
                scroller of its own: a list that scrolls inside a panel that also
                scrolls stands two bars side by side, and a reader dragging one
                of them has to find out which is theirs. The negative margins let
                it cover the card's own padding once it is stuck there. */}
            <div className="sticky top-0 z-10 -mx-3 -mt-3 flex flex-col gap-2 bg-abyss-800 px-3 pb-1 pt-3">
                {/* Pressed buttons rather than a tab strip: half a tablist —
                    roles without arrow keys or a panel to control — promises an
                    interaction that is not there, and this chart already has one
                    answer to "which of these". */}
                <div className="flex gap-2">
                    <ShelfTab
                        shelf="shipped"
                        active={shelf}
                        label={translate('indicators.shipped')}
                        onSelect={setShelf}
                    />
                    <ShelfTab
                        shelf="yours"
                        active={shelf}
                        label={translate('indicators.yours')}
                        count={yours.length}
                        onSelect={setShelf}
                    />
                </div>

                <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-ink-500" />
                    <input
                        type="search"
                        name="layerSearch"
                        aria-label={translate('indicators.search')}
                        value={query}
                        autoFocus={hasAutoFocus}
                        placeholder={translate('indicators.search')}
                        onChange={(event) => { setQuery(event.target.value); }}
                        onKeyDown={(event) => { addFirstMatch(event, shown, isFull, onAdd); }}
                        className={`${CONTROL_INPUT_CLASSES} pl-8 pr-2`}
                    />
                </div>

                {isFull && (
                    <p className="px-1 text-xs leading-snug text-amber">{translate('indicators.full')}</p>
                )}
            </div>

            <div>
                {shown.length === 0 && (
                    <EmptyShelf
                        shelf={shelf}
                        hasQuery={query.trim() !== ''}
                        translate={translate}
                        onWrite={onEdit}
                    />
                )}

                {/* Said rather than left to be discovered: the other shelf is a
                    tab away, and a reader who searched and saw nothing has no
                    way of knowing their own reading is the one that matched. */}
                {shown.length === 0 && elsewhere > 0 && query.trim() !== '' && (
                    <button
                        type="button"
                        onClick={() => { setShelf(shelf === 'shipped' ? 'yours' : 'shipped'); }}
                        className="w-full rounded px-2 py-2 text-left text-xs text-phosphor transition-colors hover:bg-abyss-700"
                    >
                        {translate(shelf === 'shipped' ? 'indicators.matchesYours' : 'indicators.matchesOurs', {
                            count: String(elsewhere),
                        })}
                    </button>
                )}

                {shelf === 'yours'
                    ? (
                        <YourShelf
                            readings={shown}
                            isFull={isFull}
                            addedCounts={addedCounts}
                            onAdd={onAdd}
                            {...onEdit === undefined ? {} : { onEdit }}
                        />
                    )
                    : <ShippedShelf shown={shown} isFull={isFull} addedCounts={addedCounts} onAdd={onAdd} />}
            </div>
        </div>
    );
}

interface ShelfTabProps {
    readonly shelf: Shelf;
    readonly active: Shelf;
    readonly label: string;
    readonly count?: number;
    readonly onSelect: (shelf: Shelf) => void;
}

function ShelfTab({ shelf, active, label, count, onSelect }: ShelfTabProps): ReactElement {
    const isActive = shelf === active;
    return (
        <button
            type="button"
            aria-pressed={isActive}
            onClick={() => { onSelect(shelf); }}
            className={`${CONTROL_CHIP_CLASSES} h-8 flex-1 justify-center ${
                isActive ? CONTROL_CHOSEN_CLASSES : CONTROL_OFFERED_CLASSES
            }`}
        >
            {label}
            {count !== undefined && count > 0 && (
                <span className="rounded-full bg-current/15 px-1.5 text-[10px] font-semibold">{count}</span>
            )}
        </button>
    );
}

interface ShippedShelfProps {
    readonly shown: readonly Offered[];
    readonly isFull: boolean;
    readonly addedCounts: ReadonlyMap<string, number>;
    readonly onAdd: (indicatorId: string) => void;
}

function ShippedShelf({ shown, isFull, addedCounts, onAdd }: ShippedShelfProps): ReactElement {
    const theChart = shown.filter((entry) => !isIndicator(entry.layer));
    const overPrice = shown.filter((entry) => isIndicator(entry.layer) && !needsOwnBand(entry.layer.scale));
    const ownPane = shown.filter((entry) => isIndicator(entry.layer) && needsOwnBand(entry.layer.scale));

    return (
        <>
            <IndicatorGroup titleKey="indicators.theChart" indicators={theChart} isFull={isFull} addedCounts={addedCounts} onAdd={onAdd} />
            <IndicatorGroup titleKey="indicators.overPrice" indicators={overPrice} isFull={isFull} addedCounts={addedCounts} onAdd={onAdd} />
            <IndicatorGroup titleKey="indicators.ownPane" indicators={ownPane} isFull={isFull} addedCounts={addedCounts} onAdd={onAdd} />
        </>
    );
}

interface YourShelfProps {
    readonly readings: readonly Offered[];
    readonly isFull: boolean;
    readonly addedCounts: ReadonlyMap<string, number>;
    readonly onAdd: (indicatorId: string) => void;
    readonly onEdit?: ((key?: string) => void) | undefined;
}

function YourShelf({ readings, isFull, addedCounts, onAdd, onEdit }: YourShelfProps): ReactElement {
    const translate = useTranslate();

    return (
        <section className="mb-1">
            {onEdit !== undefined && readings.length > 0 && (
                <WriteOneButton onPress={() => { onEdit(); }} translate={translate} />
            )}

            {readings.map(({ id, layer }) => (
                <div key={id} className="flex items-stretch gap-1">
                    <button
                        type="button"
                        disabled={isFull}
                        onClick={() => { onAdd(id); }}
                        className={`flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded px-2 py-2 text-left transition-colors hover:bg-abyss-700 ${isFull ? 'disabled:opacity-40' : ''}`}
                    >
                        <span className="flex w-full items-center gap-2 text-sm font-semibold text-ink-100">
                            <span className="truncate">{translateLabel(translate, layer.label)}</span>
                            {(addedCounts.get(id) ?? 0) > 0 && (
                                <span className="rounded-full bg-phosphor/15 px-1.5 text-[10px] font-semibold text-phosphor">
                                    {addedCounts.get(id)}
                                </span>
                            )}
                        </span>
                        {layer.about !== undefined && (
                            <span className="w-full truncate text-xs leading-snug text-ink-500">
                                {translateLabel(translate, layer.about)}
                            </span>
                        )}
                    </button>

                    {onEdit !== undefined && (
                        <button
                            type="button"
                            aria-label={`${translate('indicators.edit')} ${translateLabel(translate, layer.label)}`}
                            title={`${translate('indicators.edit')} ${translateLabel(translate, layer.label)}`}
                            onClick={() => { onEdit(id.replace(/^addon:/, '')); }}
                            className={LAYER_BUTTON_CLASSES}
                        >
                            <Pencil size={ICON_SIZE_PX} />
                        </button>
                    )}
                </div>
            ))}
        </section>
    );
}

interface WriteOneButtonProps {
    readonly onPress: () => void;
    readonly translate: Translate;
}

/** The way into the editor, in the shell's own dashed shape. */
function WriteOneButton({ onPress, translate }: WriteOneButtonProps): ReactElement {
    return (
        <button type="button" onClick={onPress} className={`mb-1 w-full ${PANEL_ADD_CLASSES}`}>
            <Plus className="size-4" />
            {translate('indicators.writeOne')}
        </button>
    );
}

interface EmptyShelfProps {
    readonly shelf: Shelf;
    readonly hasQuery: boolean;
    readonly translate: Translate;
    readonly onWrite?: ((key?: string) => void) | undefined;
}

function EmptyShelf({ shelf, hasQuery, translate, onWrite }: EmptyShelfProps): ReactElement {
    if (hasQuery || shelf === 'shipped') {
        return <p className="px-1 py-3 text-xs text-ink-500">{translate('indicators.noMatch')}</p>;
    }

    return (
        <div className="space-y-2 px-1 py-3">
            <p className="text-xs text-ink-500">{translate('indicators.yoursEmpty')}</p>
            {onWrite !== undefined && (
                <WriteOneButton onPress={() => { onWrite(); }} translate={translate} />
            )}
        </div>
    );
}

interface IndicatorGroupProps {
    readonly titleKey: 'indicators.theChart' | 'indicators.overPrice' | 'indicators.ownPane';
    readonly indicators: readonly Offered[];
    readonly isFull: boolean;
    readonly addedCounts: ReadonlyMap<string, number>;
    readonly onAdd: (indicatorId: string) => void;
}

function IndicatorGroup({ titleKey, indicators, isFull, addedCounts, onAdd }: IndicatorGroupProps): ReactElement | null {
    const translate = useTranslate();
    if (indicators.length === 0) {
        return null;
    }

    return (
        <section className="mb-1">
            <h3 className="px-1 py-1 field-label">
                {translate(titleKey)}
            </h3>
            {indicators.map(({ id, layer }) => (
                <button
                    key={id}
                    type="button"
                    disabled={isFull || (findFieldLayer(id) !== null && (addedCounts.get(id) ?? 0) > 0)}
                    onClick={() => { onAdd(id); }}
                    // Dimmed only where nothing more can be added at all. A
                    // layer already on the chart is said so by its own count,
                    // and washing the row out takes the sentence explaining
                    // what the layer *is* down to 1.6 to 1 — the same sentence
                    // a reader reads for anything they might add.
                    className={`flex w-full flex-col items-start gap-0.5 rounded px-2 py-2 text-left transition-colors hover:bg-abyss-700 disabled:hover:bg-transparent ${isFull ? 'disabled:opacity-40' : ''}`}
                >
                    <span className="flex w-full items-center gap-2 text-sm font-semibold text-ink-100">
                        {translateLabel(translate, layer.label)}
                        {(addedCounts.get(id) ?? 0) > 0 && (
                            <span className="rounded-full bg-phosphor/15 px-1.5 text-[10px] font-semibold text-phosphor">
                                {addedCounts.get(id)}
                            </span>
                        )}
                    </span>
                    {layer.about !== undefined && (
                        <span className="text-xs leading-snug text-ink-500">
                            {translateLabel(translate, layer.about)}
                        </span>
                    )}
                </button>
            ))}
        </section>
    );
}

/**
 * Adds the first match when the reader presses return on the search field.
 */
function addFirstMatch(
    event: { key: string; preventDefault: () => void },
    matches: readonly Offered[],
    isFull: boolean,
    onAdd: (indicatorId: string) => void,
): void {
    const first = matches[0];
    if (event.key !== 'Enter' || isFull || first === undefined) {
        return;
    }
    event.preventDefault();
    onAdd(first.id);
}

/**
 * The layers whose name or description answers what was typed.
 */
function findMatches(
    query: string,
    translate: Translate,
    offered: readonly Offered[],
): readonly Offered[] {
    const wanted = query.trim().toLowerCase();
    if (wanted === '') {
        return offered;
    }

    return offered.filter(({ id, layer }) => {
        const name = translateLabel(translate, layer.label).toLowerCase();
        const about = translateLabel(translate, layer.about ?? '').toLowerCase();
        // The id as well as the rendered name, so a reader who knows the term in
        // English finds it in a language that shortens it differently.
        return name.includes(wanted) || about.includes(wanted) || id.includes(wanted);
    });
}

/**
 * Whether an offered layer is one the arithmetic draws.
 *
 * By the scale it declared: only a reading that produces vertices has to say
 * what axis they belong on.
 */
function isIndicator(layer: Indicator | FieldLayer): layer is Indicator {
    return 'scale' in layer;
}
