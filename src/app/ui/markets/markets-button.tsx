import { Coins } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { DockPopover } from '../dock-popover.tsx';
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
    iconSizePx,
}: MarketsButtonProps): ReactElement {
    const translate = useTranslate();
    const [isOpen, setIsOpen] = useState(false);

    return (
        <DockPopover
            isRoomy
            {...side === undefined ? {} : { side }}
            isOpen={isOpen}
            onOpenChange={setIsOpen}
            label={translate('markets.title')}
            said={said}
            trigger={(
                <span className="flex items-center gap-1 px-1 text-xs font-semibold">
                    <Coins size={iconSizePx} />
                    {said}
                </span>
            )}
        >
            <MarketsPanel
                open={openPair}
                onOpen={onPairOpen}
                onClose={() => { setIsOpen(false); }}
                {...onWriteAConnector === undefined
                    ? {}
                    : { onWriteConnector: () => { setIsOpen(false); onWriteAConnector(); } }}
            />
        </DockPopover>
    );
}
