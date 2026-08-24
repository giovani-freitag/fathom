import { ChartController } from '@core/modules/chart/chart-controller';
import { HeatmapApiService } from '@core/services/heatmap-api/heatmap-api-service';
import { LiveFeedService } from '@core/services/live-feed/live-feed-service';
import { PreferencesService } from '@core/services/preferences/preferences-service';

export interface ServiceContainer {
    readonly api: HeatmapApiService;
    readonly liveFeed: LiveFeedService;
    readonly preferences: PreferencesService;
    readonly chart: ChartController;
}

export interface ServiceContainerConfig {
    /**
     * Absolute origin of the gateway, scheme included.
     *
     * Absolute and required on purpose. A relative `/api` only resolves because
     * a browser resolves it against `location`, and depending on that would make
     * the core untestable outside a DOM — the one thing this layering exists to
     * avoid. The entry point owns the browser and passes it in.
     */
    readonly baseUrl: string;
    /** Absent in a test that runs outside a DOM. */
    readonly storage: Storage | null;
}

/**
 * Builds the object graph, by hand and in one place.
 *
 * No container library and no decorators: reading this function tells you the
 * whole wiring.
 *
 * @param config - The gateway origin and the storage to persist preferences in.
 * @returns Every service the tree needs.
 */
export function createServiceContainer(config: ServiceContainerConfig): ServiceContainer {
    const api = new HeatmapApiService({ baseUrl: config.baseUrl });
    const liveFeed = new LiveFeedService({ baseUrl: config.baseUrl });
    const preferences = new PreferencesService({ storage: config.storage });

    return {
        api,
        liveFeed,
        preferences,
        chart: new ChartController({ api, liveFeed, preferences }),
    };
}
