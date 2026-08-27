import { CONTROL_INPUT_CLASSES } from '../control-shell.ts';
import { type ReactElement, useMemo, useState } from 'react';
import type { FieldLayer, Indicator } from '../../../shared/core/draw-plan.ts';

import { CHART_LAYERS } from '../../indicators/indicator-catalogue.ts';
import { findFieldLayer } from '../../indicators/field-layers.ts';
import { needsOwnBand } from '../../painting/pane-projector.ts';
import { Search } from 'lucide-react';

type Offered = Indicator | FieldLayer;
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

    const theChart = matches.filter((entry) => findFieldLayer(entry.id) !== null);
    const overPrice = matches.filter((entry) => findFieldLayer(entry.id) === null
        && !needsOwnBand((entry as Indicator).scale));
    const ownPane = matches.filter((entry) => findFieldLayer(entry.id) === null
        && needsOwnBand((entry as Indicator).scale));

    return (
        <div className="flex w-72 flex-col gap-2">
            <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-ink-500" />
                <input
                    type="search"
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

            <div className="max-h-[min(28rem,60vh)] overflow-y-auto">
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
            {indicators.map((indicator) => (
                <button
                    key={indicator.id}
                    type="button"
                    disabled={isFull || (findFieldLayer(indicator.id) !== null && (addedCounts.get(indicator.id) ?? 0) > 0)}
                    onClick={() => { onAdd(indicator.id); }}
                    className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-2 text-left transition-colors hover:bg-abyss-700 disabled:opacity-40 disabled:hover:bg-transparent"
                >
                    <span className="flex w-full items-center gap-2 text-sm font-semibold text-ink-100">
                        {translateLabel(translate, indicator.labelKey)}
                        {(addedCounts.get(indicator.id) ?? 0) > 0 && (
                            <span className="rounded-full bg-phosphor/15 px-1.5 text-[10px] font-semibold text-phosphor">
                                {addedCounts.get(indicator.id)}
                            </span>
                        )}
                    </span>
                    <span className="text-xs leading-snug text-ink-500">
                        {translateLabel(translate, `${indicator.labelKey}.help`)}
                    </span>
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
    if (wanted === '') {
        return CHART_LAYERS;
    }

    return CHART_LAYERS.filter((indicator) => {
        const name = translateLabel(translate, indicator.labelKey).toLowerCase();
        const help = translateLabel(translate, `${indicator.labelKey}.help`).toLowerCase();
        // The id as well as the rendered name, so a reader who knows the term in
        // English finds it in a language that shortens it differently.
        return name.includes(wanted) || help.includes(wanted) || indicator.id.includes(wanted);
    });
}
