import { Combine, Eye, EyeOff, Settings2, Split, X } from 'lucide-react';
import type { ReactElement } from 'react';
import { findChartLayer } from '../../indicators/indicator-catalogue.ts';
import { findFieldLayer } from '../../indicators/field-layers.ts';
import { findLayerContribution, isLayerTunable } from '../../indicators/layer-contributions.ts';
import { groupPanedPlans, needsOwnBand } from '../../painting/pane-projector.ts';
import type { AddedIndicator } from '../../../shared/core/indicator-selection.ts';
import type { DrawPlan } from '../../../shared/core/draw-plan.ts';
import type { IndicatorControls } from '../../react/use-indicators.ts';
import type { ChartState } from '../../core/chart-controller.ts';
import { ToneSwatch } from './tone-swatch.tsx';
import { translateLabel } from '../../i18n/translator.ts';
import { useChartSlice } from '../../react/use-chart-state.ts';
import { useTranslate } from '../../react/use-appearance.ts';

const readPlans = (state: ChartState): readonly DrawPlan[] => state.plans;

/** Every action row's button, sized like the dock the panel opens from. */
const LAYER_BUTTON_CLASSES =
    'grid size-8 shrink-0 place-items-center rounded-md text-ink-500 transition-colors'
    + ' hover:bg-abyss-700 hover:text-ink-100 disabled:opacity-30';

const ICON_SIZE_PX = 15;

interface LayerListProps {
    readonly controls: IndicatorControls;
    readonly onOpenSettings: (instanceId: string) => void;
}

/**
 * What is on the chart, and everything that can be done to it.
 *
 * Gathered here rather than left along the rows over the chart: the same four
 * actions were repeated per row, at a size of their own, over the very data
 * they were about. A row is for what a layer *says*; this is for what a reader
 * does to it, and every control in it is the same size as every other.
 */
export function LayerList({ controls, onOpenSettings }: LayerListProps): ReactElement | null {
    const plans = useChartSlice(readPlans);
    const translate = useTranslate();
    if (controls.added.length === 0) {
        return null;
    }

    const planFor = new Map(plans.map((plan) => [plan.instanceId, plan]));
    const bands = groupPanedPlans(plans);

    return (
        <ul className="space-y-0.5" aria-label={translate('indicators.onTheChart')}>
            {controls.added.map((added) => (
                <LayerRow
                    key={added.instanceId}
                    added={added}
                    controls={controls}
                    onOpenSettings={onOpenSettings}
                    banding={resolveBanding(bands, planFor.get(added.instanceId) ?? null)}
                />
            ))}
        </ul>
    );
}

/** Which band a layer is in, and which one it could join. */
interface Banding {
    readonly isSharing: boolean;
    readonly joinable: string | null;
}

interface LayerRowProps {
    readonly added: AddedIndicator;
    readonly controls: IndicatorControls;
    readonly onOpenSettings: (instanceId: string) => void;
    readonly banding: Banding | null;
}

/**
 * One layer, named, with the four things a reader does to it.
 */
function LayerRow({ added, controls, onOpenSettings, banding }: LayerRowProps): ReactElement | null {
    const translate = useTranslate();
    const layer = findChartLayer(added.indicatorId);
    if (layer === null) {
        return null;
    }

    const isHidden = added.isHidden === true;
    // The depth map has a ramp of its own and the candles two colours that mean
    // something. Neither takes an identity colour.
    const isTinted = findFieldLayer(added.indicatorId) === null;
    const isRemovable = findLayerContribution(added.indicatorId)?.isRemovable !== false;

    return (
        <li className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-abyss-700/50">
            {isTinted
                ? <ToneSwatch tone={added.tone} className={`size-2 ${isHidden ? 'opacity-30' : ''}`} />
                : <span className="size-2 shrink-0" />}

            <span className={`min-w-0 flex-1 truncate text-xs ${isHidden ? 'text-ink-600' : 'text-ink-200'}`}>
                {translateLabel(translate, layer.labelKey)}
            </span>

            <LayerButton
                label={translate(isHidden ? 'indicators.show' : 'indicators.hide')}
                onPress={() => { controls.setVisibility(added.instanceId, !isHidden); }}
            >
                {isHidden ? <EyeOff size={ICON_SIZE_PX} /> : <Eye size={ICON_SIZE_PX} />}
            </LayerButton>

            {banding?.isSharing === true && (
                <LayerButton
                    label={translate('indicators.splitBand')}
                    onPress={() => { controls.setBand(added.instanceId, null); }}
                >
                    <Split size={ICON_SIZE_PX} />
                </LayerButton>
            )}

            {banding !== null && banding.joinable !== null && (
                <LayerButton
                    label={translate('indicators.mergeBand')}
                    onPress={() => { controls.setBand(added.instanceId, banding.joinable); }}
                >
                    <Combine size={ICON_SIZE_PX} />
                </LayerButton>
            )}

            <LayerButton
                label={translate('indicators.tune')}
                isDisabled={!isLayerTunable(layer)}
                onPress={() => { onOpenSettings(added.instanceId); }}
            >
                <Settings2 size={ICON_SIZE_PX} />
            </LayerButton>

            <LayerButton
                label={translate('indicators.remove')}
                isDisabled={!isRemovable}
                isDestructive
                onPress={() => { controls.remove(added.instanceId); }}
            >
                <X size={ICON_SIZE_PX} />
            </LayerButton>
        </li>
    );
}

interface LayerButtonProps {
    readonly label: string;
    readonly onPress: () => void;
    readonly children: ReactElement;
    readonly isDisabled?: boolean;
    readonly isDestructive?: boolean;
}

/**
 * One action of one layer, the same size as every other in the panel.
 */
function LayerButton({
    label,
    onPress,
    children,
    isDisabled = false,
    isDestructive = false,
}: LayerButtonProps): ReactElement {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            disabled={isDisabled}
            onClick={onPress}
            className={`${LAYER_BUTTON_CLASSES} ${isDestructive ? 'hover:text-ask' : ''}`}
        >
            {children}
        </button>
    );
}

/**
 * Which band a layer sits in, and which one above it it could join.
 *
 * @param bands - The banded plans, top to bottom.
 * @param plan - What the layer produced, or null when it is drawn over price.
 * @returns Its banding, or null when it has no band of its own.
 */
function resolveBanding(bands: readonly (readonly DrawPlan[])[], plan: DrawPlan | null): Banding | null {
    if (plan === null || !needsOwnBand(plan.scale)) {
        return null;
    }

    const index = bands.findIndex((band) => band.some((member) => member.instanceId === plan.instanceId));
    const band = bands[index];
    if (band === undefined) {
        return null;
    }

    const above = bands[index - 1] ?? null;
    return {
        isSharing: band.length > 1,
        joinable: above?.[0]?.instanceId ?? null,
    };
}
