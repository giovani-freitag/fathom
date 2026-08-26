import { Combine, Eye, EyeOff, Settings2, Split, X } from 'lucide-react';
import type { ReactElement } from 'react';
import type { DrawPlan, PlotTone } from '../../../shared/core/draw-plan.ts';
import { readChoice, readSetting, readValueAt } from '../../../shared/core/draw-plan.ts';
import type { Tunable } from '../../../shared/core/draw-plan.ts';
import { formatFixed } from '../../core/formatting.ts';
import { useCursorInstant } from '../../react/use-cursor-instant.ts';
import { findChartLayer } from '../../indicators/indicator-catalogue.ts';
import { findFieldLayer } from '../../indicators/field-layers.ts';
import { findLayerContribution } from '../../indicators/layer-contributions.ts';
import { groupPanedPlans, needsOwnBand } from '../../painting/pane-projector.ts';
import type { ChartLayout } from '../../painting/render-types.ts';
import type { IndicatorControls } from '../../react/use-indicators.ts';
import type { AddedIndicator } from '../../../shared/core/indicator-selection.ts';
import type { ChartState } from '../../core/chart-controller.ts';
import { useChartState } from '../../react/use-chart-state.ts';
import { useTranslate } from '../../react/use-appearance.ts';
import { translateLabel } from '../../i18n/translator.ts';
import type { Translate } from '../../i18n/translator.ts';
import { ToneSwatch } from './tone-swatch.tsx';

/** Clear space under the depth key, where the price pane's own rows start. */
const PRICE_ROWS_TOP_PX = 44;
const ROWS_LEFT_PX = 12;
const PANE_ROW_TOP_PX = 3;

interface IndicatorLegendProps {
    readonly controls: IndicatorControls;
    readonly layout: ChartLayout;
    readonly onOpenSettings: (instanceId: string) => void;
}

/**
 * Names each indicator at the top of the band it is drawn in.
 *
 * Beside what it describes rather than behind a settings screen: the reader
 * comparing a reading against the price is looking at the price, and a control
 * they have to leave the chart to reach is one they retune less often than they
 * would like to.
 */
export function IndicatorLegend({ controls, layout, onOpenSettings }: IndicatorLegendProps): ReactElement {
    const state = useChartState();
    const planFor = new Map(state.plans.map((plan) => [plan.instanceId, plan]));
    const bands = groupPanedPlans(state.plans);

    // Rows come from what was added rather than from what was drawn, so an
    // indicator that is being kept without being drawn still has the control
    // that brings it back.
    const overPrice = controls.added.filter((entry) => {
        const plan = planFor.get(entry.instanceId);
        return plan === undefined || !needsOwnBand(plan.scale);
    });

    return (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <ul
                className="absolute flex flex-col items-start gap-1"
                style={{ left: ROWS_LEFT_PX, top: PRICE_ROWS_TOP_PX }}
            >
                {overPrice.map((added) => (
                    <LegendRow
                        key={added.instanceId}
                        added={added}
                        plan={planFor.get(added.instanceId) ?? null}
                        state={state}
                        controls={controls}
                        onOpenSettings={onOpenSettings}
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
                            return added === undefined ? null : (
                                <LegendRow
                                    key={plan.instanceId}
                                    added={added}
                                    plan={plan}
                                    state={state}
                                    controls={controls}
                                    onOpenSettings={onOpenSettings}
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

/**
 * What each of a plan's series reads where the pointer is.
 *
 * With no pointer it reads the newest bar rather than showing nothing. Two
 * reasons, and the second is the one that matters: a chart at rest should still
 * say what its indicators read, and a row that empties as the pointer leaves the
 * canvas changes width under the hand reaching for its controls — which lands
 * the click somewhere else and reads as a dead button.
 */
function CursorValues({ plan }: { readonly plan: DrawPlan }): ReactElement | null {
    const atMs = useCursorInstant() ?? Number.POSITIVE_INFINITY;

    return (
        <span className="flex items-center gap-2">
            {plan.series.map((series) => {
                const value = readValueAt(series, atMs);
                return Number.isFinite(value) ? (
                    <span
                        key={series.labelKey}
                        className="text-xs tabular-nums"
                        style={{ color: `var(--color-${TONE_VARIABLES[series.tone]})` }}
                    >
                        {formatFixed(value, resolveReadoutDigits(value))}
                    </span>
                ) : null;
            })}
        </span>
    );
}

/** The theme variable each tone is painted from, matching what the canvas uses. */
const TONE_VARIABLES: Record<PlotTone, string> = {
    phosphor: 'phosphor',
    amber: 'amber',
    violet: 'violet',
    cyan: 'cyan',
    ask: 'ask',
    bid: 'bid',
    ink: 'ink-100',
    muted: 'ink-500',
};

/**
 * Decimal places that keep a reading precise without spelling out noise.
 */
function resolveReadoutDigits(value: number): number {
    const size = Math.abs(value);
    if (size >= 1_000) {
        return 0;
    }
    return size >= 1 ? 2 : 4;
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

interface LegendRowProps {
    readonly added: AddedIndicator;
    /** Absent while the indicator is being kept without being drawn. */
    readonly plan: DrawPlan | null;
    /** For a layer that reads the window rather than a plan built from it. */
    readonly state: ChartState;
    readonly controls: IndicatorControls;
    readonly onOpenSettings: (instanceId: string) => void;
    /** Absent for a row drawn over the price, which shares the price's scale already. */
    readonly banding?: RowBanding;
}

function LegendRow({ added, plan, state, controls, onOpenSettings, banding }: LegendRowProps): ReactElement | null {
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
    const hasPanel = contribution?.Panel !== undefined;
    // A control that opens onto nothing teaches a reader that opening is not
    // worth it, so a layer with nothing to tell it does not offer one.
    const isTunable = layer.parameters.length > 0 || hasPanel;

    const isHidden = added.isHidden === true;
    const hasSettled = plan === null || plan.hasConverged;
    const unsettled = hasSettled ? undefined : translate('indicators.unconverged');

    return (
        <li
            title={unsettled}
            className="group pointer-events-auto flex items-center gap-2 rounded border border-transparent bg-abyss-900/70 px-2 py-1 backdrop-blur-sm transition-colors hover:border-hairline"
        >
            {isTinted && <ToneSwatch tone={added.tone} className={`size-2 ${isHidden ? 'opacity-30' : ''}`} />}
            <span className={resolveNameClasses(isHidden, hasSettled)}>
                {translateLabel(translate, layer.labelKey)}
            </span>
            {/*
                A host layer's knobs are about how it looks, not what it says.
                A reading's parameters change what it claims, so they belong
                beside its name; an intensity does not.
            */}
            <span className="text-xs tabular-nums text-ink-500">
                {plan?.parameterSummary ?? (isTinted ? summariseSettings(layer, added) : '')}
            </span>
            {describeChosenSource(layer, added, translate)}
            {plan !== null && <CursorValues plan={plan} />}
            {Readout !== undefined && !isHidden && <Readout state={state} />}

            {/*
                Half-lit at rest rather than hidden. A control that only exists
                on hover is one a first-time reader never learns is there, and
                one a finger cannot reach at all.
            */}
            <span className="flex items-center gap-0.5 opacity-40 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <button
                    type="button"
                    aria-label={translate(isHidden ? 'indicators.show' : 'indicators.hide')}
                    onClick={() => { controls.setVisibility(added.instanceId, !isHidden); }}
                    className="grid size-6 place-items-center rounded text-ink-500 hover:bg-abyss-700 hover:text-ink-100"
                >
                    {isHidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>

                {banding?.isSharing === true && (
                    <button
                        type="button"
                        aria-label={translate('indicators.splitBand')}
                        onClick={() => { controls.setBand(added.instanceId, null); }}
                        className="grid size-6 place-items-center rounded text-ink-500 hover:bg-abyss-700 hover:text-ink-100"
                    >
                        <Split className="size-3.5" />
                    </button>
                )}
                {banding?.joinable !== null && banding?.joinable !== undefined && (
                    <button
                        type="button"
                        aria-label={translate('indicators.mergeBand')}
                        onClick={() => { controls.setBand(added.instanceId, banding.joinable); }}
                        className="grid size-6 place-items-center rounded text-ink-500 hover:bg-abyss-700 hover:text-ink-100"
                    >
                        <Combine className="size-3.5" />
                    </button>
                )}

                {isTunable && (
                    <button
                        type="button"
                        aria-label={translate('indicators.tune')}
                        onClick={() => { onOpenSettings(added.instanceId); }}
                        className="grid size-6 place-items-center rounded text-ink-500 hover:bg-abyss-700 hover:text-ink-100"
                    >
                        <Settings2 className="size-3.5" />
                    </button>
                )}

                <button
                    type="button"
                    aria-label={translate('indicators.remove')}
                    onClick={() => { controls.remove(added.instanceId); }}
                    className="grid size-6 place-items-center rounded text-ink-500 hover:bg-abyss-700 hover:text-ask"
                >
                    <X className="size-3.5" />
                </button>
            </span>
        </li>
    );
}

/**
 * How a row's name reads: dimmed while kept but not drawn, amber while unsettled.
 */
function resolveNameClasses(isHidden: boolean, hasSettled: boolean): string {
    if (isHidden) {
        return 'text-xs font-semibold text-ink-500 line-through decoration-ink-700';
    }
    return `text-xs font-semibold ${hasSettled ? 'text-ink-100' : 'text-amber'}`;
}

/**
 * The parameters of an indicator that is not currently drawing a plan to read them from.
 */
function summariseSettings(layer: Tunable, added: AddedIndicator): string {
    const figures: string[] = [];
    for (const parameter of layer.parameters) {
        if (parameter.kind === 'integer' || parameter.kind === 'decimal') {
            figures.push(String(readSetting(added.settings, parameter)));
        }
    }
    return figures.join(' · ');
}

/**
 * Names a chosen source, but only where the reader chose something unusual.
 *
 * Every row saying "close" is noise on a chart where almost everything is read
 * off the close. The one row that is not is worth a word.
 */
function describeChosenSource(
    layer: Tunable,
    added: AddedIndicator,
    translate: Translate,
): ReactElement | null {
    for (const parameter of layer.parameters) {
        const chosen = parameter.kind === 'choice' ? readChoice(added.settings, parameter) : null;
        if (chosen !== null && chosen !== parameter.defaultValue) {
            return (
                <span className="text-xs text-ink-500">
                    {translateLabel(translate, `${parameter.name}.${chosen}`).toLowerCase()}
                </span>
            );
        }
    }
    return null;
}
