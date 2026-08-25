import { ArchiveLiveFeedService } from '../services/archive-live-feed-service.ts';
import { ChartController } from './chart-controller.ts';
import type { CollectorEvent } from '../../shared/core/collector-worker-contract.ts';
import { CollectorWorkerService } from '../services/collector-worker-service.ts';
import { IndexedDbHeatmapSource } from '../../database/browser/indexed-db-heatmap-source.ts';
import { IndexedDbService } from '../../database/browser/indexed-db-service.ts';
import { PreferencesService } from '../services/preferences-service.ts';
import type { ServiceContainer } from './service-container.ts';

/** A visitor should see something moving quickly, so the first window is short. */
const DEMO_VISIBLE_SPAN_MS = 5 * 60 * 1_000;

export interface DemoServiceContainerConfig {
    /** Absent outside a browser, which is how a test builds this. */
    readonly factory: IDBFactory | null;
    readonly storage: Storage | null;
    readonly onCollectorEvent: (event: CollectorEvent) => void;
}

export interface DemoServiceContainer extends ServiceContainer {
    readonly collector: CollectorWorkerService;
    /**
     * The page's own connection to the archive.
     *
     * Separate from the collector's on purpose: a Worker and its page cannot
     * share one, and each side owning its connection is what lets either be
     * torn down without the other noticing.
     */
    readonly database: IndexedDbService;
}

/**
 * The second registration: the page is its own collector and its own archive.
 *
 * The same `ChartController` and the same painters as the served version. What
 * changes is only where history comes from and how the tail arrives — which is
 * the whole reason those two are ports.
 *
 * @param config - The browser's storage and where collector events go.
 * @returns Every service the tree needs, plus the collector's handle.
 */
export function createDemoServiceContainer(
    config: DemoServiceContainerConfig,
): DemoServiceContainer {
    const database = new IndexedDbService({ factory: config.factory });
    const api = new IndexedDbHeatmapSource({ database });
    const liveFeed = new ArchiveLiveFeedService({ source: api });
    const preferences = new PreferencesService({ storage: config.storage });
    const collector = new CollectorWorkerService({ onEvent: config.onCollectorEvent });

    return {
        api,
        liveFeed,
        preferences,
        collector,
        database,
        chart: new ChartController({ api, liveFeed, preferences }),
    };
}

export { DEMO_VISIBLE_SPAN_MS };
