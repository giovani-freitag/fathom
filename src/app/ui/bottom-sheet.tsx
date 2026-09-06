import { Dialog } from 'radix-ui';
import { EscapeGuardContext } from './escape-guard.ts';
import { OVERLAY_CLASSES, PANEL_TITLE_CLASSES } from './control-shell.ts';
import { SHEET_SURFACE_CLASSES } from './editor-shell.ts';
import { type ReactElement, type ReactNode, useMemo, useRef } from 'react';
import { X } from 'lucide-react';

export interface BottomSheetProps {
    readonly isOpen: boolean;
    readonly onOpenChange: (isOpen: boolean) => void;
    /** What the sheet calls itself, read out and drawn along its top. */
    readonly title: string;
    readonly closeLabel: string;
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
    closeLabel,
    trigger,
    children,
}: BottomSheetProps): ReactElement {
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
                    className={`${SHEET_SURFACE_CLASSES} z-50 h-[88dvh]`
                        + ' duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in'
                        + ' data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom'}
                >
                    {/* The grip every sheet on a phone has, so the shape is
                        recognised before the words are read. */}
                    <div className="flex shrink-0 justify-center pt-2" aria-hidden>
                        <span className="h-1 w-10 rounded-full bg-hairline-bright" />
                    </div>

                    <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-2">
                        <Dialog.Title className={PANEL_TITLE_CLASSES}>{title}</Dialog.Title>
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                aria-label={closeLabel}
                                className="grid size-11 shrink-0 place-items-center rounded-md text-ink-500 hover:bg-abyss-700 hover:text-ink-100"
                            >
                                <X className="size-4" />
                            </button>
                        </Dialog.Close>
                    </div>

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
