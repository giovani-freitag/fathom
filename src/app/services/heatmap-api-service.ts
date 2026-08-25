import type { HeatmapSource } from '../../shared/core/heatmap-source.ts';
import {
    API_ROUTES,
    type InstrumentCoverage,
    type InstrumentListResponse,
    type RecordingGapResponse,
    type TradeClusterResponse,
} from '../../shared/core/api-contract.ts';
import { decodeLiquidityFrameWindow } from '../../shared/codec/heatmap-codec.ts';
import { type LiquidityFrameWindow } from '../../shared/core/liquidity-frame.ts';
import { type RecordingGap } from '../../shared/core/recording-gap.ts';

/** Raised when the gateway cannot answer a query. */
export class HeatmapApiError extends Error {
    readonly status: number;

    constructor(message: string, status: number, options?: ErrorOptions) {
        super(message, options);
        this.name = 'HeatmapApiError';
        this.status = status;
    }
}

export interface HeatmapApiServiceConfig {
    /**
     * Absolute origin of the gateway.
     *
     * Absolute on purpose: a relative path only resolves because a browser
     * resolves it against `location`, and depending on that would make the core
     * untestable outside a DOM. The entry point owns the browser and passes it in.
     */
    readonly baseUrl: string;
}

export interface FrameWindowQuery {
    readonly symbol: string;
    readonly fromMs: number;
    readonly toMs: number;
    readonly maxColumns: number;
}

export interface TradeClusterQuery extends FrameWindowQuery {
    readonly priceGroupSize: number;
    readonly minimumQuantity: number;
}

export interface TradeClusterResult {
    readonly priceBucketSize: number;
    readonly sampleIntervalMs: number;
    readonly clusters: TradeClusterResponse['clusters'];
}

/**
 * The only place the gateway's HTTP surface is spoken.
 *
 * Depth arrives as a binary window and is decoded here, so the rest of the app
 * never sees a wire format.
 */
export class HeatmapApiService implements HeatmapSource {
    private readonly baseUrl: string;

    constructor(config: HeatmapApiServiceConfig) {
        this.baseUrl = config.baseUrl.replace(/\/$/, '');
    }

    /**
     * Every instrument the collector has recorded.
     *
     * @param signal - Aborts the request when the caller loses interest.
     * @returns Coverage per instrument.
     * @throws HeatmapApiError when the gateway rejects the request.
     */
    async fetchInstruments(signal?: AbortSignal): Promise<readonly InstrumentCoverage[]> {
        const payload = await this.requestJson<InstrumentListResponse>(
            API_ROUTES.instruments,
            new URLSearchParams(),
            signal,
        );
        return payload.instruments;
    }

    /**
     * Depth frames across a time range, sampled to the requested column budget.
     *
     * @param query - Instrument, range, and column budget.
     * @param signal - Aborts the request when the caller loses interest.
     * @returns The decoded window; its quantity arrays view the response buffer.
     * @throws HeatmapApiError when the gateway rejects the request.
     */
    async fetchFrameWindow(query: FrameWindowQuery, signal?: AbortSignal): Promise<LiquidityFrameWindow> {
        const response = await this.request(API_ROUTES.heatmap, toWindowParameters(query), signal);
        return decodeLiquidityFrameWindow(await response.arrayBuffer());
    }

    /**
     * Executions across a time range, binned onto the requested grid.
     *
     * @param query - Instrument, range, column budget, and price binning.
     * @param signal - Aborts the request when the caller loses interest.
     * @returns The clusters and the grid they sit on.
     * @throws HeatmapApiError when the gateway rejects the request.
     */
    async fetchTradeClusters(query: TradeClusterQuery, signal?: AbortSignal): Promise<TradeClusterResult> {
        const parameters = toWindowParameters(query);
        parameters.set('priceGroupSize', String(Math.max(1, Math.round(query.priceGroupSize))));
        parameters.set('minimumQuantity', String(query.minimumQuantity));

        return this.requestJson<TradeClusterResponse>(API_ROUTES.tradeClusters, parameters, signal);
    }

    /**
     * Unrecorded windows overlapping a time range.
     *
     * @param query - Instrument and range; the column budget is ignored.
     * @param signal - Aborts the request when the caller loses interest.
     * @returns The gaps, ordered by start instant.
     * @throws HeatmapApiError when the gateway rejects the request.
     */
    async fetchGaps(query: FrameWindowQuery, signal?: AbortSignal): Promise<readonly RecordingGap[]> {
        const payload = await this.requestJson<RecordingGapResponse>(
            API_ROUTES.gaps,
            toWindowParameters(query),
            signal,
        );
        return payload.gaps;
    }

    private async requestJson<TPayload>(
        route: string,
        parameters: URLSearchParams,
        signal?: AbortSignal,
    ): Promise<TPayload> {
        const response = await this.request(route, parameters, signal);
        return (await response.json()) as TPayload;
    }

    private async request(
        route: string,
        parameters: URLSearchParams,
        signal?: AbortSignal,
    ): Promise<Response> {
        const requestUrl = new URL(`${this.baseUrl}${route}`);
        requestUrl.search = parameters.toString();

        let response: Response;
        try {
            response = await fetch(requestUrl, signal === undefined ? {} : { signal });
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                throw error;
            }
            throw new HeatmapApiError('Gateway unreachable', 0, { cause: error });
        }

        if (!response.ok) {
            throw new HeatmapApiError(`Gateway answered ${response.status}`, response.status);
        }
        return response;
    }
}

/**
 * The gateway declares every bound as an integer, and viewport arithmetic
 * produces fractional milliseconds, so the rounding has to happen here rather
 * than being left to a schema rejection.
 */
function toWindowParameters(query: FrameWindowQuery): URLSearchParams {
    return new URLSearchParams({
        symbol: query.symbol,
        fromMs: String(Math.floor(query.fromMs)),
        toMs: String(Math.ceil(query.toMs)),
        maxColumns: String(Math.max(1, Math.round(query.maxColumns))),
    });
}
