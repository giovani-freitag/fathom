import { Dialog } from 'radix-ui';
import { EscapeGuardContext } from './escape-guard.ts';
import { OVERLAY_CLASSES } from './control-shell.ts';
import { SHEET_SURFACE_CLASSES } from './editor-shell.ts';
import { type ReactElement, type ReactNode, useMemo, useRef, useState } from 'react';

/** How far below its smallest height a pull has to go before letting go closes it. */
const CLOSES_AT_PX = 96;

/**
 * How fast a downward flick closes it, in pixels per millisecond.
 *
 * Distance alone cannot be the whole answer: from its full height the sheet is
 * five hundred pixels above the point where a pull means dismissal, which is
 * further than a thumb travels on the screens this runs on.
 */
const FLICKS_SHUT_AT = 0.6;

/** Past this long since the last move, a finger has stopped rather than flicked. */
const STILL_MOVING_MS = 140;

/** The heights the sheet is held between, as a share of the viewport. */
const SMALLEST_SHARE = 0.3;
const LARGEST_SHARE = 0.94;

/** What it opens at, until a reader drags it somewhere else. */
const OPENS_AT_SHARE = 0.88;

export interface BottomSheetProps {
    readonly isOpen: boolean;
    readonly onOpenChange: (isOpen: boolean) => void;
    /** What the sheet calls itself, read out and drawn along its top. */
    readonly title: string;
    /** The control that opens it, rendered as the sheet's own trigger. */
    readonly trigger: ReactNode;
    readonly children: ReactNode;
}

/**
 * A sheet that rises from the bottom of the screen, on a phone.
 *
 * A card hung off its trigger is placed against that trigger and sized against
 * the window, and on a phone those two answers leave a listing of nine hundred
 * pairs about four hundred pixels to stand in — most of it spent on the search,
 * the source and the filters, with two or three rows left over. A sheet is
 * measured against the screen instead: full width, nearly full height, and
 * rising from the edge the thumb is already at.
 *
 * It opens only when its trigger is pressed. Nothing here opens on arrival.
 */
export function BottomSheet({
    isOpen,
    onOpenChange,
    title,
    trigger,
    children,
}: BottomSheetProps): ReactElement {
    // The height a reader dragged it to, kept for as long as the page is open.
    // Null until they have, and the sheet opens at its own share of the screen.
    const [heldAt, setHeldAt] = useState<number | null>(null);
    const sheet = useRef<HTMLDivElement>(null);

    // Where the drag began, and the height it began from. Null while nothing is
    // being dragged, which is most of the time.
    const startedAt = useRef<{ readonly y: number; readonly height: number } | null>(null);

    // How fast the finger was moving when it was last seen, and when that was.
    // Measured between two moves, never against the release: a finger does not
    // travel between its last move and letting go, so a speed taken there is
    // always zero and every flick reads as a sheet held still.
    const lastSeen = useRef<{ readonly y: number; readonly at: number; readonly speed: number } | null>(null);

    /**
     * Holds a height inside what the sheet allows.
     *
     * @param height - The height the finger asks for, in pixels.
     * @returns The nearest height it is allowed to take.
     */
    const clamp = (height: number): number => Math.min(
        Math.max(height, window.innerHeight * SMALLEST_SHARE),
        window.innerHeight * LARGEST_SHARE,
    );

    // The same bargain the dock's cards make: something open inside the sheet
    // takes the next Escape, and the sheet stays.
    const claims = useRef(0);
    const guard = useMemo(() => ({
        claim: (isClaimed: boolean) => { claims.current += isClaimed ? 1 : -1; },
    }), []);

    return (
        <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
            <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>

            <Dialog.Portal>
                <Dialog.Overlay className={OVERLAY_CLASSES} />
                <Dialog.Content
                    aria-label={title}
                    onEscapeKeyDown={(event) => {
                        if (claims.current > 0) {
                            event.preventDefault();
                        }
                    }}
                    ref={sheet}
                    style={{ height: heldAt === null ? `${OPENS_AT_SHARE * 100}dvh` : `${heldAt}px` }}
                    // `transition-none` because `duration-200` is here for the
                    // slide in and out, and with no transition-property beside
                    // it the browser's own `all` took the duration too: every
                    // height written while dragging was then animated over a
                    // fifth of a second, and the sheet trailed the finger at a
                    // third of its speed. The slide is an animation, not a
                    // transition, and is untouched.
                    className={`${SHEET_SURFACE_CLASSES} z-50 transition-none`
                        + ' duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in'
                        + ' data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom'}
                >
                    {/* The grip, and the thing it promises: a sheet that came
                        up from the bottom edge goes back down the same way.
                        There is no title bar and no cross above it: a sheet a
                        reader opened knows what it is, and the two rows they
                        cost were two rows of the listing they came for. What
                        the grip needs instead is room — a band tall enough that
                        a thumb finds it without being aimed. */}
                    <div
                        className="flex shrink-0 cursor-grab touch-none items-center justify-center py-5 active:cursor-grabbing"
                        onPointerDown={(event) => {
                            const height = sheet.current?.getBoundingClientRect().height ?? 0;
                            startedAt.current = { y: event.clientY, height };
                            try {
                                event.currentTarget.setPointerCapture(event.pointerId);
                            } catch {
                                // A pointer the browser will not let us capture
                                // still reports where it moves, which is all the
                                // drag needs.
                            }
                        }}
                        // Written straight onto the node rather than through
                        // state: the sheet holds a listing of nine hundred
                        // pairs, and re-rendering it between the finger and the
                        // edge is what a drag cannot afford. React is told once,
                        // on release, so the two never disagree for long.
                        onPointerMove={(event) => {
                            const start = startedAt.current;
                            if (start === null || sheet.current === null) {
                                return;
                            }
                            const before = lastSeen.current;
                            const since = before === null ? 0 : event.timeStamp - before.at;
                            lastSeen.current = {
                                y: event.clientY,
                                at: event.timeStamp,
                                speed: before === null || since <= 0 ? 0 : (event.clientY - before.y) / since,
                            };
                            sheet.current.style.height = `${clamp(start.height + start.y - event.clientY)}px`;
                        }}
                        onPointerCancel={() => { startedAt.current = null; lastSeen.current = null; }}
                        onPointerUp={(event) => {
                            const start = startedAt.current;
                            startedAt.current = null;
                            if (start === null) {
                                return;
                            }
                            const seen = lastSeen.current;
                            lastSeen.current = null;
                            // A speed from a move that has gone stale is a flick
                            // the finger already stopped making.
                            const speed = seen !== null && event.timeStamp - seen.at < STILL_MOVING_MS
                                ? seen.speed
                                : 0;

                            // Two ways to mean it: pulled past the smallest the
                            // sheet may be, or thrown down fast enough that the
                            // distance was never the point.
                            const asked = start.height + start.y - event.clientY;
                            if (speed > FLICKS_SHUT_AT
                                || asked < window.innerHeight * SMALLEST_SHARE - CLOSES_AT_PX) {
                                onOpenChange(false);
                                return;
                            }
                            setHeldAt(clamp(asked));
                        }}
                    >
                        <span className="h-1 w-10 rounded-full bg-hairline-bright" />
                    </div>

                    <Dialog.Title className="sr-only">{title}</Dialog.Title>

                    <div className="flex min-h-0 flex-1 flex-col pb-[max(0.5rem,env(safe-area-inset-bottom))]">
                        <EscapeGuardContext.Provider value={guard}>
                            {children}
                        </EscapeGuardContext.Provider>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
