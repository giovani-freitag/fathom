import { Coins } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { DockPopover } from '../dock-popover.tsx';
import { MarketsPanel } from './markets-panel.tsx';
import { useTranslate } from '../../react/use-appearance.ts';
import type { WatchedPair } from '../../../shared/core/watch-lists.ts';

interface MarketsButtonProps {
    readonly openPair: WatchedPair | null;
    readonly onPairOpen: (pair: WatchedPair) => void;
    /** What the trigger shows: the symbol, however this bar shortens it. */
    readonly said: string;
    /** Which way the panel opens; above, where a dock is under it, by default. */
    readonly side?: 'top' | 'bottom';
    /** Opens the editor on the connector starter, where this build has one. */
    readonly onWriteAConnector?: (() => void) | undefined;
    readonly iconSizePx: number;
}

/**
 * The way into the contracts, wherever the bar holding it sits.
 *
 * Written once because the header and the dock open the same panel, and the one
 * thing they have to agree on is what pressing "add a venue" does: the editor
 * opens behind this panel, so this closes on the way out. Left open, a reader is
 * looking at a list of pairs with the thing they asked for underneath it.
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
            {...side === undefined ? {} : { side }}
            isOpen={isOpen}
            onOpenChange={setIsOpen}
            label={translate('markets.title')}
            trigger={(
                <span className="flex items-center gap-1 px-1 text-xs font-semibold">
                    <Coins size={iconSizePx} />
                    {said}
                </span>
            )}
        >
            {/* No title: the button it opened from is the title, and a panel
                that repeats it is a line the reader has to read twice. */}
            <MarketsPanel
                open={openPair}
                onOpen={onPairOpen}
                {...onWriteAConnector === undefined
                    ? {}
                    : { onWriteConnector: () => { setIsOpen(false); onWriteAConnector(); } }}
            />
        </DockPopover>
    );
}
