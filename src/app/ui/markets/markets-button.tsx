import { BottomSheet } from '../bottom-sheet.tsx';
import { Coins } from 'lucide-react';
import { CONTROL_BUTTON_CLASSES, CONTROL_RESTING_CLASSES } from '../control-shell.ts';
import { type ReactElement, useState } from 'react';
import { DockPopover } from '../dock-popover.tsx';
import { useIsViewportAtLeast } from '../../react/use-viewport-width.ts';
import { MarketsPanel } from './markets-panel.tsx';
import { useTranslate } from '../../react/use-appearance.ts';
import type { MarketPair } from '../../../shared/core/pair-tags.ts';

interface MarketsButtonProps {
    readonly openPair: MarketPair | null;
    readonly onPairOpen: (pair: MarketPair) => void;
    /** What the trigger shows: the symbol, however this bar shortens it. */
    readonly said: string;
    /** Which way the card opens; above, where a dock is under it, by default. */
    readonly side?: 'top' | 'bottom';
    /** Opens the editor on the connector starter, where this build has one. */
    readonly onWriteAConnector?: (() => void) | undefined;
    /** Opens the editor on a connector the reader brought. */
    readonly onEditAConnector?: ((venue: string) => void) | undefined;
    readonly iconSizePx: number;
}

/**
 * The way into the contracts, wherever the bar holding it sits.
 *
 * The same dropdown the layers open from, given the room a listing needs. The
 * two things the header and the dock have to agree on live here: what pressing
 * "add a venue" does — the editor opens behind this card, so it closes on the
 * way out — and that picking a pair closes it too.
 */
export function MarketsButton({
    openPair,
    onPairOpen,
    said,
    side,
    onWriteAConnector,
    onEditAConnector,
    iconSizePx,
}: MarketsButtonProps): ReactElement {
    const translate = useTranslate();
    const [isOpen, setIsOpen] = useState(false);
    const isWide = useIsViewportAtLeast('lg');

    const listing = (
        <MarketsPanel
            open={openPair}
            onOpen={onPairOpen}
            onClose={() => { setIsOpen(false); }}
            {...onWriteAConnector === undefined
                ? {}
                : { onWriteConnector: () => { setIsOpen(false); onWriteAConnector(); } }}
            {...onEditAConnector === undefined
                ? {}
                : { onEditConnector: (venue: string) => { setIsOpen(false); onEditAConnector(venue); } }}
        />
    );

    const face = (
        <span className="flex items-center gap-1 px-1 text-xs font-semibold">
            <Coins size={iconSizePx} />
            {said}
        </span>
    );

    // A sheet where the screen is the constraint, a card beside the control
    // where it is not. The card is placed against its trigger and sized against
    // the window, which on a phone leaves a listing of nine hundred pairs about
    // three rows to stand in once the search and the filters have had theirs.
    if (!isWide) {
        return (
            <BottomSheet
                isOpen={isOpen}
                onOpenChange={setIsOpen}
                title={translate('markets.title')}
                trigger={(
                    <button
                        type="button"
                        aria-label={`${said} — ${translate('markets.title')}`}
                        className={`${CONTROL_BUTTON_CLASSES} ${CONTROL_RESTING_CLASSES}`}
                    >
                        {face}
                    </button>
                )}
            >
                {listing}
            </BottomSheet>
        );
    }

    return (
        <DockPopover
            isRoomy
            {...side === undefined ? {} : { side }}
            isOpen={isOpen}
            onOpenChange={setIsOpen}
            label={translate('markets.title')}
            said={said}
            trigger={face}
        >
            {listing}
        </DockPopover>
    );
}
