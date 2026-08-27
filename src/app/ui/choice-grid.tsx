import type { ReactElement, ReactNode } from 'react';

export interface Choice {
    readonly value: string;
    readonly label: string;
    /** Set beside the label, for a figure the choice is about. */
    readonly detail?: string;
    readonly isDisabled?: boolean;
    /** Why it cannot be picked, for the reader who tries. */
    readonly title?: string;
}

interface ChoiceGridProps {
    readonly label: string;
    readonly choices: readonly Choice[];
    readonly value: string;
    readonly onChoose: (value: string) => void;
    /** True where each choice needs a line of its own rather than a chip. */
    readonly isStacked?: boolean;
}

const CHIP_CLASSES =
    'min-h-9 shrink-0 rounded-lg border px-3 text-xs font-semibold transition-colors disabled:opacity-30';
const ROW_CLASSES =
    'flex min-h-9 w-full items-center justify-between gap-3 rounded-lg border px-3 text-xs transition-colors';

const CHOSEN_CLASSES = 'border-phosphor/60 bg-phosphor/12 text-phosphor';
const OFFERED_CLASSES = 'border-hairline bg-abyss-800/80 text-ink-300 hover:border-hairline-bright hover:text-ink-100';

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
    const shape = isStacked ? ROW_CLASSES : CHIP_CLASSES;

    return (
        <button
            type="button"
            role="radio"
            aria-checked={isChosen}
            disabled={choice.isDisabled === true}
            {...choice.title === undefined ? {} : { title: choice.title }}
            onClick={() => { onChoose(choice.value); }}
            className={`${shape} ${isChosen ? CHOSEN_CLASSES : OFFERED_CLASSES}`}
        >
            <span className={isStacked ? 'font-semibold' : ''}>{choice.label}</span>
            {choice.detail !== undefined && <Detail>{choice.detail}</Detail>}
        </button>
    );
}

function Detail({ children }: { readonly children: ReactNode }): ReactElement {
    return <span className="numeric text-[11px] text-ink-500">{children}</span>;
}
