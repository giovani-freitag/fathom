import { CONTROL_CHIP_CLASSES, CONTROL_OFFERED_CLASSES } from '../../ui/control-shell.ts';
import { isRecordable } from '../../markets/recordable.ts';
import { listConnectors } from '../../../shared/venues/venue-registry.ts';
import { PanelSection } from '../../ui/panel-section.tsx';
import { type ReactElement, useCallback, useEffect, useMemo, useState } from 'react';
import { RecordingCard } from './recording-card.tsx';
import type { RecordedContract, RecordingControl, StorageBudget } from '../../../shared/core/recording-control.ts';
import { formatFixed } from '../../core/formatting.ts';
import { RangeField } from '../../ui/range-field.tsx';
import type { Translate } from '../../i18n/translator.ts';

/** Ceilings offered when the host will not say how much room it has. */
const BUDGET_CHOICES_GB = [5, 10, 25, 50, 100] as const;

/** Shares of what a host does offer, which is how a browser is asked. */
const BUDGET_SHARES = [0.1, 0.25, 0.5, 0.75] as const;

const BYTES_PER_GIGABYTE = 1_073_741_824;

export interface RecordingPanelProps {
    readonly recording: RecordingControl;
    /** Called after a contract is switched on or off, so the picker keeps up. */
    readonly onContractsChanged: () => void;
    readonly translate: Translate;
}

interface PanelState {
    readonly contracts: readonly RecordedContract[];
    readonly budget: StorageBudget;
}

/**
 * What is being recorded, and how much disk it may take.
 */
export function RecordingPanel({ recording, onContractsChanged, translate }: RecordingPanelProps): ReactElement {
    const [state, setState] = useState<PanelState | null>(null);
    const [hasFailed, setHasFailed] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isPicking, setIsPicking] = useState(false);

    // Which venues have a book to record, and which have none. Read from the
    // registry rather than from what is already being recorded: the answer to
    // "what else could I record" is not in the list of what already is.
    const venues = useMemo(() => {
        const registered = listConnectors();
        return {
            offered: registered.filter(([, one]) => isRecordable(one.declaration)).map(([id]) => id),
            silent: registered.filter(([, one]) => !isRecordable(one.declaration)).map(([id]) => id),
        };
    }, []);

    const read = useCallback(async (): Promise<PanelState> => {
        const [contracts, budget] = await Promise.all([
            recording.listContracts(),
            recording.readBudget(),
        ]);
        return { contracts, budget };
    }, [recording]);

    const apply = useCallback(async (change: Promise<void>) => {
        setIsSaving(true);
        try {
            await change;
            setState(await read());
            setHasFailed(false);
        } catch {
            // Quoting the driver would put a sentence written for whoever
            // wrote it on a screen belonging to whoever is reading it.
            setHasFailed(true);
        } finally {
            setIsSaving(false);
        }
    }, [read]);

    useEffect(() => {
        let wasCancelled = false;
        read().then((next) => { if (!wasCancelled) { setState(next); } }, () => undefined);
        return () => { wasCancelled = true; };
    }, [read]);

    if (state === null) {
        return <p className="panel-note">{translate('recording.reading')}</p>;
    }

    return (
        <PanelSection
            title={translate('recording.title')}
            summary={translate('recording.usage', {
                used: formatGigabytes(state.budget.usedBytes),
                total: formatGigabytes(state.budget.maximumBytes),
            })}
        >

            <p className="panel-note">
                {translate('recording.contractsHelp')}
            </p>

            {/* A count rather than the list itself: the list is in the card
                that opens from here, where each pair carries its own switch,
                and the same rows written twice are two places to keep in step. */}
            <p className="text-xs text-ink-200">{summarise(state.contracts, translate)}</p>

            {/* Beside this rail rather than inside it: a venue lists a thousand
                pairs, and the panel it would be listed in is three hundred
                pixels wide. */}
            <RecordingCard
                isOpen={isPicking}
                onOpenChange={setIsPicking}
                trigger={(
                    <button
                        type="button"
                        className={`${CONTROL_CHIP_CLASSES} h-8 w-full justify-center ${CONTROL_OFFERED_CLASSES}`}
                    >
                        {translate('recording.addPair')}
                    </button>
                )}
                venues={venues.offered}
                silent={venues.silent}
                contracts={state.contracts}
                isSaving={isSaving}
                translate={translate}
                onRecord={(venue, instrument, priceBucketSize) => {
                    void apply(recording.saveContract({
                        venue,
                        instrumentSymbol: instrument.symbol,
                        priceBucketSize,
                        // The rate every contract here is recorded at; the panel
                        // offers no choice because nothing downstream reads a
                        // second one.
                        frameIntervalMs: 1_000,
                        isEnabled: true,
                    })).then(onContractsChanged);
                }}
                onToggle={(contract, isEnabled) => {
                    void apply(recording.saveContract({ ...contract, isEnabled })).then(onContractsChanged);
                }}
            />

            <BudgetChooser
                budget={state.budget}
                isSaving={isSaving}
                onChoose={(bytes) => { void apply(recording.setBudget(bytes)); }}
                translate={translate}
            />

            <p className="panel-note">
                {translate('recording.ceilingHelp')}
            </p>

            {hasFailed && (
                <p className="text-[11px] text-ask">{translate('recording.saveFailed')}</p>
            )}
        </PanelSection>
    );
}

/**
 * What is being recorded, in one line.
 *
 * A count and the venues it is spread over. The rows themselves live in the
 * card that opens from here — written in both places, they are two lists to
 * keep in step, and the one in the panel is the one that cannot show what is
 * missing from it.
 *
 * @param contracts - Every contract, recording or switched off.
 * @param translate - The reader's dictionary.
 * @returns The line to show.
 */
function summarise(contracts: readonly RecordedContract[], translate: Translate): string {
    const venues = [...new Set(contracts.map((contract) => contract.venue))];
    if (venues.length === 0) {
        return translate('recording.noneYet');
    }

    const off = contracts.filter((contract) => !contract.isEnabled).length;
    const said = translate('recording.onVenues', {
        count: String(contracts.length - off),
        venues: venues.join(', '),
    });

    return off === 0 ? said : `${said} · ${translate('recording.someOff', { count: String(off) })}`;
}

/**
 * Offers ceilings the host can actually honour.
 */
function BudgetChooser({ budget, isSaving, onChoose, translate }: {
    readonly budget: StorageBudget;
    readonly isSaving: boolean;
    readonly onChoose: (bytes: number) => void;
    readonly translate: Translate;
}): ReactElement {
    const choices = budget.availableBytes === null
        ? BUDGET_CHOICES_GB.map((gigabytes) => ({
            label: `${gigabytes} GB`,
            bytes: gigabytes * BYTES_PER_GIGABYTE,
        }))
        : BUDGET_SHARES.map((share) => ({
            label: formatGigabytes(budget.availableBytes! * share),
            bytes: Math.floor(budget.availableBytes! * share),
        }));

    // The ceiling is a figure with two ends, and what a reader wants from it is
    // where it sits between them rather than which of five buttons is lit.
    // Nothing matching is its own answer. The offered ceilings are shares of
    // the room the host reports, so a change in free disk moves every one of
    // them and a ceiling saved against the old set matches none of the new.
    // Pointing at the first would tell the reader a figure the server is not
    // enforcing.
    const chosen = choices.findIndex((choice) => isChosen(choice.bytes, budget.maximumBytes));
    const isOffered = chosen !== -1;

    return (
        <div className={isSaving ? 'pointer-events-none opacity-50' : ''}>
            <RangeField
                label={translate('recording.ceiling')}
                display={isOffered ? choices[chosen]!.label : formatGigabytes(budget.maximumBytes)}
                value={isOffered ? chosen : 0}
                minimum={0}
                maximum={choices.length - 1}
                step={1}
                handleLabel={translate('recording.ceiling')}
                onChange={(index) => { onChoose(choices[index]!.bytes); }}
            />
        </div>
    );
}

/** Within a percent, because a share of a quota never lands on a round number. */
function isChosen(offered: number, chosen: number): boolean {
    return Math.abs(offered - chosen) <= chosen * 0.01;
}

function formatGigabytes(bytes: number): string {
    const gigabytes = bytes / BYTES_PER_GIGABYTE;
    return gigabytes < 0.1
        ? `${formatFixed(bytes / 1_048_576, 0)} MB`
        : `${formatFixed(gigabytes, 1)} GB`;
}
