import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import {
    CONTROL_CHIP_CLASSES,
    CONTROL_CHOSEN_CLASSES,
    CONTROL_OFFERED_CLASSES,
} from './control-shell.ts';

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
    const activeClasses = isActive ? CONTROL_CHOSEN_CLASSES : CONTROL_OFFERED_CLASSES;

    return (
        <button
            type="button"
            {...titleProps}
            {...attributes}
            className={`${CONTROL_CHIP_CLASSES} min-w-10 justify-center ${activeClasses} ${attributes.className ?? ''}`}
        >
            {children}
        </button>
    );
}
