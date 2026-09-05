import { ArrowLeft } from 'lucide-react';
import type { ReactElement } from 'react';

export interface PanelStepProps {
    readonly title: string;
    readonly onBack: () => void;
    readonly children: ReactElement;
}

/**
 * One step in from a panel's list, with the way back where a reader looks for it.
 *
 * A step rather than a card beside the panel: a popover anchored to a control
 * inside another popover is positioned against the trigger and sized against the
 * window, and on a phone those two answers disagree by more than the screen is
 * wide. Going deeper in the panel the reader already has open cannot land
 * off-screen, because it never leaves it.
 */
export function PanelStep({ title, onBack, children }: PanelStepProps): ReactElement {
    return (
        <div className="flex min-h-0 flex-col gap-2">
            <button
                type="button"
                onClick={onBack}
                className="flex shrink-0 items-center gap-1.5 self-start rounded-md px-1 py-1.5 text-xs text-ink-500 hover:text-ink-100"
            >
                <ArrowLeft className="size-3.5" />
                {title}
            </button>
            {children}
        </div>
    );
}
