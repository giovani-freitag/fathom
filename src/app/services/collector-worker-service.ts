import type { CollectorCommand, CollectorEvent } from '../../shared/core/collector-worker-contract.ts';

/** How long the collector is given to write out what it buffered. */
const STOP_GRACE_MS = 2_000;

export interface CollectorWorkerServiceConfig {
    readonly onEvent: (event: CollectorEvent) => void;
}

/**
 * The page's handle on the collector running beside it.
 */
export class CollectorWorkerService {
    private readonly config: CollectorWorkerServiceConfig;
    private worker: Worker | null = null;
    private stoppingWorker: Worker | null = null;
    private stopGraceTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(config: CollectorWorkerServiceConfig) {
        this.config = config;
        this.handleWorkerMessage = this.handleWorkerMessage.bind(this);
        this.handleStoppingWorkerMessage = this.handleStoppingWorkerMessage.bind(this);
        this.handleStopGraceElapsed = this.handleStopGraceElapsed.bind(this);
    }

    /**
     * Registers the collector and asks it to begin.
     */
    start(): void {
        if (this.worker !== null) {
            return;
        }
        this.worker = new Worker(
            new URL('../../workers/browser/collector-worker.ts', import.meta.url),
            { type: 'module' },
        );
        this.worker.addEventListener('message', this.handleWorkerMessage);
        this.send({ kind: 'start' });
    }

    /**
     * Asks the collector to stop, then tears the registration down.
     */
    stop(): void {
        const worker = this.worker;
        if (worker === null) {
            return;
        }
        this.send({ kind: 'stop' });
        this.worker = null;
        worker.removeEventListener('message', this.handleWorkerMessage);

        // Terminated the moment it is told to stop, the collector dies part-way
        // through its last write, and the archive is the only copy those frames
        // ever had.
        this.releaseStoppingWorker();
        this.stoppingWorker = worker;
        worker.addEventListener('message', this.handleStoppingWorkerMessage);
        this.stopGraceTimer = setTimeout(this.handleStopGraceElapsed, STOP_GRACE_MS);
    }

    /**
     * Asks the collector to follow one contract for this page.
     *
     * @param instrumentSymbol - Which contract.
     * @param afterMs - Newest instant the page already holds.
     */
    subscribe(instrumentSymbol: string, afterMs: number): void {
        this.send({ kind: 'subscribe', instrumentSymbol, afterMs });
    }

    /**
     * Asks the collector to stop following. Safe in any state.
     */
    unsubscribe(): void {
        this.send({ kind: 'unsubscribe' });
    }

    private send(command: CollectorCommand): void {
        this.worker?.postMessage(command);
    }

    private handleWorkerMessage(event: MessageEvent<CollectorEvent>): void {
        this.config.onEvent(event.data);
    }

    private handleStoppingWorkerMessage(event: MessageEvent<CollectorEvent>): void {
        const reported = event.data;
        if (reported.kind === 'state' && reported.state === 'stopped') {
            this.releaseStoppingWorker();
        }
    }

    private handleStopGraceElapsed(): void {
        this.releaseStoppingWorker();
    }

    /**
     * Lets go of a collector that finished stopping, or ran out of time to.
     */
    private releaseStoppingWorker(): void {
        if (this.stopGraceTimer !== null) {
            clearTimeout(this.stopGraceTimer);
            this.stopGraceTimer = null;
        }

        const worker = this.stoppingWorker;
        this.stoppingWorker = null;
        if (worker === null) {
            return;
        }
        worker.removeEventListener('message', this.handleStoppingWorkerMessage);
        worker.terminate();
    }
}
