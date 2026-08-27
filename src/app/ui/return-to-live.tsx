import { ChevronsRight } from 'lucide-react';
import type { ReactElement } from 'react';
import { useTranslate } from '../react/use-appearance.ts';

interface ReturnToLiveProps {
    readonly onReturn: () => void;
}

/**
 * Brings the chart back to the live edge.
 *
 * Shown only once the view has left it, which is also the only thing that says
 * the chart is in history: a strip reporting that permanently was a line of
 * chrome carried for the sake of a state the reader can already see.
 *
 * The gesture was already there — a double click anywhere — but a gesture
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
            className="pointer-events-auto grid size-9 place-items-center rounded-full border border-hairline bg-abyss-800/95 text-ink-400 shadow-lg backdrop-blur transition-colors hover:border-hairline-bright hover:text-phosphor"
        >
            <ChevronsRight className="size-4" />
        </button>
    );
}
