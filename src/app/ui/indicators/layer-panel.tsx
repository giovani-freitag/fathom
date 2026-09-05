import { PANEL_ADD_CLASSES } from '../control-shell.ts';
import { Plus } from 'lucide-react';
import { type ReactElement, type ReactNode, useMemo, useState } from 'react';
import type { IndicatorControls } from '../../react/use-indicators.ts';
import { IndicatorPalette } from './indicator-palette.tsx';
import { LayerList } from './layer-list.tsx';
import { PanelStep } from '../panel-step.tsx';
import { PanelTakeoverContext } from './panel-takeover.ts';
import { findChartLayer } from '../../indicators/indicator-catalogue.ts';
import { findLayerContribution, isLayerRecolourable } from '../../indicators/layer-contributions.ts';
import { IndicatorParameters } from './indicator-parameters.tsx';
import { translateLabel } from '../../i18n/translator.ts';
import { useChartState } from '../../react/use-chart-state.ts';
import { useVenue } from '../../react/use-venue.ts';
import { useTranslate } from '../../react/use-appearance.ts';

interface LayerPanelProps {
    readonly controls: IndicatorControls;
    /** Opens the editor, on a saved reading where one is named. */
    readonly onEditReading?: ((key?: string) => void) | undefined;
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
export function LayerPanel({ controls, onEditReading }: LayerPanelProps): ReactElement {
    const translate = useTranslate();
    const venue = useVenue();
    const [view, setView] = useState<PanelView>({ kind: 'list' });
    const showList = (): void => { setView({ kind: 'list' }); };

    if (view.kind === 'add') {
        return (
            <PanelStep onBack={showList} title={translate('indicators.onTheChart')}>
                <IndicatorPalette
                    hasAutoFocus
                    venue={venue}
                    onAdd={(indicatorId) => {
                        controls.add(indicatorId);
                        showList();
                    }}
                    isFull={controls.isFull}
                    addedCounts={controls.addedCounts}
                    {...onEditReading === undefined ? {} : { onEdit: onEditReading }}
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
        <div className="flex w-72 flex-col gap-2">
            <LayerList
                controls={controls}
                {...onEditReading === undefined ? {} : { onEditReading }}
                onOpenSettings={(instanceId) => { setView({ kind: 'tune', instanceId }); }}
            />

            <button
                type="button"
                disabled={controls.isFull}
                onClick={() => { setView({ kind: 'add' }); }}
                className={PANEL_ADD_CLASSES}
            >
                <Plus className="size-4" />
                {translate('indicators.add')}
            </button>
        </div>
    );
}

export interface LayerKnobsProps {
    readonly controls: IndicatorControls;
    readonly instanceId: string;
    /**
     * Offered on the name's own line, for whoever opened this.
     *
     * A line of its own for one glyph is a line of empty panel beside it, and
     * the name is what the glyph is about.
     */
    readonly action?: ReactNode;
}

/**
 * Everything one layer can be tuned by.
 *
 * Reached from the row it belongs to rather than from a drawer of its own: the
 * reader pressed a control beside a name, and what opens should be about that
 * name and nothing else.
 */
export function LayerKnobs({ controls, instanceId, action }: LayerKnobsProps): ReactElement | null {
    const translate = useTranslate();
    const state = useChartState();
    const [isTaken, setIsTaken] = useState(false);
    const takeover = useMemo(() => ({ take: setIsTaken }), []);
    const added = controls.added.find((entry) => entry.instanceId === instanceId);
    const layer = added === undefined ? null : findChartLayer(added.indicatorId);
    if (added === undefined || layer === null) {
        return null;
    }

    const Panel = findLayerContribution(added.indicatorId)?.Panel;
    const hasTone = isLayerRecolourable(added.indicatorId);

    return (
        <div className="flex w-72 flex-col gap-3">
            {!isTaken && (
                <>
                    <div className="flex min-h-6 items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-ink-100">
                            {translateLabel(translate, layer.label)}
                        </span>
                        {action}
                    </div>
                    <IndicatorParameters
                        indicator={layer}
                        hasTone={hasTone}
                        added={added}
                        onRetune={(name, value) => { controls.retune(instanceId, name, value); }}
                        onRecolour={(tone) => { controls.recolour(instanceId, tone); }}
                    />
                </>
            )}
            <PanelTakeoverContext.Provider value={takeover}>
                {Panel !== undefined && <Panel state={state} />}
            </PanelTakeoverContext.Provider>
        </div>
    );
}
