import { AUTOMATIC_INTERVAL, BAR_INTERVALS_MS, type BarIntervalMs } from '../core/bar-interval.ts';
import type { Choice } from './choice.ts';
import { ChoiceGrid } from './choice-grid.tsx';
import { formatDuration } from '../core/formatting.ts';
import { memo, type ReactElement } from 'react';
import { Select } from './select.tsx';
import { matchesSpan, SPAN_PRESETS } from './span-preset-catalogue.ts';
import type { Translate } from '../i18n/translator.ts';
import { useTranslate } from '../react/use-appearance.ts';

/** Past this much more than was recorded, a span would show mostly nothing. */
const COVERAGE_HEADROOM = 1.2;

interface SpanControlProps {
    readonly activeSpanMs: number;
    readonly recordedSpanMs: number;
    readonly onSelect: (spanMs: number) => void;
    /** True where the choices have to fold into a menu to fit. */
    readonly isCollapsed?: boolean;
}

/**
 * The stretch of time on screen, as choices or as a menu of them.
 *
 * One component for both because the answer is the same either way: what the
 * two shapes differ about is the room they are given, and describing the
 * choices twice is how they come to disagree about which are offered.
 */
function SpanControlComponent({
    activeSpanMs,
    recordedSpanMs,
    onSelect,
    isCollapsed = false,
}: SpanControlProps): ReactElement {
    const translate = useTranslate();
    const choices = listSpanChoices(recordedSpanMs, translate);
    const active = SPAN_PRESETS.find((preset) => matchesSpan(activeSpanMs, preset.spanMs));

    if (isCollapsed) {
        return (
            <Select
                value={String(active?.spanMs ?? '')}
                label={translate('span.label')}
                choices={choices}
                onSelect={(value) => { onSelect(Number(value)); }}
            />
        );
    }

    return (
        <ChoiceGrid
            label={translate('span.label')}
            value={String(active?.spanMs ?? '')}
            choices={choices}
            onChoose={(value) => { onSelect(Number(value)); }}
        />
    );
}

/**
 * Re-rendered only when what it marks changes.
 *
 * A pan leaves the span alone, so following the viewport from here rebuilt a
 * row of buttons on every frame of one.
 */
export const SpanControl = memo(SpanControlComponent);

interface BarIntervalControlProps {
    readonly barIntervalMs: BarIntervalMs | null;
    /** What the window settled on, for the choice that hands it the decision. */
    readonly effectiveIntervalMs: number;
    /** The grid the contract is recorded on, below which no rung is offered. */
    readonly frameIntervalMs: number;
    readonly onSelect: (barIntervalMs: BarIntervalMs | null) => void;
    readonly isCollapsed?: boolean;
}

/**
 * The bar the chart is drawn in, as choices or as a menu of them.
 */
function BarIntervalControlComponent(props: BarIntervalControlProps): ReactElement {
    const translate = useTranslate();
    const value = props.barIntervalMs === null ? AUTOMATIC_INTERVAL : String(props.barIntervalMs);
    const choices = listIntervalChoices(props, translate);
    const choose = (chosen: string): void => {
        props.onSelect(chosen === AUTOMATIC_INTERVAL ? null : (Number(chosen) as BarIntervalMs));
    };

    if (props.isCollapsed === true) {
        return (
            <Select
                value={value}
                label={translate('interval.label')}
                choices={choices}
                onSelect={choose}
            />
        );
    }

    return (
        <ChoiceGrid
            label={translate('interval.label')}
            value={value}
            choices={choices}
            onChoose={choose}
        />
    );
}

export const BarIntervalControl = memo(BarIntervalControlComponent);

/**
 * The spans the chart offers, and which of them it has the recording for.
 *
 * @param recordedSpanMs - How far back the contract has been recorded.
 * @param translate - The reader's words.
 * @returns One choice per preset, in the order they are offered.
 */
function listSpanChoices(recordedSpanMs: number, translate: Translate): readonly Choice[] {
    return SPAN_PRESETS.map((preset) => {
        const isBeyondCoverage = preset.spanMs > recordedSpanMs * COVERAGE_HEADROOM;
        return {
            value: String(preset.spanMs),
            label: translate(preset.labelKey),
            isDisabled: isBeyondCoverage,
            ...isBeyondCoverage ? { title: translate('span.beyondCoverage') } : {},
        };
    });
}

/**
 * The bar rungs the chart offers for this contract.
 *
 * @param request - The grid it is recorded on, and what the window settled on.
 * @param translate - The reader's words.
 * @returns The automatic choice, then every rung the recording can carry.
 */
function listIntervalChoices(
    request: Pick<BarIntervalControlProps, 'effectiveIntervalMs' | 'frameIntervalMs'>,
    translate: Translate,
): readonly Choice[] {
    return [
        {
            value: AUTOMATIC_INTERVAL,
            label: translate('interval.auto', {
                interval: formatDuration(request.effectiveIntervalMs, translate),
            }),
        },
        // A rung below what was recorded would draw bars out of nothing.
        ...BAR_INTERVALS_MS
            .filter((rung) => rung >= Math.max(1, request.frameIntervalMs))
            .map((rung) => ({ value: String(rung), label: formatDuration(rung, translate) })),
    ];
}
