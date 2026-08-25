import { type AppearanceHost, AppearanceController } from './appearance-controller.ts';
import { ChartController } from './chart-controller.ts';
import { HeatmapApiService } from '../services/heatmap-api-service.ts';
import type { HeatmapSource } from '../../shared/core/heatmap-source.ts';
import type { LiveFeed } from '../services/live-feed.ts';
import { LiveFeedService } from '../services/live-feed-service.ts';
import { PreferencesService } from '../services/preferences-service.ts';
import { RecordingApiService } from '../services/recording-api-service.ts';
import type { RecordingControl } from '../../shared/core/recording-control.ts';

export interface ServiceContainer {
    readonly api: HeatmapSource;
    readonly liveFeed: LiveFeed;
    readonly preferences: PreferencesService;
    readonly chart: ChartController;
    readonly appearance: AppearanceController;
    /** Absent when the page is its own collector and there is no supervisor. */
    readonly recording: RecordingControl | null;
}

export interface ServiceContainerConfig {
    /**
     * Absolute origin of the gateway, scheme included.
     */
    readonly baseUrl: string;
    /** Absent in a test that runs outside a DOM. */
    readonly storage: Storage | null;
    /** Absent in a test that runs outside a DOM. */
    readonly appearanceHost: AppearanceHost | null;
}

/**
 * Builds the object graph, by hand and in one place.
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
        recording: new RecordingApiService({ baseUrl: config.baseUrl }),
        chart: new ChartController({ api, liveFeed, preferences }),
        appearance: new AppearanceController({ preferences, host: config.appearanceHost }),
    };
}
