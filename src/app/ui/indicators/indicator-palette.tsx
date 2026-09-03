import { CONTROL_INPUT_CLASSES } from '../control-shell.ts';
import { type ReactElement, useMemo, useState } from 'react';
import type { FieldLayer, Indicator, Registered } from '../../../shared/core/draw-plan.ts';

import { listOfferedLayers } from '../../indicators/indicator-catalogue.ts';
import { findFieldLayer } from '../../indicators/field-layers.ts';
import { needsOwnBand } from '../../painting/pane-projector.ts';
import { Search } from 'lucide-react';

type Offered = Registered<Indicator | FieldLayer>;
import { useTranslate } from '../../react/use-appearance.ts';
import { translateLabel } from '../../i18n/translator.ts';
import type { Translate } from '../../i18n/translator.ts';

interface IndicatorPaletteProps {
    readonly onAdd: (indicatorId: string) => void;
    readonly isFull: boolean;
    /** How many copies of each indicator the chart already holds. */
    readonly addedCounts: ReadonlyMap<string, number>;
    /** True where the palette owns the keyboard on open. */
    readonly hasAutoFocus?: boolean;
}

/**
 * The catalogue, searchable, grouped by whether adding one reshapes the chart.
 */
export function IndicatorPalette({ onAdd, isFull, addedCounts, hasAutoFocus = false }: IndicatorPaletteProps): ReactElement {
    const translate = useTranslate();
    const [query, setQuery] = useState('');
    const matches = useMemo(() => findMatches(query, translate), [query, translate]);

    const theChart = matches.filter((entry) => !isIndicator(entry.layer));
    const overPrice = matches.filter((entry) => isIndicator(entry.layer)
        && !needsOwnBand(entry.layer.scale));
    const ownPane = matches.filter((entry) => isIndicator(entry.layer)
        && needsOwnBand(entry.layer.scale));

    return (
        <div className="flex w-72 flex-col gap-2">
            {/* Held at the top of the panel that scrolls rather than given a
                scroller of its own: a list that scrolls inside a panel that also
                scrolls stands two bars side by side, and a reader dragging one
                of them has to find out which is theirs. The negative margins let
                it cover the card's own padding once it is stuck there. */}
            <div className="sticky top-0 z-10 -mx-3 -mt-3 flex flex-col gap-2 bg-abyss-800 px-3 pb-1 pt-3">
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
                        onKeyDown={(event) => { addFirstMatch(event, matches, isFull, onAdd); }}
                        className={`${CONTROL_INPUT_CLASSES} pl-8 pr-2`}
                    />
                </div>

                {isFull && (
                    <p className="px-1 text-xs leading-snug text-amber">{translate('indicators.full')}</p>
                )}
            </div>

            <div>
                {matches.length === 0 && (
                    <p className="px-1 py-3 text-xs text-ink-500">{translate('indicators.noMatch')}</p>
                )}
                <IndicatorGroup
                    titleKey="indicators.theChart"
                    indicators={theChart}
                    isFull={isFull}
                    addedCounts={addedCounts}
                    onAdd={onAdd}
                />
                <IndicatorGroup
                    titleKey="indicators.overPrice"
                    indicators={overPrice}
                    isFull={isFull}
                    addedCounts={addedCounts}
                    onAdd={onAdd}
                />
                <IndicatorGroup
                    titleKey="indicators.ownPane"
                    indicators={ownPane}
                    isFull={isFull}
                    addedCounts={addedCounts}
                    onAdd={onAdd}
                />
            </div>
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
 * The indicators whose name or description answers what was typed.
 */
function findMatches(query: string, translate: Translate): readonly Offered[] {
    const wanted = query.trim().toLowerCase();
    const offered = listOfferedLayers();
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
