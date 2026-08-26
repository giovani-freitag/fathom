import { Accordion } from 'radix-ui';
import { ChevronDown, Eye, EyeOff, X } from 'lucide-react';
import type { ReactElement } from 'react';
import type { ChartState } from '../../core/chart-controller.ts';
import type { AddedIndicator } from '../../../shared/core/indicator-selection.ts';
import { type IndicatorParameter, readSetting } from '../../../shared/core/draw-plan.ts';

/** Anything with knobs a reader can turn. */
type Tunable = { readonly parameters: readonly IndicatorParameter[] };
import { BookPanel } from './book-panel.tsx';
import { findChartLayer } from '../../indicators/indicator-catalogue.ts';
import { findFieldLayer } from '../../indicators/field-layers.ts';
import { IndicatorParameters } from './indicator-parameters.tsx';
import type { IndicatorControls } from '../../react/use-indicators.ts';
import { ToneSwatch } from './tone-swatch.tsx';
import { translateLabel } from '../../i18n/translator.ts';
import { useTranslate } from '../../react/use-appearance.ts';

interface LayerAccordionProps {
    readonly controls: IndicatorControls;
    readonly state: ChartState;
    /** The layer to open on, or null to open on nothing. */
    readonly expanded: string | null;
    readonly onExpandedChange: (instanceId: string | null) => void;
}

/**
 * Everything on the chart, one row each, opening onto what it can be told.
 *
 * The row on the chart is for the things you do while looking at it — hiding
 * one, dropping one. Settling on a period is not that: it is fiddling, and
 * fiddling wants room and somewhere to put it that is not on top of the thing
 * being fiddled with.
 */
export function LayerAccordion({
    controls,
    state,
    expanded,
    onExpandedChange,
}: LayerAccordionProps): ReactElement {
    const translate = useTranslate();

    return (
        <Accordion.Root
            type="single"
            collapsible
            value={expanded ?? ''}
            onValueChange={(value) => { onExpandedChange(value === '' ? null : value); }}
            className="divide-y divide-hairline border-y border-hairline"
        >
            {controls.added.length === 0 && (
                <p className="py-3 text-xs text-ink-500">{translate('indicators.none')}</p>
            )}
            {controls.added.map((added) => (
                <LayerRow key={added.instanceId} added={added} controls={controls} state={state} />
            ))}
        </Accordion.Root>
    );
}

interface LayerRowProps {
    readonly added: IndicatorControls['added'][number];
    readonly controls: IndicatorControls;
    readonly state: ChartState;
}

function LayerRow({ added, controls, state }: LayerRowProps): ReactElement | null {
    const translate = useTranslate();
    const layer = findChartLayer(added.indicatorId);
    if (layer === null) {
        return null;
    }

    const isBook = added.indicatorId === 'depth';
    const isTinted = findFieldLayer(added.indicatorId) === null;
    const isHidden = added.isHidden === true;
    // A layer with nothing to tell it has nothing to open onto, and a control
    // that opens onto nothing teaches a reader that opening is not worth it.
    const isTunable = layer.parameters.length > 0 || isBook;

    return (
        <Accordion.Item value={added.instanceId}>
            <div className="flex items-center gap-2 py-1">
                <Accordion.Trigger
                    disabled={!isTunable}
                    className="group flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left disabled:cursor-default"
                >
                    {isTunable && (
                        <ChevronDown className="size-3.5 shrink-0 text-ink-500 transition-transform group-data-[state=open]:rotate-180" />
                    )}
                    {!isTunable && <span className="size-3.5 shrink-0" />}
                    {isTinted && <ToneSwatch tone={added.tone} className="size-2 shrink-0" />}
                    <span className={`truncate text-sm ${isHidden ? 'text-ink-500 line-through decoration-ink-700' : 'text-ink-100'}`}>
                        {translateLabel(translate, layer.labelKey)}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-ink-500">
                        {summariseTuning(layer, added)}
                    </span>
                </Accordion.Trigger>

                <button
                    type="button"
                    aria-label={translate(isHidden ? 'indicators.show' : 'indicators.hide')}
                    onClick={() => { controls.setVisibility(added.instanceId, !isHidden); }}
                    className="grid size-8 shrink-0 place-items-center rounded text-ink-500 hover:bg-abyss-700 hover:text-ink-100"
                >
                    {isHidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
                <button
                    type="button"
                    aria-label={translate('indicators.remove')}
                    onClick={() => { controls.remove(added.instanceId); }}
                    className="grid size-8 shrink-0 place-items-center rounded text-ink-500 hover:bg-abyss-700 hover:text-ask"
                >
                    <X className="size-4" />
                </button>
            </div>

            <Accordion.Content className="overflow-hidden pb-3 data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                <IndicatorParameters
                    indicator={layer}
                    hasTone={isTinted}
                    added={added}
                    onRetune={(name, value) => { controls.retune(added.instanceId, name, value); }}
                    onRecolour={(tone) => { controls.recolour(added.instanceId, tone); }}
                />
                {isBook && <BookPanel state={state} />}
            </Accordion.Content>
        </Accordion.Item>
    );
}

/**
 * The parameters that tell one copy from another.
 *
 * Two of the same indicator read alike without them, and the panel is where a
 * reader goes to tune the right one of the two.
 */
function summariseTuning(layer: Tunable, added: AddedIndicator): string {
    const counts: string[] = [];
    for (const parameter of layer.parameters) {
        if (parameter.kind === 'integer') {
            counts.push(String(readSetting(added.settings, parameter)));
        }
    }
    return counts.join(' · ');
}
