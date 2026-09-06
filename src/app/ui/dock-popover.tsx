import { FLOATING_CARD_CLASSES } from './control-shell.ts';
import { Popover } from 'radix-ui';
import { EscapeGuardContext } from './escape-guard.ts';
import { useMemo, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import {
    CONTROL_ACTIVE_CLASSES,
    CONTROL_BUTTON_CLASSES,
    CONTROL_RESTING_CLASSES,
    ROOMY_CARD_CLASSES,
} from './control-shell.ts';

interface DockPopoverProps {
    /** The word written on the trigger, where it carries one. */
    readonly said?: string | undefined;
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
    said,
}: DockPopoverProps): ReactElement {
    // A control whose name does not hold the word written on it is one voice
    // control cannot reach: "tap BTC" finds nothing on a button called
    // "Contracts". The visible word leads, so it is what a reader says.
    const name = said === undefined || said === '' ? label : `${said} — ${label}`;

    // How many things inside have asked for the next Escape. Counted rather
    // than flagged: a grid chooser inside a card inside this popover is two
    // claims deep, and the innermost one answers first.
    const claims = useRef(0);
    const guard = useMemo(() => ({
        claim: (isClaimed: boolean) => { claims.current += isClaimed ? 1 : -1; },
    }), []);
    return (
        <Popover.Root
            {...isOpen === undefined ? {} : { open: isOpen }}
            {...onOpenChange === undefined ? {} : { onOpenChange }}
        >
            <Popover.Trigger asChild>
                <button
                    type="button"
                    aria-label={name}
                    title={title ?? name}
                    className={`${CONTROL_BUTTON_CLASSES} ${isActive ? CONTROL_ACTIVE_CLASSES : CONTROL_RESTING_CLASSES}`}
                >
                    {trigger}
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    // Named after the control that opened it. Three of these
                    // announced themselves as "dialog" and nothing else, which
                    // tells a reader a thing has opened and not what it is.
                    aria-label={name}
                    onEscapeKeyDown={(event) => {
                        // Refused rather than swallowed: the key still reaches
                        // whatever claimed it, which closes only itself.
                        if (claims.current > 0) {
                            event.preventDefault();
                        }
                    }}
                    side={side}
                    sideOffset={10}
                    collisionPadding={12}
                    className={`${FLOATING_CARD_CLASSES} z-50 ${
                        isRoomy ? ROOMY_CARD_CLASSES : 'max-h-[60dvh] overflow-y-auto'
                    }`}
                >
                    <EscapeGuardContext.Provider value={guard}>
                        {children}
                    </EscapeGuardContext.Provider>
                    <Popover.Arrow className="fill-abyss-800/95" />
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
