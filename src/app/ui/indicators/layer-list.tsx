import { Code2, Combine, Eye, EyeOff, Settings2, Split, X } from 'lucide-react';
import type { ReactElement } from 'react';
import { findChartLayer } from '../../indicators/indicator-catalogue.ts';
import { findFieldLayer } from '../../indicators/field-layers.ts';
import { findLayerContribution, isLayerTunable } from '../../indicators/layer-contributions.ts';
import { isAddonId } from '../../addons/addon-registry.ts';
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

/**
 * Every action row's button, sized like the dock the panel opens from.
 *
 * Wider where a finger is doing the pressing. Thirty-two pixels is a
 * comfortable target for a pointer and an uncomfortable one for a thumb, and
 * this panel sits over a surface that owns pan and zoom — a press that misses
 * does not do nothing, it moves the chart.
 */
export const LAYER_BUTTON_CLASSES =
    'grid size-10 shrink-0 place-items-center rounded-md text-ink-500 transition-colors'
    + ' sm:size-8 hover:bg-abyss-700 hover:text-ink-100 disabled:opacity-30';

/** Holds a slot open so the actions of every row line up in one column. */
const LAYER_SLOT_CLASSES = 'size-10 shrink-0 sm:size-8';

export const ICON_SIZE_PX = 15;

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
 * A row for a layer the build can no longer find.
 *
 * Shown rather than skipped: a reading a reader wrote and then deleted leaves
 * its selection behind, and a row that renders nothing is one they cannot see
 * to remove. It drew nothing either way; the difference is whether they can
 * tidy it up.
 */
function MissingLayerRow({ added, controls }: {
    readonly added: AddedIndicator;
    readonly controls: IndicatorControls;
}): ReactElement {
    const translate = useTranslate();

    return (
        <li className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-abyss-700/50">
            <span className="size-2 shrink-0" />
            <span
                title={added.indicatorId}
                className="min-w-0 flex-1 truncate text-xs italic text-ink-400"
            >
                {translate('indicators.missing')}
            </span>
            <LayerButton
                label={translate('indicators.remove')}
                onPress={() => { controls.remove(added.instanceId); }}
            >
                <X size={ICON_SIZE_PX} />
            </LayerButton>
        </li>
    );
}


/**
 * One layer, named, with the four things a reader does to it.
 *
 * What it reads is not here. A panel is where a reader acts on layers, and a
 * reading is a different length for every one of them: mixed in, no two rows
 * were the same height and the run of them read as ragged rather than as a
 * list. What each layer says belongs beside what it says it about.
 */
function LayerRow({ added, controls, onOpenSettings, banding }: LayerRowProps): ReactElement | null {
    const translate = useTranslate();
    const layer = findChartLayer(added.indicatorId);
    if (layer === null) {
        return <MissingLayerRow added={added} controls={controls} />;
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

            {/* Titled as well as written: the box it sits in is what is left
                after the actions, and a name that does not fit is exactly the
                one a reader opened this list to find. */}
            <span
                title={translateLabel(translate, layer.label)}
                className={`min-w-0 flex-1 truncate text-xs ${isHidden ? 'text-ink-600 line-through decoration-ink-700' : 'text-ink-200'}`}
            >
                {translateLabel(translate, layer.label)}
            </span>

            {/* Which of these a reader wrote themselves, on the one list where
                theirs and ours sit in the same column. Without it, a reading
                that draws something surprising gives no clue whose arithmetic
                to go and look at. */}
            {isAddonId(added.indicatorId) && (
                <Code2
                    size={11}
                    aria-label={translate('indicators.yours')}
                    className="shrink-0 text-ink-600"
                />
            )}

            <LayerButton
                label={translate(isHidden ? 'indicators.show' : 'indicators.hide')}
                onPress={() => { controls.setVisibility(added.instanceId, !isHidden); }}
            >
                {isHidden ? <EyeOff size={ICON_SIZE_PX} /> : <Eye size={ICON_SIZE_PX} />}
            </LayerButton>

            {/* One slot, held open whether or not this row has a band action.
                Rows that gained a fourth button broke the column for every
                other, in a list whose whole job is telling one line from
                another. */}
            {renderBandAction({ banding, instanceId: added.instanceId, controls, translate })}

            {/* Absent rather than dead for a layer with no knobs. A control
                that can never be used still reads as one that could be. */}
            {isLayerTunable(added.indicatorId)
                ? (
                    <LayerButton
                        label={translate('indicators.tune')}
                        onPress={() => { onOpenSettings(added.instanceId); }}
                    >
                        <Settings2 size={ICON_SIZE_PX} />
                    </LayerButton>
                )
                : <span className={LAYER_SLOT_CLASSES} />}

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

interface BandActionRequest {
    readonly banding: Banding | null;
    readonly instanceId: string;
    readonly controls: IndicatorControls;
    readonly translate: ReturnType<typeof useTranslate>;
}

/**
 * The one thing a row can do about the band it is in, or nothing in its place.
 *
 * Splitting and joining are alternatives — a layer either has a band to itself
 * or shares one — so they take one slot between them, and the slot is held open
 * for a row that can do neither.
 *
 * @param request - Where the layer sits, which copy it is, and what can act.
 * @returns The button, or an empty slot the width of one.
 */
function renderBandAction({
    banding,
    instanceId,
    controls,
    translate,
}: BandActionRequest): ReactElement {
    if (banding?.isSharing === true) {
        return (
            <LayerButton
                label={translate('indicators.splitBand')}
                onPress={() => { controls.setBand(instanceId, null); }}
            >
                <Split size={ICON_SIZE_PX} />
            </LayerButton>
        );
    }
    if (banding !== null && banding.joinable !== null) {
        const joinable = banding.joinable;
        return (
            <LayerButton
                label={translate('indicators.mergeBand')}
                onPress={() => { controls.setBand(instanceId, joinable); }}
            >
                <Combine size={ICON_SIZE_PX} />
            </LayerButton>
        );
    }
    return <span className={LAYER_SLOT_CLASSES} />;
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
