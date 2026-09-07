import { useChartSlice } from './use-chart-state.ts';

/**
 * Which venue the contract on screen is on.
 *
 * Read from the state rather than looked up in the coverage list. Looked up, it
 * answered by symbol alone and only for the handful being recorded — so a
 * reader who opened any of the other eight hundred and fifty-one contracts was
 * handed an empty venue, and every reading that declares what it needs was
 * drawn refused on a venue that in fact publishes it.
 *
 * @returns The venue's id, or empty before the chart is on anything.
 */
export function useVenue(): string {
    return useChartSlice((state) => state.venue ?? '');
}
