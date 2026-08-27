import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import { CONTROL_HEIGHT } from './control-shell.ts';

interface ControlButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    readonly children: ReactNode;
    readonly isActive?: boolean;
}

/**
 * The chart's only button shape.
 */
export function ControlButton({ children, isActive = false, ...attributes }: ControlButtonProps): ReactElement {
    // A button carrying only a glyph says nothing on hover unless it is told to.
    // The accessible name is already the right words, so it is the tooltip too.
    const label = attributes['aria-label'];
    const titleProps = attributes.title === undefined && typeof label === 'string'
        ? { title: label }
        : {};
    const activeClasses = isActive
        ? 'border-phosphor/60 bg-phosphor/12 text-phosphor'
        : 'border-hairline bg-abyss-800/80 text-ink-300 hover:border-hairline-bright hover:text-ink-100';

    return (
        <button
            type="button"
            {...titleProps}
            {...attributes}
            className={`inline-flex ${CONTROL_HEIGHT} min-w-10 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold tracking-wide transition-colors disabled:opacity-40 ${activeClasses} ${attributes.className ?? ''}`}
        >
            {children}
        </button>
    );
}
