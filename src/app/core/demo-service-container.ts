import { type AppearanceHost, AppearanceController } from './appearance-controller.ts';
import { ChartController } from './chart-controller.ts';
import { DrawingsController } from '../drawings/drawings-controller.ts';
import { createCursorStore } from './cursor-store.ts';
import type { CollectorEvent } from '../../shared/core/collector-worker-contract.ts';
import { CollectorWorkerService } from '../services/collector-worker-service.ts';
import { IndexedDbHeatmapSource } from '../../database/browser/indexed-db-heatmap-source.ts';
import { wrapWithVenueCandles } from './venue-candles.ts';
import { BrowserRecordingControl } from '../../database/browser/browser-recording-control.ts';
import { DEMO_CATALOGUE } from '../../workers/browser/demo-collector-configuration.ts';
import { IndexedDbLiquidityArchive } from '../../database/browser/indexed-db-liquidity-archive.ts';
import { IndexedDbService } from '../../database/browser/indexed-db-service.ts';
import { PreferencesService } from '../services/preferences-service.ts';
import { WorkerLiveFeedService } from '../services/worker-live-feed-service.ts';
import type { ServiceContainer } from './service-container.ts';

/** A visitor should see something moving quickly, so the first window is short. */
const DEMO_VISIBLE_SPAN_MS = 5 * 60 * 1_000;

export interface DemoServiceContainerConfig {
    /** Absent outside a browser, which is how a test builds this. */
    readonly factory: IDBFactory | null;
    readonly storage: Storage | null;
    /** Absent in a test that runs outside a DOM. */
    readonly appearanceHost: AppearanceHost | null;
    readonly onCollectorEvent: (event: CollectorEvent) => void;
}

export interface DemoServiceContainer extends ServiceContainer {
    readonly collector: CollectorWorkerService;
    /**
     * The page's own connection to the archive.
     */
    readonly database: IndexedDbService;
}

/**
 * The second registration: the page is its own collector and its own archive.
 *
 * @param config - The browser's storage and where collector events go.
 * @returns Every service the tree needs, plus the collector's handle.
 */
export function createDemoServiceContainer(
    config: DemoServiceContainerConfig,
): DemoServiceContainer {
    const database = new IndexedDbService({ factory: config.factory });
    const api = wrapWithVenueCandles(new IndexedDbHeatmapSource({ database }));
    const cursor = createCursorStore();
    const preferences = new PreferencesService({ storage: config.storage });

    // The tail runs inside the collector, so the page asks it to follow a
    // contract and then only listens — the same shape as the socket driver,
    // where the tail runs inside the gateway.
    const liveFeed = new WorkerLiveFeedService({
        subscribe: (instrumentSymbol, afterMs) => {
            collector.subscribe(instrumentSymbol, afterMs);
        },
        unsubscribe: () => { collector.unsubscribe(); },
    });
    const collector = new CollectorWorkerService({
        onEvent: (event) => {
            liveFeed.handleCollectorEvent(event);
            config.onCollectorEvent(event);
        },
    });

    // The page's own view of the same choice the worker reads: both go through
    // the store, because a Worker cannot see local storage and a page cannot
    // reach into a Worker's memory.
    const recording = new BrowserRecordingControl({
        archive: new IndexedDbLiquidityArchive({ database, frameCapacity: 1 }),
        database,
        estimateStorage: () => navigator.storage.estimate(),
        catalogue: DEMO_CATALOGUE,
    });

    const chart = new ChartController({ api, liveFeed, preferences });

    return {
        api,
        liveFeed,
        preferences,
        collector,
        database,
        recording,
        chart,
        cursor,
        drawings: new DrawingsController({
            preferences,
            readInstrumentSymbol: () => chart.store.read().instrumentSymbol,
            newId: () => crypto.randomUUID(),
        }),
        appearance: new AppearanceController({ preferences, host: config.appearanceHost }),
    };
}

export { DEMO_VISIBLE_SPAN_MS };
