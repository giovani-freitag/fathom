import { Popover } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';
import {
    CONTROL_ACTIVE_CLASSES,
    CONTROL_BUTTON_CLASSES,
    CONTROL_RESTING_CLASSES,
} from './control-shell.ts';

interface DockPopoverProps {
    readonly label: string;
    /** What the button shows: a glyph, or the value it stands for. */
    readonly trigger: ReactNode;
    readonly children: ReactNode;
    /** Highlighted while it holds something other than its default. */
    readonly isActive?: boolean;
    /** Set to open it from somewhere else, such as a keyboard chord. */
    readonly isOpen?: boolean;
    readonly onOpenChange?: (isOpen: boolean) => void;
    /** Shown on hover, where a chord that opens it can be named. */
    readonly title?: string;
    /** Which way it opens; above, where a dock is under it, by default. */
    readonly side?: 'top' | 'bottom';
}

/**
 * A dock button that opens a panel above itself.
 *
 * The way a small screen holds more than fits: what the reader changes rarely
 * lives behind one target and comes back where their thumb already is, rather
 * than along a bar at the top they have to regrip to reach.
 */
export function DockPopover({
    label,
    trigger,
    children,
    isActive = false,
    isOpen,
    onOpenChange,
    title,
    side = 'top',
}: DockPopoverProps): ReactElement {
    return (
        <Popover.Root
            {...isOpen === undefined ? {} : { open: isOpen }}
            {...onOpenChange === undefined ? {} : { onOpenChange }}
        >
            <Popover.Trigger asChild>
                <button
                    type="button"
                    aria-label={label}
                    title={title ?? label}
                    className={`${CONTROL_BUTTON_CLASSES} ${isActive ? CONTROL_ACTIVE_CLASSES : CONTROL_RESTING_CLASSES}`}
                >
                    {trigger}
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    side={side}
                    sideOffset={10}
                    collisionPadding={12}
                    className="z-50 max-h-[60dvh] overflow-y-auto rounded-xl border border-hairline bg-abyss-800 p-3 shadow-2xl shadow-black/60"
                >
                    {children}
                    <Popover.Arrow className="fill-abyss-800" />
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
