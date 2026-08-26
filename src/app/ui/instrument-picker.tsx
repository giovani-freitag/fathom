import type { InstrumentCoverage } from '../../shared/core/api-contract.ts';
import { ChevronDown, Check } from 'lucide-react';
import { Select } from 'radix-ui';
import { memo, type ReactElement } from 'react';
import { useTranslate } from '../react/use-appearance.ts';

interface InstrumentPickerProps {
    readonly instruments: readonly InstrumentCoverage[];
    readonly selectedSymbol: string | null;
    readonly onSelect: (instrumentSymbol: string) => void;
}

/**
 * Picks which recorded contract the chart shows.
 */
function InstrumentPickerComponent({
    instruments,
    selectedSymbol,
    onSelect,
}: InstrumentPickerProps): ReactElement {
    const translate = useTranslate();
    // Two shapes rather than a conditional spread: under exactOptionalPropertyTypes
    // a spread turns `value` into optional-and-possibly-undefined, which is not
    // what a controlled Select accepts.
    const selectionProps = selectedSymbol === null ? {} : { value: selectedSymbol };

    return (
        <Select.Root {...selectionProps} onValueChange={onSelect}>
            <Select.Trigger
                aria-label={translate('instrument.label')}
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-hairline bg-abyss-800/80 px-3 text-sm font-semibold text-ink-100 transition-colors hover:border-hairline-bright data-[state=open]:border-phosphor/60"
            >
                <Select.Value placeholder="—" />
                <Select.Icon>
                    <ChevronDown className="size-4 text-ink-500" />
                </Select.Icon>
            </Select.Trigger>

            <Select.Portal>
                <Select.Content
                    position="popper"
                    sideOffset={6}
                    className="z-50 overflow-hidden rounded-lg border border-hairline bg-abyss-800 shadow-2xl shadow-black/60"
                >
                    <Select.Viewport className="p-1">
                        {instruments.map((instrument) => (
                            <Select.Item
                                key={instrument.instrumentSymbol}
                                value={instrument.instrumentSymbol}
                                className="flex min-h-11 cursor-pointer select-none items-center justify-between gap-6 rounded-md px-3 text-sm text-ink-300 outline-none data-[highlighted]:bg-abyss-700 data-[highlighted]:text-ink-100"
                            >
                                <Select.ItemText>{instrument.instrumentSymbol}</Select.ItemText>
                                <Select.ItemIndicator>
                                    <Check className="size-4 text-phosphor" />
                                </Select.ItemIndicator>
                            </Select.Item>
                        ))}
                    </Select.Viewport>
                </Select.Content>
            </Select.Portal>
        </Select.Root>
    );
}

/**
 * Re-rendered only when what it shows changes.
 *
 * A drag rewrites the viewport many times a second and the whole page follows
 * it; this reads none of that, and rebuilding its menu each time was the
 * costliest thing on the screen during a drag.
 */
export const InstrumentPicker = memo(InstrumentPickerComponent);
