import { type ReactElement, useCallback, useEffect, useState } from 'react';
import type { RecordingApiService, RecordingState } from '../services/recording-api-service.ts';
import { Switch } from 'radix-ui';

/** Ceilings a reader is likely to want, rather than a free-text byte count. */
const BUDGET_CHOICES_GB = [5, 10, 25, 50, 100] as const;

const BYTES_PER_GIGABYTE = 1_073_741_824;

export interface RecordingPanelProps {
    readonly recording: RecordingApiService;
}

/**
 * What is being recorded, and how much disk it may take.
 *
 * Lives beside the display settings because it is the same kind of decision —
 * made while looking at the chart — but it is the only panel here that changes
 * what gets written rather than how it is drawn, so it says so.
 */
export function RecordingPanel({ recording }: RecordingPanelProps): ReactElement {
    const [state, setState] = useState<RecordingState | null>(null);
    const [failure, setFailure] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const apply = useCallback(async (change: Promise<RecordingState>) => {
        setIsSaving(true);
        try {
            setState(await change);
            setFailure(null);
        } catch (error) {
            setFailure(error instanceof Error ? error.message : String(error));
        } finally {
            setIsSaving(false);
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        recording.fetchState(controller.signal).then(setState, () => undefined);
        return () => { controller.abort(); };
    }, [recording]);

    if (state === null) {
        return <p className="text-[11px] text-ink-600">Reading what is being recorded…</p>;
    }

    return (
        <div className="space-y-3 border-t border-hairline pt-4">
            <div className="flex items-baseline justify-between">
                <span className="text-xs text-ink-300">Recording</span>
                <span className="numeric text-[11px] text-ink-500">
                    {formatGigabytes(state.usedBytes)} of {formatGigabytes(state.maximumBytes)}
                </span>
            </div>

            <p className="text-[11px] leading-snug text-ink-600">
                Turning a contract off stops new frames. What it already recorded stays, and
                is never deleted to make room before older history is.
            </p>

            <ul className="space-y-1.5">
                {state.instruments.map((instrument) => (
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
                                void apply(recording.saveInstrument({ ...instrument, isEnabled }));
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
                maximumBytes={state.maximumBytes}
                isSaving={isSaving}
                onChoose={(bytes) => { void apply(recording.saveBudget(bytes)); }}
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

function BudgetChooser({ maximumBytes, isSaving, onChoose }: {
    readonly maximumBytes: number;
    readonly isSaving: boolean;
    readonly onChoose: (bytes: number) => void;
}): ReactElement {
    const chosenGb = Math.round(maximumBytes / BYTES_PER_GIGABYTE);

    return (
        <div className="space-y-1.5">
            <span className="text-xs text-ink-300">Disk ceiling</span>
            <div className="flex gap-1.5">
                {BUDGET_CHOICES_GB.map((gigabytes) => (
                    <button
                        key={gigabytes}
                        type="button"
                        disabled={isSaving}
                        onClick={() => { onChoose(gigabytes * BYTES_PER_GIGABYTE); }}
                        className={`numeric flex-1 rounded-md border px-2 py-1.5 text-[11px] disabled:opacity-50 ${
                            gigabytes === chosenGb
                                ? 'border-phosphor/60 bg-phosphor/12 text-phosphor'
                                : 'border-hairline text-ink-400 hover:border-ink-700'
                        }`}
                    >
                        {gigabytes} GB
                    </button>
                ))}
            </div>
        </div>
    );
}

function formatGigabytes(bytes: number): string {
    const gigabytes = bytes / BYTES_PER_GIGABYTE;
    return gigabytes < 0.1 ? `${Math.round(bytes / 1_048_576)} MB` : `${gigabytes.toFixed(1)} GB`;
}
