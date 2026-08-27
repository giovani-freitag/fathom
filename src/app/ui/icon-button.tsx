import type { ReactElement, ReactNode } from 'react';

/** What a press of it does, which is what decides the colour it warns in. */
export type IconButtonTone = 'neutral' | 'destructive';

interface IconButtonProps {
    readonly label: string;
    readonly onClick: () => void;
    readonly children: ReactNode;
    /** Compact on the chart, where the rows sit over the price. */
    readonly isCompact?: boolean;
    readonly tone?: IconButtonTone;
}

const HOVER_TONES: Readonly<Record<IconButtonTone, string>> = {
    neutral: 'hover:text-ink-100',
    destructive: 'hover:text-ask',
};

/**
 * A control that is only an icon.
 *
 * Written once because it was written seven times: the rows on the chart and
 * the cards in the drawer offer the same handful of actions, and they had drifted
 * into two sizes with the same intent spelled out at each call.
 */
export function IconButton({
    label,
    onClick,
    children,
    isCompact,
    tone = 'neutral',
}: IconButtonProps): ReactElement {
    const size = isCompact === true ? 'size-6' : 'size-8 shrink-0';

    return (
        <button
            type="button"
            aria-label={label}
            onClick={onClick}
            className={`grid ${size} place-items-center rounded text-ink-500 hover:bg-abyss-700 ${HOVER_TONES[tone]}`}
        >
            {children}
        </button>
    );
}
