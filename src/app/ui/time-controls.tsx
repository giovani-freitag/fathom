import { AUTOMATIC_INTERVAL, BAR_INTERVALS_MS, type BarIntervalMs } from '../core/bar-interval.ts';
import type { Choice } from './choice.ts';
import { ChoiceGrid } from './choice-grid.tsx';
import { formatDuration } from '../core/formatting.ts';
import { memo, type ReactElement } from 'react';
import { Select } from './select.tsx';
import { matchesSpan, SPAN_PRESETS } from './span-preset-catalogue.ts';
import type { Translate } from '../i18n/translator.ts';
import { useTranslate } from '../react/use-appearance.ts';

interface SpanControlProps {
    readonly activeSpanMs: number;
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
    onSelect,
    isCollapsed = false,
}: SpanControlProps): ReactElement {
    const translate = useTranslate();
    const choices = listSpanChoices(translate);
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
 * The spans the chart offers.
 *
 * Every one of them, always. They used to be gated on how much had been
 * recorded, from when the price was drawn from the recording too; the price is
 * fetched now, so a week is a week whatever this chart has of the book — and
 * what it has of the book is drawn as the book, which is where that belongs.
 *
 * @param translate - The reader's words.
 * @returns One choice per preset, in the order they are offered.
 */
function listSpanChoices(translate: Translate): readonly Choice[] {
    return SPAN_PRESETS.map((preset) => ({
        value: String(preset.spanMs),
        label: translate(preset.labelKey),
    }));
}

/**
 * The bar rungs the chart offers.
 *
 * @param request - What the window settled on, for the automatic choice.
 * @param translate - The reader's words.
 * @returns The automatic choice, then every rung the recording can carry.
 */
function listIntervalChoices(
    request: Pick<BarIntervalControlProps, 'effectiveIntervalMs'>,
    translate: Translate,
): readonly Choice[] {
    return [
        {
            value: AUTOMATIC_INTERVAL,
            label: translate('interval.auto', {
                interval: formatDuration(request.effectiveIntervalMs, translate),
            }),
        },
        // Every rung, because every rung is one the venue publishes a candle
        // for. They were filtered by the recording when bars came out of it.
        ...BAR_INTERVALS_MS.map((rung) => ({
            value: String(rung),
            label: formatDuration(rung, translate),
        })),
    ];
}
