import { Accordion } from 'radix-ui';
import { ChevronDown, Eye, EyeOff, X } from 'lucide-react';
import type { ReactElement } from 'react';
import type { ChartState } from '../../core/chart-controller.ts';
import type { AddedIndicator } from '../../../shared/core/indicator-selection.ts';
import { readSetting, type Tunable } from '../../../shared/core/draw-plan.ts';
import { findChartLayer, findIndicator } from '../../indicators/indicator-catalogue.ts';
import { IconButton } from '../icon-button.tsx';
import { findLayerContribution, isLayerTunable } from '../../indicators/layer-contributions.ts';
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
            // One card each rather than a divided list. A rule between rows says
            // where one ends; a card says what belongs to it, which is what a
            // reader needs when the thing it opens onto is a panel of controls.
            className="space-y-2"
        >
            {controls.added.length === 0 && (
                <p className="rounded-lg border border-dashed border-hairline px-3 py-4 text-center text-xs text-ink-500">
                    {translate('indicators.none')}
                </p>
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

    const contribution = findLayerContribution(added.indicatorId);
    const Panel = contribution?.Panel;
    // A layer the host draws, and one whose own colours are a reading, are both
    // drawn in colours that already mean something.
    const isTinted = findFieldLayer(added.indicatorId) === null
        && findIndicator(added.indicatorId)?.isSelfColoured !== true;
    const isHidden = added.isHidden === true;
    // A layer with nothing to tell it has nothing to open onto, and a control
    // that opens onto nothing teaches a reader that opening is not worth it.
    const isTunable = isLayerTunable(layer);

    return (
        <Accordion.Item
            value={added.instanceId}
            className="overflow-hidden rounded-lg border border-hairline bg-abyss-900/60 data-[state=open]:border-hairline-bright"
        >
            <div className="flex items-center gap-1 px-2 py-1">
                <Accordion.Trigger
                    disabled={!isTunable}
                    className="group flex min-w-0 flex-1 items-center gap-2 py-2 text-left disabled:cursor-default"
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

                <IconButton
                    label={translate(isHidden ? 'indicators.show' : 'indicators.hide')}
                    onClick={() => { controls.setVisibility(added.instanceId, !isHidden); }}
                >
                    {isHidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </IconButton>
                {contribution?.isRemovable !== false && (
                    <IconButton
                        tone="destructive"
                        label={translate('indicators.remove')}
                        onClick={() => { controls.remove(added.instanceId); }}
                    >
                        <X className="size-3.5" />
                    </IconButton>
                )}
            </div>

            <Accordion.Content className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                <div className="border-t border-hairline px-3 py-3">
                    <IndicatorParameters
                        indicator={layer}
                        hasTone={isTinted}
                        added={added}
                        onRetune={(name, value) => { controls.retune(added.instanceId, name, value); }}
                        onRecolour={(tone) => { controls.recolour(added.instanceId, tone); }}
                    />
                    {Panel !== undefined && <Panel state={state} />}
                </div>
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
