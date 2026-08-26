import { findBarAt } from '../../core/dataset-lookup.ts';
import { formatPrice, formatSignedChange, formatSignedPercent } from '../../core/formatting.ts';
import type { LayerViewProps } from '../layer-contributions.ts';
import type { PriceBar } from '../../../shared/core/price-bar.ts';
import type { ReactElement } from 'react';
import { useCursorInstant } from '../../react/use-cursor-instant.ts';
import { useTranslate } from '../../react/use-appearance.ts';

/** The four figures of a bar, in the order every chart writes them. */
const FIGURES = [
    { key: 'readout.open', read: (bar: PriceBar) => bar.openPrice },
    { key: 'readout.high', read: (bar: PriceBar) => bar.highPrice },
    { key: 'readout.low', read: (bar: PriceBar) => bar.lowPrice },
    { key: 'readout.close', read: (bar: PriceBar) => bar.closePrice },
] as const;

/**
 * What the bar under the cursor opened, reached and closed at.
 *
 * Beside the name rather than in the crosshair, because it is read while the
 * eye is on the price: a reader comparing two bars looks between them, not down
 * at a box that moves with the pointer.
 */
export function CandleReadout({ state }: LayerViewProps): ReactElement | null {
    const translate = useTranslate();
    // At rest it is the newest bar, which is the one a reader means by "now".
    const atMs = useCursorInstant() ?? Number.POSITIVE_INFINITY;
    const bar = findBarAt(state.dataset, atMs) ?? state.dataset.bars.bars.at(-1) ?? null;

    if (bar === null) {
        return null;
    }

    const change = bar.closePrice - bar.openPrice;
    const tone = change < 0 ? 'text-ask' : 'text-bid';

    return (
        <span className="flex items-center gap-1.5 text-xs tabular-nums">
            {FIGURES.map((figure) => (
                <span key={figure.key} className="flex items-center gap-0.5">
                    <span className="text-ink-500">{translate(figure.key)}</span>
                    <span className={tone}>{formatPrice(figure.read(bar))}</span>
                </span>
            ))}
            <span className={tone}>
                {formatSignedChange(change)}
            </span>
            <span className={tone}>
                {/* Against its own open, which is what the bar's colour is
                    saying. A change measured from anywhere else would disagree
                    with the body the reader is looking at. */}
                ({formatSignedPercent(bar.openPrice === 0 ? 0 : change / bar.openPrice)})
            </span>
        </span>
    );
}
