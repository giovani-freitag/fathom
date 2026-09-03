import { type AppearanceHost, AppearanceController } from './appearance-controller.ts';
import { ChartController } from './chart-controller.ts';
import { DrawingsController } from '../drawings/drawings-controller.ts';
import { type CursorReadout, createCursorStore } from './cursor-store.ts';
import type { ObservableStore } from './observable-store.ts';
import { HeatmapApiService } from '../services/heatmap-api-service.ts';
import { wrapWithVenueCandles } from './venue-candles.ts';
import type { HeatmapSource } from '../../shared/core/heatmap-source.ts';
import type { LiveFeed } from '../services/live-feed.ts';
import { LiveFeedService } from '../services/live-feed-service.ts';
import { AddonLibraryService } from '../services/addon-library/addon-library-service.ts';
import { buildAddon } from '../addons/addon-runtime.ts';
import { PreferencesService } from '../services/preferences-service.ts';
import { registerAddon } from '../addons/addon-registry.ts';
import { RecordingApiService } from '../services/recording-api-service.ts';
import type { RecordingControl } from '../../shared/core/recording-control.ts';

export interface ServiceContainer {
    readonly api: HeatmapSource;
    readonly liveFeed: LiveFeed;
    readonly preferences: PreferencesService;
    readonly chart: ChartController;
    /** The marks the reader leaves on the chart. */
    readonly drawings: DrawingsController;
    readonly appearance: AppearanceController;
    /** Where the pointer is, for the parts that show a reading under it. */
    readonly cursor: ObservableStore<CursorReadout>;
    /** Absent when the page is its own collector and there is no supervisor. */
    readonly recording: RecordingControl | null;
    /** The readings the reader wrote themselves. */
    readonly addons: AddonLibraryService;
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
    const api = wrapWithVenueCandles(new HeatmapApiService({ baseUrl: config.baseUrl }));
    const cursor = createCursorStore();
    const liveFeed = new LiveFeedService({ baseUrl: config.baseUrl });
    const preferences = new PreferencesService({ storage: config.storage });
    const addons = new AddonLibraryService({
        storage: config.storage ?? { getItem: () => null, setItem: () => undefined },
        now: () => Date.now(),
    });
    // Before the chart, because a stored selection names a reading by its id
    // and the chart resolves those the moment its preferences are read.
    restoreSavedReadings(addons);
    const chart = new ChartController({ api, liveFeed, preferences });

    return {
        api,
        liveFeed,
        preferences,
        chart,
        recording: new RecordingApiService({ baseUrl: config.baseUrl }),
        drawings: new DrawingsController({
            preferences,
            readInstrumentSymbol: () => chart.store.read().instrumentSymbol,
            newId: () => crypto.randomUUID(),
        }),
        appearance: new AppearanceController({ preferences, host: config.appearanceHost }),
        cursor,
        addons,
    };
}

/**
 * Puts every saved reading back where the chart can find it.
 *
 * From the compiled form rather than the source, so opening the page costs
 * nothing until somebody actually writes something. One that no longer builds
 * is left off rather than allowed to fail later: what it names on the chart
 * then resolves to nothing, which is what a removed reading already does.
 */
function restoreSavedReadings(library: AddonLibraryService): void {
    for (const saved of library.list()) {
        const built = buildAddon(saved.compiled);
        if (built.kind === 'ready') {
            registerAddon(saved.key, built.indicator);
        }
    }
}
