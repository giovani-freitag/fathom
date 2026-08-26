import { Popover } from 'radix-ui';
import { Settings2, X } from 'lucide-react';
import type { ReactElement } from 'react';
import type { DrawPlan, PlotTone } from '../../../shared/core/draw-plan.ts';
import { readValueAt } from '../../../shared/core/draw-plan.ts';
import { formatFixed } from '../../core/formatting.ts';
import { useCursorInstant } from '../../react/use-cursor-instant.ts';
import { findIndicator } from '../../indicators/indicator-catalogue.ts';
import { isPriceScale } from '../../painting/pane-projector.ts';
import type { ChartLayout } from '../../painting/render-types.ts';
import { IndicatorParameters } from './indicator-parameters.tsx';
import type { IndicatorControls } from '../../react/use-indicators.ts';
import { useChartState } from '../../react/use-chart-state.ts';
import { useTranslate } from '../../react/use-appearance.ts';
import { translateLabel } from '../../i18n/translator.ts';
import { ToneSwatch } from './tone-swatch.tsx';

/** Clear space under the depth key, where the price pane's own rows start. */
const PRICE_ROWS_TOP_PX = 44;
const ROWS_LEFT_PX = 12;
const PANE_ROW_TOP_PX = 3;

interface IndicatorLegendProps {
    readonly controls: IndicatorControls;
    readonly layout: ChartLayout;
}

/**
 * Names each indicator at the top of the band it is drawn in.
 *
 * Beside what it describes rather than behind a settings screen: the reader
 * comparing a reading against the price is looking at the price, and a control
 * they have to leave the chart to reach is one they retune less often than they
 * would like to.
 */
export function IndicatorLegend({ controls, layout }: IndicatorLegendProps): ReactElement {
    const plans = useChartState().plans;
    const overPrice = plans.filter((plan) => isPriceScale(plan.scale));
    const inPanes = plans.filter((plan) => !isPriceScale(plan.scale));

    return (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <ul
                className="absolute flex flex-col items-start gap-1"
                style={{ left: ROWS_LEFT_PX, top: PRICE_ROWS_TOP_PX }}
            >
                {overPrice.map((plan) => (
                    <LegendRow key={plan.instanceId} plan={plan} controls={controls} />
                ))}
            </ul>

            {inPanes.map((plan, index) => {
                const pane = layout.indicatorPanes[index];
                return pane === undefined ? null : (
                    <ul
                        key={plan.instanceId}
                        className="absolute"
                        style={{ left: ROWS_LEFT_PX, top: pane.topY + PANE_ROW_TOP_PX }}
                    >
                        <LegendRow plan={plan} controls={controls} />
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

interface LegendRowProps {
    readonly plan: DrawPlan;
    readonly controls: IndicatorControls;
}

function LegendRow({ plan, controls }: LegendRowProps): ReactElement | null {
    const translate = useTranslate();
    const indicator = findIndicator(plan.indicatorId);
    const added = controls.added.find((entry) => entry.instanceId === plan.instanceId);
    if (indicator === null || added === undefined) {
        return null;
    }

    const unsettled = plan.hasConverged ? undefined : translate('indicators.unconverged');

    return (
        <li
            title={unsettled}
            className="group pointer-events-auto flex items-center gap-2 rounded border border-transparent bg-abyss-900/70 px-2 py-1 backdrop-blur-sm transition-colors hover:border-hairline"
        >
            <ToneSwatch tone={added.tone} className="size-2" />
            <span className={`text-xs font-semibold ${plan.hasConverged ? 'text-ink-100' : 'text-amber'}`}>
                {translateLabel(translate, indicator.labelKey)}
            </span>
            <span className="text-xs tabular-nums text-ink-500">{plan.parameterSummary}</span>
            <CursorValues plan={plan} />

            {/*
                Half-lit at rest rather than hidden. A control that only exists
                on hover is one a first-time reader never learns is there, and
                one a finger cannot reach at all.
            */}
            <span className="flex items-center gap-0.5 opacity-40 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <Popover.Root>
                    <Popover.Trigger
                        aria-label={translate('indicators.tune')}
                        className="grid size-6 place-items-center rounded text-ink-500 hover:bg-abyss-700 hover:text-ink-100"
                    >
                        <Settings2 className="size-3.5" />
                    </Popover.Trigger>
                    <Popover.Portal>
                        <Popover.Content
                            sideOffset={6}
                            align="start"
                            className="z-50 w-56 rounded-lg border border-hairline bg-abyss-800 p-3 shadow-2xl shadow-black/60"
                        >
                            <IndicatorParameters
                                indicator={indicator}
                                added={added}
                                onRetune={(name, value) => { controls.retune(added.instanceId, name, value); }}
                                onRecolour={(tone) => { controls.recolour(added.instanceId, tone); }}
                            />
                        </Popover.Content>
                    </Popover.Portal>
                </Popover.Root>

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
