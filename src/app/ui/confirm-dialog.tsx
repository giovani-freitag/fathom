import { AlertDialog } from 'radix-ui';
import type { ReactElement } from 'react';
import { CONTROL_CHIP_CLASSES, CONTROL_OFFERED_CLASSES, PANEL_TITLE_CLASSES } from './control-shell.ts';
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

    return (
        <AlertDialog.Root open={isOpen} onOpenChange={onOpenChange}>
            <AlertDialog.Portal>
                <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/25" />
                <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[22rem] max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-hairline bg-abyss-850 p-4 shadow-2xl shadow-black/80">
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
