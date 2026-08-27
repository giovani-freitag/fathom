import { ArrowLeft, Plus } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import type { IndicatorControls } from '../../react/use-indicators.ts';
import { IndicatorPalette } from './indicator-palette.tsx';
import { LayerList } from './layer-list.tsx';
import { findChartLayer, findIndicator } from '../../indicators/indicator-catalogue.ts';
import { findFieldLayer } from '../../indicators/field-layers.ts';
import { findLayerContribution } from '../../indicators/layer-contributions.ts';
import { IndicatorParameters } from './indicator-parameters.tsx';
import { translateLabel } from '../../i18n/translator.ts';
import { useChartState } from '../../react/use-chart-state.ts';
import { useTranslate } from '../../react/use-appearance.ts';

interface LayerPanelProps {
    readonly controls: IndicatorControls;
}

/** What the panel is showing: the list, the catalogue, or one layer's knobs. */
type PanelView = { readonly kind: 'list' } | { readonly kind: 'add' } | {
    readonly kind: 'tune';
    readonly instanceId: string;
};

/**
 * The one place layers live.
 *
 * They used to be in three: a drawer that listed them, a button that opened the
 * catalogue, and a keyboard chord that opened the same catalogue somewhere
 * else. A reader looking for the one they had added had to know which of the
 * three had it.
 *
 * What is on the chart, and one way to add another — the catalogue takes the
 * panel over rather than opening a second thing on top of it, because it
 * answers the same question the panel was already about.
 */
export function LayerPanel({ controls }: LayerPanelProps): ReactElement {
    const translate = useTranslate();
    const [view, setView] = useState<PanelView>({ kind: 'list' });
    const showList = (): void => { setView({ kind: 'list' }); };

    if (view.kind === 'add') {
        return (
            <PanelStep onBack={showList} title={translate('indicators.onTheChart')}>
                <IndicatorPalette
                    hasAutoFocus
                    onAdd={(indicatorId) => {
                        controls.add(indicatorId);
                        showList();
                    }}
                    isFull={controls.isFull}
                    addedCounts={controls.addedCounts}
                />
            </PanelStep>
        );
    }

    if (view.kind === 'tune') {
        return (
            <PanelStep onBack={showList} title={translate('indicators.onTheChart')}>
                <LayerKnobs controls={controls} instanceId={view.instanceId} />
            </PanelStep>
        );
    }

    return (
        <div className="flex w-64 flex-col gap-2">
            <LayerList
                controls={controls}
                onOpenSettings={(instanceId) => { setView({ kind: 'tune', instanceId }); }}
            />

            <button
                type="button"
                disabled={controls.isFull}
                onClick={() => { setView({ kind: 'add' }); }}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-hairline px-3 py-2 text-xs font-semibold text-ink-400 transition-colors hover:border-hairline-bright hover:text-ink-100 disabled:opacity-40"
            >
                <Plus className="size-4" />
                {translate('indicators.add')}
            </button>
        </div>
    );
}

interface PanelStepProps {
    readonly title: string;
    readonly onBack: () => void;
    readonly children: ReactElement;
}

/**
 * One step in from the list, with the way back where a reader looks for it.
 */
function PanelStep({ title, onBack, children }: PanelStepProps): ReactElement {
    return (
        <div className="flex flex-col gap-2">
            <button
                type="button"
                onClick={onBack}
                className="flex items-center gap-1.5 self-start rounded-md px-1 py-0.5 text-xs text-ink-500 hover:text-ink-100"
            >
                <ArrowLeft className="size-3.5" />
                {title}
            </button>
            {children}
        </div>
    );
}

interface LayerKnobsProps {
    readonly controls: IndicatorControls;
    readonly instanceId: string;
}

/**
 * Everything one layer can be tuned by.
 *
 * Reached from the row it belongs to rather than from a drawer of its own: the
 * reader pressed a control beside a name, and what opens should be about that
 * name and nothing else.
 */
function LayerKnobs({ controls, instanceId }: LayerKnobsProps): ReactElement | null {
    const translate = useTranslate();
    const state = useChartState();
    const added = controls.added.find((entry) => entry.instanceId === instanceId);
    const layer = added === undefined ? null : findChartLayer(added.indicatorId);
    if (added === undefined || layer === null) {
        return null;
    }

    const Panel = findLayerContribution(added.indicatorId)?.Panel;
    // A layer the host draws, and one whose own colours are a reading, are both
    // drawn in colours that already mean something.
    const hasTone = findFieldLayer(added.indicatorId) === null
        && findIndicator(added.indicatorId)?.isSelfColoured !== true;

    return (
        <div className="flex w-72 flex-col gap-3">
            <span className="text-xs font-semibold text-ink-100">
                {translateLabel(translate, layer.labelKey)}
            </span>
            <IndicatorParameters
                indicator={layer}
                hasTone={hasTone}
                added={added}
                onRetune={(name, value) => { controls.retune(instanceId, name, value); }}
                onRecolour={(tone) => { controls.recolour(instanceId, tone); }}
            />
            {Panel !== undefined && <Panel state={state} />}
        </div>
    );
}
