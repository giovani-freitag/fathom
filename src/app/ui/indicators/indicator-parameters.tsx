import type { ChoiceParameter, Indicator, NumericParameter } from '../../../shared/core/draw-plan.ts';
import type { AddedIndicator } from '../../../shared/core/indicator-selection.ts';
import { INSTANCE_TONES, readChoice, readSetting } from '../../../shared/core/draw-plan.ts';
import type { PlotTone } from '../../../shared/core/draw-plan.ts';
import { ToneSwatch } from './tone-swatch.tsx';
import type { ReactElement } from 'react';
import { useTranslate } from '../../react/use-appearance.ts';
import { translateLabel } from '../../i18n/translator.ts';

interface IndicatorParametersProps {
    readonly indicator: Indicator;
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
}: IndicatorParametersProps): ReactElement {
    const translate = useTranslate();

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
                {indicator.parameters.map((parameter) => (parameter.kind === 'choice' ? (
                    <ChoiceField
                        key={parameter.name}
                        parameter={parameter}
                        value={readChoice(added.settings, parameter)}
                        onChange={(value) => { onRetune(parameter.name, value); }}
                    />
                ) : (
                    <ParameterField
                        key={parameter.name}
                        parameter={parameter}
                        value={readSetting(added.settings, parameter)}
                        onChange={(value) => { onRetune(parameter.name, value); }}
                    />
                )))}
            </div>

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
        </div>
    );
}

/**
 * Passes a typed value on only once it is a number.
 *
 * A field mid-edit reads as empty or as a lone minus sign, and pushing that
 * through would reset the control under the reader's cursor.
 */
function applyIfFinite(text: string, apply: (value: number) => void): void {
    const parsed = Number.parseFloat(text);
    if (Number.isFinite(parsed)) {
        apply(parsed);
    }
}

interface ChoiceFieldProps {
    readonly parameter: ChoiceParameter;
    readonly value: string;
    readonly onChange: (value: string) => void;
}

function ChoiceField({ parameter, value, onChange }: ChoiceFieldProps): ReactElement {
    const translate = useTranslate();

    return (
        <label className="flex w-full min-w-0 flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                {translateLabel(translate, `parameter.${parameter.name}`)}
            </span>
            <select
                value={value}
                onChange={(event) => { onChange(event.target.value); }}
                className="min-h-9 w-full rounded border border-hairline bg-abyss-900 px-2 text-sm text-ink-100 outline-none focus:border-phosphor/60"
            >
                {parameter.choices.map((choice) => (
                    <option key={choice} value={choice}>
                        {translateLabel(translate, `source.${choice}`)}
                    </option>
                ))}
            </select>
        </label>
    );
}

interface ParameterFieldProps {
    readonly parameter: NumericParameter;
    readonly value: number;
    readonly onChange: (value: number) => void;
}

function ParameterField({ parameter, value, onChange }: ParameterFieldProps): ReactElement {
    const translate = useTranslate();
    const step = parameter.kind === 'integer' ? 1 : 0.1;

    return (
        <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                {translateLabel(translate, `parameter.${parameter.name}`)}
            </span>
            <input
                type="number"
                inputMode="decimal"
                value={value}
                min={parameter.minimum}
                max={parameter.maximum}
                step={step}
                onChange={(event) => { applyIfFinite(event.target.value, onChange); }}
                className="min-h-9 w-full rounded border border-hairline bg-abyss-900 px-2 text-sm text-ink-100 tabular-nums outline-none focus:border-phosphor/60"
            />
        </label>
    );
}
