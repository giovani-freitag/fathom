import { ChevronsRight } from 'lucide-react';
import type { ReactElement } from 'react';
import { useTranslate } from '../react/use-appearance.ts';

interface ReturnToLiveProps {
    readonly onReturn: () => void;
}

/**
 * Brings the chart back to the live edge.
 *
 * Shown only once the view has left it, where the newest bar would be. The
 * gesture for this was already there — a double click anywhere — but a gesture
 * nobody is told about is one nobody uses, and a reader who has panned into
 * history has no other way back than dragging until they arrive.
 */
export function ReturnToLive({ onReturn }: ReturnToLiveProps): ReactElement {
    const translate = useTranslate();

    return (
        <button
            type="button"
            onClick={onReturn}
            title={translate('page.returnToLive')}
            aria-label={translate('page.returnToLive')}
            className="pointer-events-auto absolute bottom-3 right-3 grid size-8 place-items-center rounded-full border border-hairline bg-abyss-900/90 text-ink-500 shadow-lg backdrop-blur-sm transition-colors hover:border-hairline-bright hover:text-phosphor"
        >
            <ChevronsRight className="size-4" />
        </button>
    );
}
