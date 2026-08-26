import type { CollectorCommand, CollectorEvent, CollectorState } from '../../shared/core/collector-worker-contract.ts';
import { BROWSER_WRITE_SETTINGS } from '../core/collector-configuration.ts';
import { BrowserRecordingControl } from '../../database/browser/browser-recording-control.ts';
import { createBrowserCollectorLog } from './browser-collector-log.ts';
import { CollectorSupervisor } from '../collector-supervisor.ts';
import type { CollectorWorkerScope } from './worker-scope.ts';
import { DEMO_CATALOGUE, readDemoConfiguration, resolveFrameCapacity } from './demo-collector-configuration.ts';
import { describeError } from '../core/collector-log.ts';
import { IndexedDbLiquidityArchive } from '../../database/browser/indexed-db-liquidity-archive.ts';
import { IndexedDbService } from '../../database/browser/indexed-db-service.ts';
import { openBrowserMarketDataSocket } from './browser-market-data-socket.ts';

/**
 * How often the chosen contracts and the ceiling are re-read.
 */
const RECONCILE_INTERVAL_MS = 3_000;

/**
 * Silence after which a collector is replaced.
 *
 * Shorter than the server's: a page is watched while it records, so a stall
 * that the reader can see should not outlive their patience.
 */
const STALL_TIMEOUT_MS = 45_000;

const scope = self as unknown as CollectorWorkerScope;

function post(event: CollectorEvent): void {
    scope.postMessage(event);
}

function announce(state: CollectorState, detail?: string): void {
    post(detail === undefined ? { kind: 'state', state } : { kind: 'state', state, detail });
}

const { instrumentSymbol, priceBucketSize, frameIntervalMs, ...shared } =
    readDemoConfiguration(scope.location.search);
const database = new IndexedDbService({ factory: scope.indexedDB ?? null });

let supervisor: CollectorSupervisor | null = null;

/**
 * Opens the archive and brings up whatever this browser chose to record.
 */
async function start(): Promise<void> {
    if (supervisor !== null) {
        return;
    }
    announce('starting');

    try {
        await database.open();
    } catch (error) {
        announce('refused', describeError(error));
        return;
    }

    const archive = new IndexedDbLiquidityArchive({
        database,
        frameCapacity: await resolveFrameCapacity(scope.navigator),
    });
    const control = new BrowserRecordingControl({
        archive,
        database,
        estimateStorage: () => scope.navigator.storage?.estimate() ?? Promise.resolve({}),
        // A link may name a contract the catalogue does not, so it is offered too.
        catalogue: withRequested(instrumentSymbol, priceBucketSize, frameIntervalMs),
    });

    supervisor = new CollectorSupervisor({
        control,
        archive,
        openSocket: openBrowserMarketDataSocket,
        log: createBrowserCollectorLog({ post }),
        shared,
        framesPerFlush: BROWSER_WRITE_SETTINGS.framesPerFlush,
        reconcileIntervalMs: RECONCILE_INTERVAL_MS,
        stallTimeoutMs: STALL_TIMEOUT_MS,
        readNowMs: () => Date.now(),
    });

    try {
        await supervisor.start();
    } catch (error) {
        supervisor = null;
        announce('refused', describeError(error));
        return;
    }
    announce('recording');
}

async function stop(): Promise<void> {
    await supervisor?.stop();
    supervisor = null;
    announce('stopped');
}

/** The catalogue, with a link-requested contract added if it is not already in it. */
function withRequested(symbol: string, priceBucketSize: number, frameIntervalMs: number) {
    const catalogue = DEMO_CATALOGUE.map((contract) => ({
        ...contract,
        isEnabled: contract.instrumentSymbol === symbol ? true : contract.isEnabled,
    }));

    return catalogue.some((contract) => contract.instrumentSymbol === symbol)
        ? catalogue
        : [{ instrumentSymbol: symbol, priceBucketSize, frameIntervalMs, isEnabled: true }, ...catalogue];
}

scope.addEventListener('message', (event: MessageEvent<CollectorCommand>) => {
    if (event.data.kind === 'start') {
        void start();
        return;
    }
    void stop();
});
