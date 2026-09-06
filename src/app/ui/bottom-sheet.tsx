import { Dialog } from 'radix-ui';
import { EscapeGuardContext } from './escape-guard.ts';
import { OVERLAY_CLASSES } from './control-shell.ts';
import { SHEET_SURFACE_CLASSES } from './editor-shell.ts';
import { type ReactElement, type ReactNode, useMemo, useRef, useState } from 'react';

/** How far the sheet has to be pulled before letting go closes it. */
const CLOSES_AT_PX = 96;

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
    // Where a drag started, and how far it has been pulled since. Null while
    // nothing is being dragged, which is most of the time.
    const [pulledBy, setPulledBy] = useState(0);
    const startedAt = useRef<number | null>(null);

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
                    style={pulledBy === 0 ? undefined : { transform: `translateY(${pulledBy}px)` }}
                    className={`${SHEET_SURFACE_CLASSES} z-50 h-[88dvh]`
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
                            startedAt.current = event.clientY;
                            try {
                                event.currentTarget.setPointerCapture(event.pointerId);
                            } catch {
                                // A pointer the browser will not let us capture
                                // still reports where it moves, which is all the
                                // drag needs.
                            }
                        }}
                        onPointerMove={(event) => {
                            if (startedAt.current === null) {
                                return;
                            }
                            // Downwards only: a sheet already at its full height
                            // has nowhere up to go, and following the finger
                            // there would just detach it from the edge.
                            setPulledBy(Math.max(0, event.clientY - startedAt.current));
                        }}
                        onPointerUp={(event) => {
                            // Measured off the event rather than off the state:
                            // a flick that begins and ends inside one frame
                            // leaves the state a render behind, and the sheet
                            // would sit still for the one gesture people make
                            // fastest.
                            const pulled = startedAt.current === null
                                ? 0
                                : event.clientY - startedAt.current;
                            startedAt.current = null;
                            setPulledBy(0);
                            // Far enough to mean it, rather than far enough to
                            // be a scroll that began on the wrong pixel.
                            if (pulled > CLOSES_AT_PX) {
                                onOpenChange(false);
                            }
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
