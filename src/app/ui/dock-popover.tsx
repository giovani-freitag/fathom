import { Popover } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';

/**
 * One tap target of a dock, sized for a thumb rather than a cursor.
 *
 * Every control down there is this tall, because the row is reached blind at
 * the bottom of a phone and a target that varies is a target that gets missed.
 */
export const DOCK_BUTTON_CLASSES =
    'grid h-10 min-w-10 shrink-0 place-items-center rounded-lg px-1 transition-colors';

export const DOCK_ACTIVE_CLASSES = 'bg-phosphor/15 text-phosphor';
export const DOCK_RESTING_CLASSES = 'text-ink-400 hover:bg-abyss-700 hover:text-ink-100';

/** The shell every floating island shares, so they read as one family. */
export const FLOATING_PANEL_CLASSES =
    'pointer-events-auto flex items-center gap-1 rounded-2xl border border-hairline'
    + ' bg-abyss-800/95 px-1.5 py-1 shadow-lg backdrop-blur';

interface DockPopoverProps {
    readonly label: string;
    /** What the button shows: a glyph, or the value it stands for. */
    readonly trigger: ReactNode;
    readonly children: ReactNode;
    /** Highlighted while it holds something other than its default. */
    readonly isActive?: boolean;
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
}: DockPopoverProps): ReactElement {
    return (
        <Popover.Root>
            <Popover.Trigger asChild>
                <button
                    type="button"
                    aria-label={label}
                    title={label}
                    className={`${DOCK_BUTTON_CLASSES} ${isActive ? DOCK_ACTIVE_CLASSES : DOCK_RESTING_CLASSES}`}
                >
                    {trigger}
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    side="top"
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
