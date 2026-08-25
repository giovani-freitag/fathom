import { type ReactElement, useCallback, useEffect, useState } from 'react';
import type { RecordedContract, RecordingControl, StorageBudget } from '../../shared/core/recording-control.ts';
import { Switch } from 'radix-ui';

/** Ceilings offered when the host will not say how much room it has. */
const BUDGET_CHOICES_GB = [5, 10, 25, 50, 100] as const;

/** Shares of what a host does offer, which is how a browser is asked. */
const BUDGET_SHARES = [0.1, 0.25, 0.5, 0.75] as const;

const BYTES_PER_GIGABYTE = 1_073_741_824;

export interface RecordingPanelProps {
    readonly recording: RecordingControl;
    /** Called after a contract is switched on or off, so the picker keeps up. */
    readonly onContractsChanged: () => void;
}

interface PanelState {
    readonly contracts: readonly RecordedContract[];
    readonly budget: StorageBudget;
}

/**
 * What is being recorded, and how much disk it may take.
 */
export function RecordingPanel({ recording, onContractsChanged }: RecordingPanelProps): ReactElement {
    const [state, setState] = useState<PanelState | null>(null);
    const [failure, setFailure] = useState<string | null>(null);
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
            setFailure(null);
        } catch (error) {
            setFailure(error instanceof Error ? error.message : String(error));
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
        return <p className="text-[11px] text-ink-600">Reading what is being recorded…</p>;
    }

    return (
        <div className="space-y-3 border-t border-hairline pt-4">
            <div className="flex items-baseline justify-between">
                <span className="text-xs text-ink-300">Recording</span>
                <span className="numeric text-[11px] text-ink-500">
                    {formatGigabytes(state.budget.usedBytes)} of {formatGigabytes(state.budget.maximumBytes)}
                </span>
            </div>

            <p className="text-[11px] leading-snug text-ink-600">
                Turning a contract off stops new frames. What it already recorded stays, and
                is never deleted to make room before older history is.
            </p>

            <ul className="space-y-1.5">
                {state.contracts.map((instrument) => (
                    <li key={instrument.instrumentSymbol} className="flex items-center justify-between gap-3">
                        <span className="numeric text-xs text-ink-200">
                            {instrument.instrumentSymbol}
                            <span className="ml-2 text-[10px] text-ink-600">
                                {instrument.priceBucketSize} per row
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
                            aria-label={`Record ${instrument.instrumentSymbol}`}
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
            />

            <p className="text-[11px] leading-snug text-ink-600">
                Past the ceiling the oldest day is dropped, a whole partition at a time —
                deleting single rows from compressed history costs more disk than it frees.
            </p>

            {failure === null ? null : (
                <p className="text-[11px] text-ask">{failure}</p>
            )}
        </div>
    );
}

/**
 * Offers ceilings the host can actually honour.
 */
function BudgetChooser({ budget, isSaving, onChoose }: {
    readonly budget: StorageBudget;
    readonly isSaving: boolean;
    readonly onChoose: (bytes: number) => void;
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

    return (
        <div className="space-y-1.5">
            <span className="text-xs text-ink-300">Storage ceiling</span>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
                {choices.map((choice) => (
                    <button
                        key={choice.label}
                        type="button"
                        disabled={isSaving}
                        onClick={() => { onChoose(choice.bytes); }}
                        className={`numeric whitespace-nowrap rounded-md border px-2 py-1.5 text-[11px] disabled:opacity-50 ${
                            isChosen(choice.bytes, budget.maximumBytes)
                                ? 'border-phosphor/60 bg-phosphor/12 text-phosphor'
                                : 'border-hairline text-ink-400 hover:border-ink-700'
                        }`}
                    >
                        {choice.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

/** Within a percent, because a share of a quota never lands on a round number. */
function isChosen(offered: number, chosen: number): boolean {
    return Math.abs(offered - chosen) <= chosen * 0.01;
}

function formatGigabytes(bytes: number): string {
    const gigabytes = bytes / BYTES_PER_GIGABYTE;
    return gigabytes < 0.1 ? `${Math.round(bytes / 1_048_576)} MB` : `${gigabytes.toFixed(1)} GB`;
}
