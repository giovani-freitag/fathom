import type { ChoiceParameter, IndicatorParameter, NumericParameter } from '../../../shared/core/draw-plan.ts';
import type { AddedIndicator } from '../../../shared/core/indicator-selection.ts';
import { INSTANCE_TONES, readChoice, readSetting } from '../../../shared/core/draw-plan.ts';
import type { PlotTone } from '../../../shared/core/draw-plan.ts';
import { formatFixed } from '../../core/formatting.ts';
import { RangeField } from '../range-field.tsx';
import { ToneSwatch } from './tone-swatch.tsx';
import { type ReactElement, useState } from 'react';
import { useTranslate } from '../../react/use-appearance.ts';
import { translateLabel } from '../../i18n/translator.ts';

interface IndicatorParametersProps {
    readonly indicator: { readonly parameters: readonly IndicatorParameter[] };
    /** False for a layer the host draws in colours that already mean something. */
    readonly hasTone?: boolean;
    readonly added: AddedIndicator;
    readonly onRetune: (name: string, value: number | string) => void;
    readonly onRecolour: (tone: PlotTone) => void;
}

/**
 * The knobs one added indicator exposes, built from what it declared.
 */
export function IndicatorParameters({
    indicator,
    added,
    onRetune,
    onRecolour,
    hasTone = true,
}: IndicatorParametersProps): ReactElement {
    const translate = useTranslate();

    return (
        <div className="space-y-3">
            <div className="space-y-3">
                {indicator.parameters.map((parameter) => (
                    <ParameterControl
                        key={parameter.name}
                        parameter={parameter}
                        added={added}
                        onRetune={onRetune}
                    />
                ))}
            </div>

            {hasTone && (
                <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                        {translate('indicators.colour')}
                    </span>
                    <div className="flex gap-1.5">
                        {INSTANCE_TONES.map((tone) => (
                            <button
                                key={tone}
                                type="button"
                                aria-label={tone}
                                aria-pressed={tone === added.tone}
                                onClick={() => { onRecolour(tone); }}
                                className={`grid size-7 place-items-center rounded border ${tone === added.tone ? 'border-ink-100' : 'border-transparent hover:border-hairline-bright'}`}
                            >
                                <ToneSwatch tone={tone} className="size-3.5" />
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

interface ParameterControlProps {
    readonly parameter: IndicatorParameter;
    readonly added: AddedIndicator;
    readonly onRetune: (name: string, value: number | string) => void;
}

/**
 * The control a knob deserves, chosen from what the knob is.
 *
 * A count is typed: the useful values are far apart and a reader knows the one
 * they want. A figure between two ends is dragged, because finding it means
 * trying it.
 */
function ParameterControl({ parameter, added, onRetune }: ParameterControlProps): ReactElement {
    const translate = useTranslate();
    const label = translateLabel(translate, `parameter.${parameter.name}`);

    if (parameter.kind === 'choice') {
        return (
            <ChoiceField
                parameter={parameter}
                label={label}
                value={readChoice(added.settings, parameter)}
                onChange={(value) => { onRetune(parameter.name, value); }}
            />
        );
    }

    if (parameter.kind === 'integer') {
        return (
            <ParameterField
                parameter={parameter}
                label={label}
                value={readSetting(added.settings, parameter)}
                onChange={(value) => { onRetune(parameter.name, value); }}
            />
        );
    }

    const value = readSetting(added.settings, parameter);
    return (
        <RangeField
            label={label}
            display={describeValue(parameter, value)}
            value={value}
            minimum={parameter.minimum}
            maximum={parameter.maximum}
            step={parameter.step ?? (parameter.maximum - parameter.minimum) / 100}
            handleLabel={label}
            onChange={(chosen) => { onRetune(parameter.name, chosen); }}
        />
    );
}

/**
 * A figure as the reader should read it.
 *
 * A range that lies entirely between nought and one is a share of something,
 * and reads as a percentage rather than as a decimal nobody thinks in.
 */
function describeValue(parameter: NumericParameter, value: number): string {
    if (parameter.minimum >= 0 && parameter.maximum <= 1) {
        const percent = value * 100;
        return `${formatFixed(percent, Number.isInteger(percent) ? 0 : 1)}%`;
    }
    return formatFixed(value, 2);
}

interface ChoiceFieldProps {
    readonly parameter: ChoiceParameter;
    readonly label: string;
    readonly value: string;
    readonly onChange: (value: string) => void;
}

function ChoiceField({ parameter, label, value, onChange }: ChoiceFieldProps): ReactElement {
    const translate = useTranslate();

    return (
        <label className="flex w-full min-w-0 flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                {label}
            </span>
            <select
                value={value}
                onChange={(event) => { onChange(event.target.value); }}
                className="min-h-9 w-full rounded border border-hairline bg-abyss-900 px-2 text-sm text-ink-100 outline-none focus:border-phosphor/60"
            >
                {parameter.choices.map((choice) => (
                    <option key={choice} value={choice}>
                        {translateLabel(translate, `${parameter.name}.${choice}`)}
                    </option>
                ))}
            </select>
        </label>
    );
}

interface ParameterFieldProps {
    readonly parameter: NumericParameter;
    readonly label: string;
    readonly value: number;
    readonly onChange: (value: number) => void;
}

/**
 * A box for a figure the reader knows and types.
 *
 * What is typed is held as written until the field is left. Fed straight back
 * through the clamp instead, the first digit of a three-digit period lands
 * under the declared minimum and is rewritten under the cursor, so the rest of
 * the number arrives beside a figure the reader did not type.
 */
function ParameterField({ parameter, label, value, onChange }: ParameterFieldProps): ReactElement {
    const [draft, setDraft] = useState<string | null>(null);

    return (
        <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                {label}
            </span>
            <input
                type="number"
                inputMode="decimal"
                value={draft ?? String(value)}
                min={parameter.minimum}
                max={parameter.maximum}
                step={parameter.step ?? 1}
                onChange={(event) => { setDraft(readDraft(event.target.value, parameter, onChange)); }}
                onBlur={() => { setDraft(commitDraft(draft, parameter, onChange)); }}
                className="min-h-9 w-full rounded border border-hairline bg-abyss-900 px-2 text-sm text-ink-100 tabular-nums outline-none focus:border-phosphor/60"
            />
        </label>
    );
}

/**
 * Takes what was typed, passing on only a figure the indicator would accept.
 *
 * A number still being typed is often outside the range for a keystroke or two.
 * Passing it on would clamp it, and clamping what is on screen mid-word is what
 * makes the field impossible to type in.
 */
function readDraft(
    text: string,
    parameter: NumericParameter,
    onChange: (value: number) => void,
): string {
    const parsed = Number.parseFloat(text);
    if (Number.isFinite(parsed) && parsed >= parameter.minimum && parsed <= parameter.maximum) {
        onChange(parsed);
    }
    return text;
}

/**
 * Settles the field on the figure the indicator is going to use.
 *
 * @returns Null, so the field goes back to showing what is stored.
 */
function commitDraft(
    draft: string | null,
    parameter: NumericParameter,
    onChange: (value: number) => void,
): null {
    const parsed = draft === null ? Number.NaN : Number.parseFloat(draft);
    if (Number.isFinite(parsed)) {
        onChange(Math.min(parameter.maximum, Math.max(parameter.minimum, parsed)));
    }
    return null;
}
