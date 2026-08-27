import type { ChartDataset } from '../../core/chart-dataset.ts';
import type { ChartState } from '../../core/chart-controller.ts';
import { findBarAt } from '../../core/dataset-lookup.ts';
import { formatPrice, formatSignedChange, formatSignedPercent } from '../../core/formatting.ts';
import type { PriceBar } from '../../../shared/core/price-bar.ts';
import type { ReactElement } from 'react';
import { useChartSlice } from '../../react/use-chart-state.ts';
import { useCursorInstant } from '../../react/use-cursor-instant.ts';
import { useTranslate } from '../../react/use-appearance.ts';

/** Declared once so the subscription is the same one on every render. */
const readDataset = (state: ChartState): ChartDataset => state.dataset;

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
 * At rest it reads the newest bar, which is the one a reader means by "now".
 *
 * Four prices and a change are wider than any panel on a phone, so the figures
 * wrap rather than run off the edge: each one is an atom that stays with its own
 * label, and the row breaks between them.
 */
export function CandleReadout(): ReactElement | null {
    const translate = useTranslate();
    const dataset = useChartSlice(readDataset);
    // At rest it is the newest bar, which is the one a reader means by "now".
    const atMs = useCursorInstant() ?? Number.POSITIVE_INFINITY;
    const bar = findBarAt(dataset, atMs) ?? dataset.bars.bars.at(-1) ?? null;

    if (bar === null) {
        return null;
    }

    const change = bar.closePrice - bar.openPrice;
    const tone = change < 0 ? 'text-ask' : 'text-bid';

    return (
        <span className="flex flex-wrap items-center gap-x-1.5 text-xs tabular-nums">
            {FIGURES.map((figure) => (
                <span key={figure.key} className="flex shrink-0 items-center gap-0.5">
                    <span className="text-ink-500">{translate(figure.key)}</span>
                    <span className={tone}>{formatPrice(figure.read(bar))}</span>
                </span>
            ))}
            {/* One atom: the move and what it is as a share of the open read as
                a single figure, and a line break between them splits it. Both
                are measured against the bar's own open, which is what its
                colour is saying; from anywhere else they would disagree with
                the body the reader is looking at. */}
            <span className={`flex shrink-0 items-center gap-1 ${tone}`}>
                <span>{formatSignedChange(change)}</span>
                <span>({formatSignedPercent(bar.openPrice === 0 ? 0 : change / bar.openPrice)})</span>
            </span>
        </span>
    );
}
