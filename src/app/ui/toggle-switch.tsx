import type { ReactElement } from 'react';
import { Switch } from 'radix-ui';

interface ToggleSwitchProps {
    readonly isOn: boolean;
    readonly onChange: (isOn: boolean) => void;
    readonly isDisabled?: boolean;
    /** Given where the switch carries no visible label of its own. */
    readonly label?: string;
}

/**
 * The one switch on this interface.
 *
 * Written once because it was written twice: two of them sat in the same panel
 * with knobs of different colours travelling different distances, which reads
 * as two kinds of control rather than one control used twice.
 *
 * The knob travels eighteen pixels because that is what the geometry says: a
 * track of thirty-six less a knob of sixteen leaves two pixels of clearance at
 * each end, and stopping at sixteen parks it off-centre against the far edge.
 */
export function ToggleSwitch({ isOn, onChange, isDisabled, label }: ToggleSwitchProps): ReactElement {
    return (
        <Switch.Root
            checked={isOn}
            onCheckedChange={onChange}
            disabled={isDisabled ?? false}
            {...(label === undefined ? {} : { 'aria-label': label })}
            className="relative h-5 w-9 shrink-0 rounded-full bg-abyss-600 outline-none transition-colors data-[state=checked]:bg-phosphor/70 disabled:opacity-50"
        >
            <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-ink-100 transition-transform data-[state=checked]:translate-x-[18px]" />
        </Switch.Root>
    );
}
