import { Check, ChevronDown } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { CONTROL_HEIGHT } from './control-shell.ts';
import { Select as RadixSelect } from 'radix-ui';

export interface SelectChoice {
    readonly value: string;
    readonly label: string;
    /** Set beside the label, for a figure the choice is about. */
    readonly detail?: string;
    /**
     * Shown before the label, in the menu and on the trigger alike.
     *
     * A flag, or the shape a theme takes: what the reader recognises before
     * they have read the word.
     */
    readonly icon?: ReactNode;
}

interface SelectProps {
    readonly value: string;
    readonly choices: readonly SelectChoice[];
    readonly onSelect: (value: string) => void;
    readonly label: string;
}

/**
 * The one select on this interface.
 *
 * Written once because it was written three ways: a Radix select forty-four
 * pixels tall beside a native one at twenty-six, and a third built out of a
 * dropdown menu. Same question asked of the reader, three shapes to learn.
 *
 * Everything a select shows goes through here — which is also what makes the
 * implementation behind it one file to change.
 */
export function Select({ value, choices, onSelect, label }: SelectProps): ReactElement {
    // One height, the same as every other control: a select that was taller than
    // the buttons beside it read as a row assembled rather than designed.
    const height = `${CONTROL_HEIGHT} text-xs font-semibold`;

    return (
        <RadixSelect.Root value={value} onValueChange={onSelect}>
            <RadixSelect.Trigger
                aria-label={label}
                className={`inline-flex items-center justify-between gap-2 rounded-md border border-hairline bg-abyss-800/80 px-3 text-ink-100 transition-colors hover:border-hairline-bright data-[state=open]:border-phosphor/60 ${height}`}
            >
                <RadixSelect.Value placeholder="—" />
                <RadixSelect.Icon>
                    <ChevronDown className="size-3.5 text-ink-500" />
                </RadixSelect.Icon>
            </RadixSelect.Trigger>

            <RadixSelect.Portal>
                {/* Never narrower than what was pressed: a menu that opens half
                    the width of its own trigger reads as belonging to something
                    else on the panel. */}
                <RadixSelect.Content
                    position="popper"
                    sideOffset={6}
                    className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-hairline bg-abyss-800 shadow-2xl shadow-black/60"
                >
                    <RadixSelect.Viewport className="p-1">
                        {choices.map((choice) => (
                            <RadixSelect.Item
                                key={choice.value}
                                value={choice.value}
                                className="flex min-h-9 cursor-pointer select-none items-center justify-between gap-6 rounded-md px-3 text-xs text-ink-300 outline-none data-[highlighted]:bg-abyss-700 data-[highlighted]:text-ink-100"
                            >
                                <RadixSelect.ItemText>
                                    <span className="flex items-center gap-2">
                                        {choice.icon}
                                        {choice.label}
                                    </span>
                                </RadixSelect.ItemText>
                                <span className="flex items-center gap-2">
                                    {choice.detail !== undefined && (
                                        <span className="numeric text-[10px] text-ink-600">{choice.detail}</span>
                                    )}
                                    <RadixSelect.ItemIndicator>
                                        <Check className="size-3.5 text-phosphor" />
                                    </RadixSelect.ItemIndicator>
                                </span>
                            </RadixSelect.Item>
                        ))}
                    </RadixSelect.Viewport>
                </RadixSelect.Content>
            </RadixSelect.Portal>
        </RadixSelect.Root>
    );
}
