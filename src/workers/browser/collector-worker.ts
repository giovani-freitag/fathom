import type { CollectorCommand, CollectorEvent, CollectorState } from '../../shared/core/collector-worker-contract.ts';
import type { CollectorWorkerScope } from './worker-scope.ts';
import { BROWSER_WRITE_SETTINGS } from '../core/collector-configuration.ts';
import { CollectorRuntime } from '../collector-runtime.ts';
import { describeError } from '../core/collector-log.ts';
import { IndexedDbLiquidityArchive } from '../../database/browser/indexed-db-liquidity-archive.ts';
import { IndexedDbService } from '../../database/browser/indexed-db-service.ts';
import { openBrowserMarketDataSocket } from './browser-market-data-socket.ts';
import { readDemoConfiguration, resolveFrameCapacity } from './demo-collector-configuration.ts';

/** How often the archive is trimmed back to the window it may keep. */
const PRUNE_INTERVAL_MS = 60_000;

const scope = self as unknown as CollectorWorkerScope;

function post(event: CollectorEvent): void {
    scope.postMessage(event);
}

function announce(state: CollectorState, detail?: string): void {
    post(detail === undefined ? { kind: 'state', state } : { kind: 'state', state, detail });
}

const configuration = readDemoConfiguration(scope.location.search);
const database = new IndexedDbService({ factory: scope.indexedDB ?? null });

let runtime: CollectorRuntime | null = null;
let pruneTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Opens the archive and begins recording.
 *
 * Failure here is reported as a state rather than thrown: nothing supervises a
 * Worker the way systemd supervises the collector process, so the page has to
 * be told why it will see no data instead of being left with a silent tab.
 */
async function start(): Promise<void> {
    if (runtime !== null) {
        return;
    }
    announce('starting');

    try {
        await database.open();
    } catch (error) {
        announce('refused', describeError(error));
        return;
    }

    const capacity = await resolveFrameCapacity(scope.navigator);
    const archive = new IndexedDbLiquidityArchive({ database, frameCapacity: capacity });

    runtime = new CollectorRuntime({
        configuration,
        openSocket: openBrowserMarketDataSocket,
        archive,
        framesPerFlush: BROWSER_WRITE_SETTINGS.framesPerFlush,
        log: {
            info: (message) => { post({ kind: 'log', level: 'info', message }); },
            warning: (message) => { post({ kind: 'log', level: 'warning', message }); },
        },
    });

    try {
        await runtime.start();
    } catch (error) {
        runtime = null;
        announce('refused', describeError(error));
        return;
    }

    pruneTimer = setInterval(() => {
        void archive.pruneToCapacity(configuration.instrumentSymbol);
    }, PRUNE_INTERVAL_MS);
    announce('recording');
}

async function stop(): Promise<void> {
    if (pruneTimer !== null) {
        clearInterval(pruneTimer);
        pruneTimer = null;
    }
    await runtime?.stop();
    runtime = null;
    announce('stopped');
}

scope.addEventListener('message', (event: MessageEvent<CollectorCommand>) => {
    if (event.data.kind === 'start') {
        void start();
        return;
    }
    void stop();
});
