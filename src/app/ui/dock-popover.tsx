import { FLOATING_CARD_CLASSES } from './control-shell.ts';
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
    /**
     * Whether the card holds a listing rather than a stack of controls.
     *
     * A stack of controls is as tall as it is and scrolls whole. A listing is
     * as tall as the room allows and scrolls inside itself, keeping its own
     * search and filters in place while the rows move under them.
     */
    readonly isRoomy?: boolean;
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
    isRoomy = false,
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
                    className={`${FLOATING_CARD_CLASSES} z-50 ${
                        isRoomy
                            // Radix measures the room it has and hands it over;
                            // taken rather than guessed, the card is as tall as
                            // the window allows and no taller.
                            // A minimum as well as a maximum: a list holding one
                            // pair and a venue listing nine hundred are the same
                            // card, and one that collapses to a single row
                            // between them moves the targets under the cursor.
                            ? 'flex h-[min(34rem,var(--radix-popover-content-available-height))]'
                              + ' w-[min(52rem,calc(100vw-1.5rem))] flex-col overflow-hidden !p-0'
                            : 'max-h-[60dvh] overflow-y-auto'
                    }`}
                >
                    {children}
                    <Popover.Arrow className="fill-abyss-800/95" />
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
