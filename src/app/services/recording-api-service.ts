import { API_ROUTES } from '../../shared/core/api-contract.ts';
import { HeatmapSourceError } from '../../shared/core/heatmap-source.ts';

/** One contract the gateway is willing to record, and whether it is. */
export interface RecordedInstrument {
    readonly instrumentSymbol: string;
    readonly priceBucketSize: number;
    readonly frameIntervalMs: number;
    readonly isEnabled: boolean;
}

/** What is being recorded and how much disk it is allowed. */
export interface RecordingState {
    readonly instruments: readonly RecordedInstrument[];
    readonly maximumBytes: number;
    readonly usedBytes: number;
}

export interface RecordingApiServiceConfig {
    readonly baseUrl: string;
}

/**
 * What the gateway records, and the disk it may use.
 *
 * Separate from the chart's own source because it is a different question: the
 * source answers what was recorded, this answers what is being recorded, and a
 * page reading from its own archive has the first without the second.
 */
export class RecordingApiService {
    private readonly baseUrl: string;

    constructor(config: RecordingApiServiceConfig) {
        this.baseUrl = config.baseUrl;
    }

    /**
     * Reads the current recording state.
     *
     * @param signal - Aborts the request when the reader moves on.
     * @returns Every contract and the disk budget.
     * @throws HeatmapSourceError when the gateway cannot answer.
     */
    async fetchState(signal?: AbortSignal): Promise<RecordingState> {
        return this.request(API_ROUTES.recording, signal === undefined ? {} : { signal });
    }

    /**
     * Turns a contract's recording on or off, or changes its grid.
     *
     * The supervisor reconciles on its own schedule, so the returned state
     * reflects the decision rather than a collector that has already started.
     *
     * @param instrument - The contract and what it should be.
     * @returns The state after the change.
     * @throws HeatmapSourceError when the gateway refuses.
     */
    async saveInstrument(instrument: RecordedInstrument): Promise<RecordingState> {
        return this.request(API_ROUTES.recording, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(instrument),
        });
    }

    /**
     * Changes how much disk the whole recording may take.
     *
     * @param maximumBytes - The new ceiling.
     * @returns The state after the change.
     * @throws HeatmapSourceError when the gateway refuses.
     */
    async saveBudget(maximumBytes: number): Promise<RecordingState> {
        return this.request(API_ROUTES.recordingBudget, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ maximumBytes }),
        });
    }

    private async request(route: string, init: RequestInit): Promise<RecordingState> {
        let response: Response;
        try {
            response = await fetch(new URL(route, this.baseUrl), init);
        } catch (error) {
            throw new HeatmapSourceError('The gateway did not answer', 0, { cause: error });
        }

        if (!response.ok) {
            throw new HeatmapSourceError(
                'The gateway refused the change',
                response.status,
            );
        }
        return (await response.json()) as RecordingState;
    }
}
