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
/**
 * The switch is drawn small and touched large: twenty pixels of height is a
 * miss on a phone, and on the recording rows the neighbour it would be missed
 * for is the delete button. The ring is drawn on keyboard focus only, because
 * without one the control a switch-access reader lands on shows nothing at all.
 */
export function ToggleSwitch({ isOn, onChange, isDisabled, label }: ToggleSwitchProps): ReactElement {
    return (
        <Switch.Root
            checked={isOn}
            onCheckedChange={onChange}
            disabled={isDisabled ?? false}
            {...(label === undefined ? {} : { 'aria-label': label })}
            className={'relative h-5 w-9 shrink-0 rounded-full bg-abyss-600 transition-colors'
                + ' focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-phosphor'
                + ' before:absolute before:inset-y-0 before:content-[""] touch:before:-inset-y-3'
                + ' data-[state=checked]:bg-phosphor/70 disabled:opacity-50'}
        >
            <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-ink-100 transition-transform data-[state=checked]:translate-x-[18px]" />
        </Switch.Root>
    );
}
