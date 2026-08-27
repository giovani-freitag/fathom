import { ChevronDown, Layers } from 'lucide-react';
import { memo, type ReactElement } from 'react';
import type { AddedIndicator } from '../../../shared/core/indicator-selection.ts';
import type { ChartLayout } from '../../painting/render-types.ts';
import type { ChartState } from '../../core/chart-controller.ts';
import type { DrawPlan } from '../../../shared/core/draw-plan.ts';
import { findChartLayer } from '../../indicators/indicator-catalogue.ts';
import { findFieldLayer } from '../../indicators/field-layers.ts';
import { findLayerContribution } from '../../indicators/layer-contributions.ts';
import { groupPanedPlans, needsOwnBand } from '../../painting/pane-projector.ts';
import type { IndicatorControls } from '../../react/use-indicators.ts';
import { LayerReading } from './layer-reading.tsx';
import { ToneSwatch } from './tone-swatch.tsx';
import { translateLabel } from '../../i18n/translator.ts';
import { useAppearance, useTranslate } from '../../react/use-appearance.ts';
import { useChartSlice } from '../../react/use-chart-state.ts';
import { useKernel } from '../../react/kernel-context.ts';

/** Declared once so the subscription is the same one on every render. */
const readPlans = (state: ChartState): readonly DrawPlan[] => state.plans;

/** Clear space under the depth key, where the price pane's own rows start. */
const PRICE_ROWS_TOP_PX = 44;

/** Room the fold control takes above the rows it folds. */
const FOLD_HEIGHT_PX = 26;
const ROWS_LEFT_PX = 12;
const PANE_ROW_TOP_PX = 3;

interface ChartLegendProps {
    readonly controls: IndicatorControls;
    readonly layout: ChartLayout;
}

/**
 * Names each indicator at the top of the band it is drawn in, and says what it
 * reads there.
 *
 * Beside what it describes rather than behind a settings screen: the reader
 * comparing a reading against the price is looking at the price.
 *
 * What it *says* only. The four things a reader does to a layer were repeated
 * along every row, at a size of their own, over the very data they were about;
 * they are one panel away now, all the same size, in the dock.
 */
export function ChartLegend({ controls, layout }: ChartLegendProps): ReactElement {
    const plans = useChartSlice(readPlans);
    const { isLegendCollapsed: isCollapsed } = useAppearance();
    const planFor = new Map(plans.map((plan) => [plan.instanceId, plan]));
    const bands = groupPanedPlans(plans);

    // Rows come from what was added rather than from what was drawn, so an
    // indicator that is being kept without being drawn still has the control
    // that brings it back.
    const overPrice = controls.added.filter((entry) => {
        const plan = planFor.get(entry.instanceId) ?? null;
        return readsSomething(entry, plan) && (plan === null || !needsOwnBand(plan.scale));
    });

    return (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div
                className="absolute flex flex-col items-start gap-1"
                style={{ left: ROWS_LEFT_PX, top: PRICE_ROWS_TOP_PX }}
            >
                {/* Folding one row saves one line and costs one: the control
                    is offered once there is more than that to put away. */}
                {overPrice.length > 1 && <LegendFold count={overPrice.length} />}
            </div>

            <ul
                className="absolute flex flex-col items-start gap-1"
                style={{ left: ROWS_LEFT_PX, top: PRICE_ROWS_TOP_PX + FOLD_HEIGHT_PX }}
                hidden={isCollapsed}
            >
                {overPrice.map((added) => (
                    <LegendRow
                        key={added.instanceId}
                        added={added}
                        plan={planFor.get(added.instanceId) ?? null}
                    />
                ))}
            </ul>

            {bands.map((band, index) => {
                const pane = layout.indicatorPanes[index];
                return pane === undefined ? null : (
                    <ul
                        key={band[0]!.instanceId}
                        // Laid out along the top of the band rather than down
                        // into it: a second row stacked below the first lands on
                        // the very line it is naming.
                        className="absolute flex flex-wrap items-start gap-x-2 gap-y-1 pr-24"
                        style={{ left: ROWS_LEFT_PX, top: pane.topY + PANE_ROW_TOP_PX }}
                    >
                        {band.map((plan) => {
                            const added = controls.added.find(
                                (entry) => entry.instanceId === plan.instanceId,
                            );
                            return added === undefined || !readsSomething(added, plan) ? null : (
                                <LegendRow
                                    key={plan.instanceId}
                                    added={added}
                                    plan={plan}
                                    banding={resolveBanding(band, bands[index - 1] ?? null, plan)}
                                />
                            );
                        })}
                    </ul>
                );
            })}
        </div>
    );
}

/** What a row may do about which band it is drawn in. */
interface RowBanding {
    /** The band it could join, or null when there is none it belongs with. */
    readonly joinable: string | null;
    /** True when it is already sharing, so it can be given one of its own. */
    readonly isSharing: boolean;
}

/**
 * Which band move a row can offer.
 *
 * Only a band on the same kind of scale is offered. Two readings put together
 * have to share one ruler, and squashing a nought-to-hundred reading in beside
 * a signed one leaves both unreadable.
 */
function resolveBanding(
    band: readonly DrawPlan[],
    above: readonly DrawPlan[] | null,
    plan: DrawPlan,
): RowBanding {
    const isSharing = band.length > 1;
    const neighbour = above?.[0];
    const isCompatible = neighbour !== undefined && neighbour.scale.kind === plan.scale.kind;

    return {
        joinable: isCompatible ? neighbour.bandKey ?? neighbour.instanceId ?? null : null,
        isSharing,
    };
}

/**
 * Whether a layer has anything to say over the chart.
 *
 * A layer that reads nothing there used to take a row anyway, for the controls
 * it carried. Those are one panel away now, and a row that is only a name is
 * chart nobody can see.
 *
 * @param added - The layer as the reader added it.
 * @param plan - What it produced, or null while it is kept without being drawn.
 * @returns True when a row for it would carry a reading.
 */
function readsSomething(added: AddedIndicator, plan: DrawPlan | null): boolean {
    if (added.isHidden === true) {
        return false;
    }
    return plan !== null || findLayerContribution(added.indicatorId)?.Readout !== undefined;
}

interface LegendRowProps {
    readonly added: AddedIndicator;
    /** Absent while the indicator is being kept without being drawn. */
    readonly plan: DrawPlan | null;
    /** Absent for a row drawn over the price, which shares the price's scale already. */
    readonly banding?: RowBanding;
}

function LegendRowContent({ added, plan }: LegendRowProps): ReactElement | null {
    const translate = useTranslate();
    const layer = findChartLayer(added.indicatorId);
    if (layer === null) {
        return null;
    }

    // The depth map has a ramp of its own, and the candles have two colours
    // that mean something. Neither takes an identity colour.
    const isTinted = findFieldLayer(added.indicatorId) === null;
    const contribution = findLayerContribution(added.indicatorId);
    const Readout = contribution?.Readout;

    const hasSettled = plan === null || plan.hasConverged;
    const unsettled = hasSettled ? undefined : translate('indicators.unconverged');

    return (
        <li
            title={unsettled}
            className="pointer-events-none flex items-center gap-2 rounded bg-abyss-900/60 px-1.5 py-0.5 backdrop-blur-sm"
        >
            {isTinted && <ToneSwatch tone={added.tone} className="size-2" />}
            <span className={resolveNameClasses(hasSettled)}>
                {translateLabel(translate, layer.labelKey)}
            </span>
            <LayerReading added={added} plan={plan} layer={layer} />
            {Readout !== undefined && <Readout />}

        </li>
    );
}

/**
 * How a row's name reads: dimmed while kept but not drawn, amber while unsettled.
 */
function resolveNameClasses(hasSettled: boolean): string {
    // Hidden has no case here any more: a layer that is not drawn takes no row,
    // so a struck-through name over the chart would name nothing on it.
    return `text-xs font-semibold ${hasSettled ? 'text-ink-100' : 'text-amber'}`;
}

/**
 * Re-rendered only when the row itself changes.
 *
 * What moves under the cursor lives in children of its own, so a row whose
 * name, tuning and controls are unchanged has nothing to redraw.
 */
const LegendRow = memo(LegendRowContent);

/**
 * Folds the rows over the price away, and says how many are folded.
 *
 * A run of rows whose widths follow whatever each one has to say is a ragged
 * edge over the chart, and the chart is the thing being read. Folded, what is on
 * it is still countable without being in the way.
 */
function LegendFold({ count }: { readonly count: number }): ReactElement {
    const kernel = useKernel();
    const translate = useTranslate();
    const { isLegendCollapsed } = useAppearance();

    return (
        <button
            type="button"
            aria-expanded={!isLegendCollapsed}
            aria-label={translate(isLegendCollapsed ? 'legend.expand' : 'legend.collapse')}
            onClick={() => { kernel.appearance.setLegendCollapsed(!isLegendCollapsed); }}
            className="pointer-events-auto flex items-center gap-1.5 rounded border border-transparent bg-abyss-900/70 px-2 py-1 text-ink-500 backdrop-blur-sm transition-colors hover:border-hairline hover:text-ink-100"
        >
            <Layers className="size-3.5" />
            <span className="numeric text-[11px]">{count}</span>
            <ChevronDown
                className={`size-3 transition-transform ${isLegendCollapsed ? '' : 'rotate-180'}`}
            />
        </button>
    );
}
