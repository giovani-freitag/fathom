import { CONTROL_CHIP_CLASSES, CONTROL_CHOSEN_CLASSES, CONTROL_INPUT_CLASSES, CONTROL_OFFERED_CLASSES } from '../../ui/control-shell.ts';
import { isAlreadyRecorded, offerGrids } from '../../markets/recordable.ts';
import { narrowPairs } from '../../markets/pair-listing.ts';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import type { RecordedContract } from '../../../shared/core/recording-control.ts';
import type { Translate } from '../../i18n/translator.ts';
import { useMarkets } from '../../react/use-markets.ts';
import type { VenueInstrument } from '../../../shared/core/venue-connector.ts';

/** Rows offered at once, because this list is a choice rather than a catalogue. */
const ROWS_OFFERED = 40;

export interface RecordingPickerProps {
    /** The venues that publish a book, which are the only ones worth offering. */
    readonly venues: readonly string[];
    /** The venues that publish none, named so the absence is not a mystery. */
    readonly silent: readonly string[];
    readonly contracts: readonly RecordedContract[];
    readonly isSaving: boolean;
    readonly translate: Translate;
    readonly onRecord: (venue: string, instrument: VenueInstrument, priceBucketSize: number) => void;
}

/**
 * The pairs a venue offers to record, and the grid each would be recorded on.
 *
 * The panel used to list what was already being recorded and nothing else, back
 * when there was one venue and four contracts on it. With several venues the
 * question a reader arrives with is the other one — what *can* be recorded here
 * — and it is answered against the same listings the contract picker reads, so
 * a venue asked about twice is fetched once.
 */
export function RecordingPicker(props: RecordingPickerProps): ReactElement {
    const { state, markets } = useMarkets();
    const [venue, setVenue] = useState(props.venues[0] ?? '');
    const [query, setQuery] = useState('');
    const [chosen, setChosen] = useState<string | null>(null);

    const listing = state.listings[venue];
    // Only where nobody has asked yet. Asked again while one is in flight, each
    // pass aborts the last and starts another, and the listing never lands.
    useEffect(() => {
        if (venue !== '' && (listing === undefined || listing.kind === 'unread')) {
            void markets.readListing(venue);
        }
    }, [listing, markets, venue]);

    const listed = listing?.kind === 'read' || listing?.kind === 'reading' ? listing.instruments : null;
    const rows = useMemo(
        () => (listed === null ? [] : narrowPairs(listed, { query, quote: '' }).shown.slice(0, ROWS_OFFERED)),
        [listed, query],
    );

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap gap-1">
                {props.venues.map((one) => (
                    <button
                        key={one}
                        type="button"
                        aria-pressed={one === venue}
                        onClick={() => { setVenue(one); setChosen(null); }}
                        className={`${CONTROL_CHIP_CLASSES} h-7 justify-center px-2.5 ${
                            one === venue ? CONTROL_CHOSEN_CLASSES : CONTROL_OFFERED_CLASSES
                        }`}
                    >
                        {one}
                    </button>
                ))}
            </div>

            {props.silent.length > 0 && (
                <p className="panel-note">
                    {props.translate('recording.venuesWithoutBook', { venues: props.silent.join(', ') })}
                </p>
            )}

            <input
                type="search"
                name="recordSearch"
                aria-label={props.translate('markets.searchPairs')}
                placeholder={props.translate('markets.searchPairs')}
                value={query}
                onChange={(event) => { setQuery(event.target.value); }}
                className={`${CONTROL_INPUT_CLASSES} h-8 px-2`}
            />

            {listed === null || (listing?.kind === 'reading' && listed.length === 0)
                ? <p className="panel-note">{props.translate('markets.reading')}</p>
                : (
                    <ul className="max-h-48 space-y-1 overflow-y-auto">
                        {rows.map((instrument) => (
                            <PairRow
                                key={instrument.symbol}
                                instrument={instrument}
                                venue={venue}
                                isOpen={chosen === instrument.symbol}
                                isRecorded={isAlreadyRecorded(props.contracts, venue, instrument.symbol)}
                                isSaving={props.isSaving}
                                translate={props.translate}
                                onOpen={() => { setChosen(chosen === instrument.symbol ? null : instrument.symbol); }}
                                onRecord={(priceBucketSize) => {
                                    props.onRecord(venue, instrument, priceBucketSize);
                                    setChosen(null);
                                }}
                            />
                        ))}
                    </ul>
                )}
        </div>
    );
}

interface PairRowProps {
    readonly instrument: VenueInstrument;
    readonly venue: string;
    /** True while this row is showing the grids it could be recorded on. */
    readonly isOpen: boolean;
    readonly isRecorded: boolean;
    readonly isSaving: boolean;
    readonly translate: Translate;
    readonly onOpen: () => void;
    readonly onRecord: (priceBucketSize: number) => void;
}

/**
 * One pair on offer, and the grid question it asks before it is taken.
 *
 * Asked here rather than assumed, because the grid cannot be changed later: a
 * contract recorded on one and re-recorded on another has two grids in one
 * history, and nothing downstream can tell which row belongs to which.
 */
function PairRow(props: PairRowProps): ReactElement {
    const grids = offerGrids(props.instrument);

    return (
        <li className="rounded-md border border-hairline/60">
            <button
                type="button"
                disabled={props.isRecorded || grids.length === 0}
                onClick={props.onOpen}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-abyss-700 disabled:hover:bg-transparent"
            >
                <span className="numeric flex-1 truncate text-xs text-ink-200">{props.instrument.symbol}</span>
                <span className="text-[10px] text-ink-500">
                    {props.isRecorded
                        ? props.translate('recording.alreadyOn')
                        : grids.length === 0
                            ? props.translate('recording.noGrid')
                            : props.translate('recording.choose')}
                </span>
            </button>

            {props.isOpen && grids.length > 0 && (
                <div className="flex flex-wrap gap-1 border-t border-hairline/60 p-1.5">
                    {grids.map((grid) => (
                        <button
                            key={grid.ticks}
                            type="button"
                            disabled={props.isSaving}
                            onClick={() => { props.onRecord(grid.priceBucketSize); }}
                            className={`${CONTROL_CHIP_CLASSES} h-7 justify-center px-2 ${CONTROL_OFFERED_CLASSES}`}
                        >
                            {props.translate('settings.perRow', { value: grid.priceBucketSize })}
                        </button>
                    ))}
                </div>
            )}
        </li>
    );
}
