import type { ReactElement, ReactNode } from 'react';
import type { Choice } from './choice.ts';
import { ControlButton } from './control-button.tsx';
import {
    CONTROL_CHIP_CLASSES,
    CONTROL_CHOSEN_CLASSES,
    CONTROL_OFFERED_CLASSES,
} from './control-shell.ts';

interface ChoiceGridProps {
    readonly label: string;
    readonly choices: readonly Choice[];
    readonly value: string;
    readonly onChoose: (value: string) => void;
    /** True where each choice needs a line of its own rather than a chip. */
    readonly isStacked?: boolean;
}

/**
 * A set of choices laid out where a reader can see all of them at once.
 *
 * Written because a panel that opens onto a dropdown asks a reader to reveal
 * twice for one decision: the panel, then the menu inside it. A panel that
 * already opened has the room to show what it is offering, and the one in force
 * is then visible without touching anything.
 */
export function ChoiceGrid({
    label,
    choices,
    value,
    onChoose,
    isStacked = false,
}: ChoiceGridProps): ReactElement {
    return (
        <div
            role="radiogroup"
            aria-label={label}
            className={isStacked ? 'flex flex-col gap-1' : 'flex flex-wrap gap-1.5'}
        >
            {choices.map((choice) => (
                <ChoiceButton
                    key={choice.value}
                    choice={choice}
                    isChosen={choice.value === value}
                    isStacked={isStacked}
                    onChoose={onChoose}
                />
            ))}
        </div>
    );
}

interface ChoiceButtonProps {
    readonly choice: Choice;
    readonly isChosen: boolean;
    readonly isStacked: boolean;
    readonly onChoose: (value: string) => void;
}

/**
 * One of the choices, shaped by whether it shares a line or takes one.
 */
function ChoiceButton({ choice, isChosen, isStacked, onChoose }: ChoiceButtonProps): ReactElement {
    const label = (
        <span className="flex items-center gap-2">
            {choice.icon}
            {choice.label}
        </span>
    );
    const detail = choice.detail === undefined ? null : <Detail>{choice.detail}</Detail>;

    // A choice on a line of its own reads left to right like the rest of the
    // panel; one sharing a row is a target, and is centred on its word.
    if (isStacked) {
        return (
            <button
                type="button"
                role="radio"
                aria-checked={isChosen}
                disabled={choice.isDisabled === true}
                {...choice.title === undefined ? {} : { title: choice.title }}
                onClick={() => { onChoose(choice.value); }}
                className={`${CONTROL_CHIP_CLASSES} w-full justify-between ${
                    isChosen ? CONTROL_CHOSEN_CLASSES : CONTROL_OFFERED_CLASSES}`}
            >
                {label}
                {detail}
            </button>
        );
    }

    return (
        <ControlButton
            role="radio"
            aria-checked={isChosen}
            isActive={isChosen}
            disabled={choice.isDisabled === true}
            {...choice.title === undefined ? {} : { title: choice.title }}
            onClick={() => { onChoose(choice.value); }}
            className="shrink-0"
        >
            {label}
            {detail}
        </ControlButton>
    );
}

function Detail({ children }: { readonly children: ReactNode }): ReactElement {
    return <span className="numeric text-[11px] text-ink-500">{children}</span>;
}
