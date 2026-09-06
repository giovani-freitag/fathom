import { Check, ChevronDown } from 'lucide-react';
import type { Choice } from './choice.ts';
import type { ReactElement } from 'react';
import { CONTROL_HEIGHT, LIST_ROW_CLASSES } from './control-shell.ts';
import { Select as RadixSelect } from 'radix-ui';

interface SelectProps {
    readonly value: string;
    readonly choices: readonly Choice[];
    readonly onSelect: (value: string) => void;
    readonly label: string;
}

/**
 * The choices in the order given, gathered under the headings they name.
 *
 * Ungrouped choices keep one nameless group, so a select that never heard of
 * groups renders exactly as it did.
 */
function groupsOf(choices: readonly Choice[]): [string, Choice[]][] {
    const held = new Map<string, Choice[]>();
    for (const choice of choices) {
        const group = choice.group ?? '';
        held.set(group, [...held.get(group) ?? [], choice]);
    }
    return [...held.entries()];
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
                className={`flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-hairline bg-abyss-800/80 px-3 text-ink-100 transition-colors hover:border-hairline-bright data-[state=open]:border-phosphor/60 ${height}`}
            >
                {/* Cut rather than wrapped: a name long enough to break over two
                    lines pushed the control past the height every other one
                    keeps, and left the row it sits in a different shape. */}
                <span className="min-w-0 truncate whitespace-nowrap">
                    <RadixSelect.Value placeholder="—" />
                </span>
                <RadixSelect.Icon>
                    <ChevronDown className="size-3.5 text-ink-500" />
                </RadixSelect.Icon>
            </RadixSelect.Trigger>

            <RadixSelect.Portal>
                {/* Never narrower than what was pressed: a menu that opens half
                    the width of its own trigger reads as belonging to something
                    else on the panel. */}
                {/* Never taller than the room there is, and scrolled inside
                    when the answers outrun it. Without the clamp the list is
                    drawn at its full height wherever it opens: on a phone held
                    sideways, and in a hand once a reader has made a few tags of
                    their own, the last venues were painted below the bottom of
                    the screen with nothing to scroll them back. */}
                <RadixSelect.Content
                    position="popper"
                    sideOffset={6}
                    className={'z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg'
                        + ' border border-hairline bg-abyss-800 shadow-2xl shadow-black/60'
                        + ' max-h-[var(--radix-select-content-available-height)]'}
                >
                    <RadixSelect.Viewport className="max-h-[inherit] overflow-y-auto p-1">
                        {groupsOf(choices).map(([group, held]) => (
                            <RadixSelect.Group key={group}>
                                {group !== '' && (
                                    <RadixSelect.Label
                                        className="sticky top-0 z-10 mb-1 bg-abyss-900/95 px-3 py-1.5 field-label"
                                    >
                                        {group}
                                    </RadixSelect.Label>
                                )}
                                {held.map((choice) => (
                                    <RadixSelect.Item
                                        key={choice.value}
                                        value={choice.value}
                                        disabled={choice.isDisabled === true}
                                        {...choice.title === undefined ? {} : { title: choice.title }}
                                        className={`${LIST_ROW_CLASSES} cursor-pointer select-none justify-between gap-6 rounded-md text-xs text-ink-300 outline-none data-[disabled]:cursor-default data-[disabled]:opacity-40 data-[highlighted]:bg-abyss-700 data-[highlighted]:text-ink-100`}
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
                            </RadixSelect.Group>
                        ))}
                    </RadixSelect.Viewport>
                </RadixSelect.Content>
            </RadixSelect.Portal>
        </RadixSelect.Root>
    );
}
