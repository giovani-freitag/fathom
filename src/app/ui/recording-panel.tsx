import { type ReactElement, useCallback, useEffect, useState } from 'react';
import type { RecordedContract, RecordingControl, StorageBudget } from '../../shared/core/recording-control.ts';
import { Switch } from 'radix-ui';
import { formatFixed } from '../core/formatting.ts';
import { RangeField } from './range-field.tsx';
import type { Translate } from '../i18n/translator.ts';

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
        return <p className="text-[11px] text-ink-600">{translate('recording.reading')}</p>;
    }

    return (
        <div className="space-y-3 border-t border-hairline pt-4">
            <div className="flex items-baseline justify-between">
                <span className="text-xs text-ink-300">{translate('recording.title')}</span>
                <span className="numeric text-[11px] text-ink-500">
                    {translate('recording.usage', {
                        used: formatGigabytes(state.budget.usedBytes),
                        total: formatGigabytes(state.budget.maximumBytes),
                    })}
                </span>
            </div>

            <p className="text-[11px] leading-snug text-ink-600">
                {translate('recording.contractsHelp')}
            </p>

            <ul className="space-y-1.5">
                {state.contracts.map((instrument) => (
                    <li key={instrument.instrumentSymbol} className="flex items-center justify-between gap-3">
                        <span className="numeric text-xs text-ink-200">
                            {instrument.instrumentSymbol}
                            <span className="ml-2 text-[10px] text-ink-600">
                                {translate('settings.perRow', { value: instrument.priceBucketSize })}
                            </span>
                        </span>
                        <Switch.Root
                            checked={instrument.isEnabled}
                            disabled={isSaving}
                            onCheckedChange={(isEnabled) => {
                                void apply(
                                    recording.saveContract({ ...instrument, isEnabled }),
                                ).then(onContractsChanged);
                            }}
                            className="relative h-5 w-9 shrink-0 rounded-full bg-abyss-600 outline-none data-[state=checked]:bg-phosphor/70 disabled:opacity-50"
                            aria-label={translate('recording.toggle', { symbol: instrument.instrumentSymbol })}
                        >
                            <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-abyss-950 transition-transform data-[state=checked]:translate-x-[18px]" />
                        </Switch.Root>
                    </li>
                ))}
            </ul>

            <BudgetChooser
                budget={state.budget}
                isSaving={isSaving}
                onChoose={(bytes) => { void apply(recording.setBudget(bytes)); }}
                translate={translate}
            />

            <p className="text-[11px] leading-snug text-ink-600">
                {translate('recording.ceilingHelp')}
            </p>

            {hasFailed && (
                <p className="text-[11px] text-ask">{translate('recording.saveFailed')}</p>
            )}
        </div>
    );
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
    const chosen = Math.max(0, choices.findIndex((choice) => isChosen(choice.bytes, budget.maximumBytes)));

    return (
        <div className={isSaving ? 'pointer-events-none opacity-50' : ''}>
            <RangeField
                label={translate('recording.ceiling')}
                display={choices[chosen]?.label ?? ''}
                value={chosen}
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
