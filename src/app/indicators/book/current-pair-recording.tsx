import { CONTROL_CHIP_CLASSES, CONTROL_CHOSEN_CLASSES, CONTROL_OFFERED_CLASSES } from '../../ui/control-shell.ts';
import { type GridChoice, offerGrids } from '../../markets/recordable.ts';
import { type ReactElement, useState } from 'react';
import type { RecordedContract } from '../../../shared/core/recording-control.ts';
import type { Translate } from '../../i18n/translator.ts';

/** The tick a venue quotes in, where the chart has not been told one. */
const TICK_WITHOUT_A_LISTING = 0;

/** The contract the chart is on, as much of it as this needs. */
export interface OpenPair {
    readonly venue: string;
    readonly symbol: string;
    /** The newest close, for pricing the ladder. Null before any candle lands. */
    readonly lastPrice: number | null;
}

interface CurrentPairRecordingProps {
    /** Absent where the chart is on nothing, and there is nothing to offer. */
    readonly pair: OpenPair | undefined;
    readonly contracts: readonly RecordedContract[];
    readonly isSaving: boolean;
    readonly translate: Translate;
    readonly onRecord: (venue: string, symbol: string, priceBucketSize: number) => void;
    readonly onToggle: (contract: RecordedContract, isEnabled: boolean) => void;
}

/**
 * Whether the contract on the chart is being recorded, and the switch for it.
 *
 * Here rather than only in the listing, because a reader who is looking at a
 * pair has already said which one they mean: managing it meant opening a card,
 * finding it among nine hundred rows, and coming back.
 *
 * The grid is still asked for before a recording starts. It cannot be changed
 * afterwards without two of them ending up in one history, so the one press
 * this saves is the press that opens the list, never the one that decides.
 */
export function CurrentPairRecording({
    pair,
    contracts,
    isSaving,
    translate,
    onRecord,
    onToggle,
}: CurrentPairRecordingProps): ReactElement | null {
    const [isChoosingGrid, setIsChoosingGrid] = useState(false);

    if (pair === undefined) {
        return null;
    }

    const { venue, symbol, lastPrice } = pair;
    const held = contracts.find((one) => one.venue === venue && one.instrumentSymbol === symbol);

    if (held !== undefined) {
        return (
            <button
                type="button"
                disabled={isSaving}
                onClick={() => { onToggle(held, !held.isEnabled); }}
                className={`${CONTROL_CHIP_CLASSES} h-8 w-full justify-center ${
                    held.isEnabled ? CONTROL_CHOSEN_CLASSES : CONTROL_OFFERED_CLASSES
                }`}
            >
                {translate(held.isEnabled ? 'recording.stopThis' : 'recording.resumeThis', { symbol })}
            </button>
        );
    }

    if (!isChoosingGrid) {
        return (
            <button
                type="button"
                disabled={isSaving}
                onClick={() => { setIsChoosingGrid(true); }}
                className={`${CONTROL_CHIP_CLASSES} h-8 w-full justify-center ${CONTROL_OFFERED_CLASSES}`}
            >
                {translate('recording.startThis', { symbol })}
            </button>
        );
    }

    // Priced off the newest candle, which the chart has whether or not anything
    // recorded this pair: the ladder is a share of the price, and a venue
    // listing is not needed to know what the price is.
    const grids = offerGrids({
        symbol,
        base: '',
        quote: '',
        priceStep: TICK_WITHOUT_A_LISTING,
        isTrading: true,
    }, lastPrice);

    return (
        <div className="flex flex-col gap-1.5">
            <span className="field-label">{translate('recording.gridFor', { symbol })}</span>
            <div className="flex flex-wrap gap-1.5">
                {grids.map((grid: GridChoice) => (
                    <button
                        key={grid.priceBucketSize}
                        type="button"
                        disabled={isSaving}
                        onClick={() => {
                            onRecord(venue, symbol, grid.priceBucketSize);
                            setIsChoosingGrid(false);
                        }}
                        className={`${CONTROL_CHIP_CLASSES} numeric h-8 justify-center px-2.5 ${CONTROL_OFFERED_CLASSES}`}
                    >
                        {grid.priceBucketSize}
                    </button>
                ))}
            </div>
            {grids.length === 0 && (
                <p className="panel-note">{translate('recording.noGridYet')}</p>
            )}
        </div>
    );
}
