import { Slider } from 'radix-ui';
import type { ReactElement } from 'react';

interface RangeFieldProps {
    readonly label: string;
    /** The value as the reader should read it, units and all. */
    readonly display: string;
    readonly value: number;
    readonly minimum: number;
    readonly maximum: number;
    readonly step: number;
    readonly handleLabel: string;
    readonly onChange: (value: number) => void;
}

/**
 * The chart's only control for a figure with two ends.
 *
 * A box to type a number in is right where the useful values are far apart and
 * a reader knows the one they want. It is wrong for a figure whose worth is in
 * where it sits between its ends — an intensity, a cut, a ceiling — because
 * finding that means trying it, and trying it means dragging.
 */
export function RangeField({
    label,
    display,
    value,
    minimum,
    maximum,
    step,
    handleLabel,
    onChange,
}: RangeFieldProps): ReactElement {
    return (
        <label className="block space-y-1">
            <span className="flex items-baseline justify-between gap-3 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                {label}
                <span className="numeric normal-case tracking-normal text-ink-300">{display}</span>
            </span>
            <Slider.Root
                value={[value]}
                min={minimum}
                max={maximum}
                step={step}
                onValueChange={([chosen]) => { onChange(chosen ?? value); }}
                className="relative flex h-8 w-full touch-none select-none items-center"
            >
                <Slider.Track className="relative h-1 w-full rounded-full bg-abyss-600">
                    <Slider.Range className="absolute h-full rounded-full bg-phosphor" />
                </Slider.Track>
                <Slider.Thumb
                    aria-label={handleLabel}
                    className="block size-4 rounded-full border-2 border-phosphor bg-abyss-900 outline-none focus-visible:ring-2 focus-visible:ring-phosphor/50"
                />
            </Slider.Root>
        </label>
    );
}
