import { AlertDialog } from 'radix-ui';
import { type ReactElement, useEffect, useRef } from 'react';
import {
    CONTROL_CHIP_CLASSES,
    CONTROL_OFFERED_CLASSES,
    OVERLAY_CLASSES,
    PANEL_TITLE_CLASSES,
} from './control-shell.ts';
import { useTranslate } from '../react/use-appearance.ts';

interface ConfirmDialogProps {
    readonly isOpen: boolean;
    readonly onOpenChange: (isOpen: boolean) => void;
    readonly title: string;
    readonly body: string;
    /** What the button that goes through with it says. */
    readonly confirmLabel: string;
    readonly onConfirm: () => void;
}

/**
 * Asks before something that cannot be taken back.
 *
 * This chart answers a removal with an undo rather than a question, because a
 * layer taken off is a layer put back in one press. A script is not that: it is
 * the only copy of work somebody wrote, and the undo that covers it lasts
 * seconds and does not survive the page. What cannot be recovered is asked
 * about; what can is offered back.
 */
export function ConfirmDialog({
    isOpen,
    onOpenChange,
    title,
    body,
    confirmLabel,
    onConfirm,
}: ConfirmDialogProps): ReactElement {
    const translate = useTranslate();
    // Opened from a control rather than from a trigger of its own, so Radix has
    // nothing to hand the focus back to. Remembered here instead: without it a
    // reader who cancels lands on the document and has to tab through a hundred
    // and fifty rows to get back to the button they pressed.
    const asked = useRef<HTMLElement | null>(null);
    useEffect(() => {
        if (isOpen) {
            asked.current = document.activeElement as HTMLElement | null;
        }
    }, [isOpen]);

    return (
        <AlertDialog.Root open={isOpen} onOpenChange={onOpenChange}>
            <AlertDialog.Portal>
                <AlertDialog.Overlay className={OVERLAY_CLASSES} />
                <AlertDialog.Content
                    // Radix restores the focus itself on the way out, and with
                    // no trigger of its own it has nowhere to put it — so it
                    // runs after any restore of ours and leaves the reader on
                    // the document. Taken over here instead.
                    onCloseAutoFocus={(event) => {
                        if (asked.current !== null) {
                            event.preventDefault();
                            asked.current.focus();
                        }
                    }}
                    className="fixed left-1/2 top-1/2 z-50 w-[22rem] max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-hairline bg-abyss-850 p-4 shadow-2xl shadow-black/80">
                    <AlertDialog.Title className={PANEL_TITLE_CLASSES}>
                        {title}
                    </AlertDialog.Title>
                    <AlertDialog.Description className="mt-2 text-xs leading-relaxed text-ink-400">
                        {body}
                    </AlertDialog.Description>

                    {/* The way out on the left, where a reader's eye lands
                        first, and the destructive answer where it has to be
                        reached for. */}
                    <div className="mt-4 flex justify-end gap-2">
                        <AlertDialog.Cancel asChild>
                            <button
                                type="button"
                                className={`${CONTROL_CHIP_CLASSES} h-8 justify-center ${CONTROL_OFFERED_CLASSES}`}
                            >
                                {translate('confirm.cancel')}
                            </button>
                        </AlertDialog.Cancel>
                        <AlertDialog.Action asChild>
                            <button
                                type="button"
                                onClick={onConfirm}
                                className={`${CONTROL_CHIP_CLASSES} h-8 justify-center border-ask/60 bg-ask/12 text-ask hover:bg-ask/20`}
                            >
                                {confirmLabel}
                            </button>
                        </AlertDialog.Action>
                    </div>
                </AlertDialog.Content>
            </AlertDialog.Portal>
        </AlertDialog.Root>
    );
}
