/** Which shape of the phone picker a reader is being shown. */
export type PickerVariant = 'tabs' | 'drill';

/**
 * The picker shape this page was opened with.
 *
 * Read from the address so two shapes of the same screen can be put in front of
 * readers side by side and judged, rather than argued about. The question they
 * settle: on a phone, is the source a peer of the pair list — a tab beside it —
 * or a level above it, reached and left again.
 *
 * @returns The named variant, or the default where nothing was asked for.
 */
export function readPickerVariant(search: string): PickerVariant {
    return new URLSearchParams(search).get('picker') === 'drill' ? 'drill' : 'tabs';
}
