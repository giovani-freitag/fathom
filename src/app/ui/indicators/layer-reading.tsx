import type { ReactElement } from 'react';
import type { AddedIndicator } from '../../../shared/core/indicator-selection.ts';
import type { DrawPlan, PlotTone, Tunable } from '../../../shared/core/draw-plan.ts';
import { findFieldLayer } from '../../indicators/field-layers.ts';
import { formatFixed } from '../../core/formatting.ts';
import { readChoice, readSetting, readValueAt } from '../../../shared/core/draw-plan.ts';
import { translateLabel, type Translate } from '../../i18n/translator.ts';
import { useCursorInstant } from '../../react/use-cursor-instant.ts';
import { useTranslate } from '../../react/use-appearance.ts';

interface LayerReadingProps {
    readonly added: AddedIndicator;
    /** Absent while the layer is kept without being drawn. */
    readonly plan: DrawPlan | null;
    readonly layer: Tunable;
}

/**
 * What a layer says, where the pointer is.
 *
 * Its parameters, the source it was read off when that is not the usual one,
 * and each of its series at the instant under the cursor.
 */
export function LayerReading({ added, plan, layer }: LayerReadingProps): ReactElement {
    const translate = useTranslate();
    // The depth map has a ramp of its own, and the candles have two colours that
    // mean something. Neither carries figures to summarise.
    const isTinted = findFieldLayer(added.indicatorId) === null;

    return (
        <span className="flex flex-wrap items-center gap-x-2">
            <span className="text-xs tabular-nums text-ink-500 empty:hidden">
                {plan?.parameterSummary ?? (isTinted ? summariseSettings(layer, added) : '')}
            </span>
            {describeChosenSource(layer, added, translate)}
            {plan !== null && <CursorValues plan={plan} />}
        </span>
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
