import { API_ROUTES } from '../../shared/core/api-contract.ts';
import { HeatmapSourceError } from '../../shared/core/heatmap-source.ts';
import type {
    RecordedContract,
    RecordingControl,
    StorageBudget,
} from '../../shared/core/recording-control.ts';

interface RecordingStateResponse {
    readonly instruments: readonly RecordedContract[];
    readonly maximumBytes: number;
    readonly usedBytes: number;
}

export interface RecordingApiServiceConfig {
    readonly baseUrl: string;
}

/**
 * What the gateway records, and the disk it may use.
 */
export class RecordingApiService implements RecordingControl {
    private readonly baseUrl: string;

    constructor(config: RecordingApiServiceConfig) {
        this.baseUrl = config.baseUrl;
    }

    /**
     * Every contract the gateway knows, and whether it is recording.
     *
     * @returns The contracts, ordered by symbol.
     * @throws HeatmapSourceError when the gateway cannot answer.
     */
    async listContracts(): Promise<readonly RecordedContract[]> {
        return (await this.request(API_ROUTES.recording, {})).instruments;
    }

    /**
     * Turns a contract's recording on or off, or changes its grid.
     *
     * @param contract - The contract and what it should be.
     * @throws HeatmapSourceError when the gateway refuses.
     */
    async saveContract(contract: RecordedContract): Promise<void> {
        await this.request(API_ROUTES.recording, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(contract),
        });
    }

    /**
     * The disk ceiling and what the recording occupies.
     *
     * @returns Both in bytes; how much disk exists is not something a query can
     *          see from inside the database, so it is reported as unknown.
     * @throws HeatmapSourceError when the gateway cannot answer.
     */
    async readBudget(): Promise<StorageBudget> {
        const state = await this.request(API_ROUTES.recording, {});
        return {
            maximumBytes: state.maximumBytes,
            usedBytes: state.usedBytes,
            availableBytes: null,
        };
    }

    /**
     * Changes how much disk the whole recording may take.
     *
     * @param maximumBytes - The new ceiling.
     * @throws HeatmapSourceError when the gateway refuses.
     */
    async setBudget(maximumBytes: number): Promise<void> {
        await this.request(API_ROUTES.recordingBudget, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ maximumBytes }),
        });
    }

    /**
     * Nothing: the supervisor prunes on its own schedule, beside the recording.
     */
    async pruneToBudget(): Promise<number> {
        return Promise.resolve(0);
    }

    private async request(route: string, init: RequestInit): Promise<RecordingStateResponse> {
        let response: Response;
        try {
            response = await fetch(new URL(route, this.baseUrl), init);
        } catch (error) {
            throw new HeatmapSourceError('The gateway did not answer', 0, { cause: error });
        }

        if (!response.ok) {
            throw new HeatmapSourceError('The gateway refused the change', response.status);
        }
        return (await response.json()) as RecordingStateResponse;
    }
}
