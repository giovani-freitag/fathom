import { Coins } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import {
    CONTROL_ACTIVE_CLASSES,
    CONTROL_BUTTON_CLASSES,
    CONTROL_RESTING_CLASSES,
} from '../control-shell.ts';
import { MarketsDialog } from './markets-dialog.tsx';
import { useTranslate } from '../../react/use-appearance.ts';
import type { WatchedPair } from '../../../shared/core/watch-lists.ts';

interface MarketsButtonProps {
    readonly openPair: WatchedPair | null;
    readonly onPairOpen: (pair: WatchedPair) => void;
    /** What the trigger shows: the symbol, however this bar shortens it. */
    readonly said: string;
    /** Opens the editor on the connector starter, where this build has one. */
    readonly onWriteAConnector?: (() => void) | undefined;
    readonly iconSizePx: number;
}

/**
 * The way into the contracts, wherever the bar holding it sits.
 *
 * Written once because the header and the dock open the same card, and the one
 * thing they have to agree on is what pressing "add a venue" does: the editor
 * opens behind this card, so this closes on the way out.
 */
export function MarketsButton({
    openPair,
    onPairOpen,
    said,
    onWriteAConnector,
    iconSizePx,
}: MarketsButtonProps): ReactElement {
    const translate = useTranslate();
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <button
                type="button"
                aria-label={translate('markets.title')}
                aria-haspopup="dialog"
                aria-expanded={isOpen}
                onClick={() => { setIsOpen(true); }}
                className={`${CONTROL_BUTTON_CLASSES} ${isOpen ? CONTROL_ACTIVE_CLASSES : CONTROL_RESTING_CLASSES}`}
            >
                <span className="flex items-center gap-1 px-1 text-xs font-semibold">
                    <Coins size={iconSizePx} />
                    {said}
                </span>
            </button>

            {/* Mounted only while it is open. The card subscribes to what is
                recorded and asks a venue for its listing the moment it appears,
                and a bar carrying this button should do neither until somebody
                presses it. */}
            {isOpen && (
                <MarketsDialog
                    isOpen
                    onOpenChange={setIsOpen}
                    open={openPair}
                    onOpen={onPairOpen}
                    {...onWriteAConnector === undefined
                        ? {}
                        : { onWriteConnector: () => { setIsOpen(false); onWriteAConnector(); } }}
                />
            )}
        </>
    );
}
