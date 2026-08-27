import type { CollectorCommand, CollectorEvent, CollectorState } from '../../shared/core/collector-worker-contract.ts';
import { BROWSER_WRITE_SETTINGS } from '../core/collector-configuration.ts';
import { BrowserRecordingControl } from '../../database/browser/browser-recording-control.ts';
import { createBrowserCollectorLog } from './browser-collector-log.ts';
import { CollectorSupervisor } from '../collector-supervisor.ts';
import type { CollectorWorkerScope } from './worker-scope.ts';
import { DEMO_CATALOGUE, readDemoConfiguration, resolveFrameCapacity } from './demo-collector-configuration.ts';
import { describeError } from '../core/collector-log.ts';
import { IndexedDbLiquidityArchive } from '../../database/browser/indexed-db-liquidity-archive.ts';
import { IndexedDbLiveTailSource } from '../../database/browser/indexed-db-live-tail-source.ts';
import { IndexedDbService } from '../../database/browser/indexed-db-service.ts';
import { LiveTail } from '../../shared/core/live-tail.ts';
import { NotifyingLiquidityArchive } from '../../database/services/notifying-liquidity-archive.ts';
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

/** Frames one catch-up carries, so a long stall does not arrive as one flood. */
const MAXIMUM_FRAMES_PER_CATCH_UP = 120;

/**
 * How often a tail catches up on its own.
 *
 * A backstop, not the clock: a write nudges the tail directly. This closes the
 * window when the page was throttled and missed one.
 */
const TAIL_BACKSTOP_MS = 5_000;

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
let tail: LiveTail | null = null;
let tailSymbol: string | null = null;
let tailBackstop: ReturnType<typeof setInterval> | null = null;

/**
 * Opens the archive and brings up whatever this browser chose to record.
 */
async function start(): Promise<void> {
    if (supervisor !== null) {
        return;
    }
    announce('starting');

    try {
        await bringUpRecording();
    } catch (error) {
        // Anything that escapes leaves the page on 'starting' for ever, with no
        // console the reader of a chart is going to open.
        supervisor = null;
        announce('refused', describeError(error));
    }
}

/**
 * Opens the archive and starts the supervisor over it.
 *
 * @throws Whatever storage, the venue, or the archive refused.
 */
async function bringUpRecording(): Promise<void> {
    await database.open();

    const store = new IndexedDbLiquidityArchive({
        database,
        frameCapacity: await resolveFrameCapacity(scope.navigator),
    });
    // The write side is wrapped so a landed write can tell the tail to catch
    // up. It is the same signal the gateway gets from the database; here the
    // writer and the reader are one worker, so it is a call rather than a wire.
    const archive = new NotifyingLiquidityArchive({ archive: store, onWritten: handleArchiveWritten });
    const control = new BrowserRecordingControl({
        // The concrete store: pruning is its own operation, not one a writer
        // announces, and the wrapper deliberately carries only the write side.
        archive: store,
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

    await supervisor.start();
    announce('recording');
}

async function stop(): Promise<void> {
    unsubscribe();
    try {
        await supervisor?.stop();
    } catch (error) {
        // Reported and then let go of: a collector left in place because its own
        // shutdown failed can never be started again.
        post({ kind: 'log', level: 'warning', message: `Could not stop cleanly: ${describeError(error)}` });
    }
    supervisor = null;
    announce('stopped');
}

/**
 * Follows one contract for the page, from the instant it already holds.
 */
function subscribe(instrumentSymbol: string, afterMs: number): void {
    unsubscribe();
    tailSymbol = instrumentSymbol;
    tail = new LiveTail({
        source: new IndexedDbLiveTailSource({ database }),
        instrumentSymbol,
        afterMs,
        maxFramesPerPoll: MAXIMUM_FRAMES_PER_CATCH_UP,
        deliver: (message) => { post({ kind: 'live', message }); },
    });

    tail.announce(priceBucketSizeOf(instrumentSymbol));
    void tail.advance();
    tailBackstop = setInterval(() => { void tail?.advance(); }, TAIL_BACKSTOP_MS);
}

function unsubscribe(): void {
    tail?.stop();
    tail = null;
    tailSymbol = null;
    if (tailBackstop !== null) {
        clearInterval(tailBackstop);
        tailBackstop = null;
    }
}

/**
 * Catches the tail up when the contract it follows has just grown.
 */
function handleArchiveWritten(writtenSymbol: string): void {
    if (writtenSymbol === tailSymbol) {
        void tail?.advance();
    }
}

/** The grid a contract records on, from the catalogue the worker was given. */
function priceBucketSizeOf(symbol: string): number {
    const offered = withRequested(instrumentSymbol, priceBucketSize, frameIntervalMs)
        .find((contract) => contract.instrumentSymbol === symbol);
    return offered?.priceBucketSize ?? priceBucketSize;
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
    const command = event.data;
    if (command.kind === 'start') {
        void start();
        return;
    }
    if (command.kind === 'subscribe') {
        subscribe(command.instrumentSymbol, command.afterMs);
        return;
    }
    if (command.kind === 'unsubscribe') {
        unsubscribe();
        return;
    }
    void stop();
});
