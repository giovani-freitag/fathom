import { useChartSlice } from './use-chart-state.ts';

/**
 * Which venue the contract on screen was recorded from.
 *
 * Empty before the listing has arrived, which reads as a venue nothing was
 * declared for — so nothing is offered until the chart knows where it is.
 *
 * @returns The venue's id.
 */
export function useVenue(): string {
    return useChartSlice((state) => state.instruments.find(
        (instrument) => instrument.instrumentSymbol === state.instrumentSymbol,
    )?.venue ?? '');
}
