import type { CollectorCommand, CollectorEvent } from '../../shared/core/collector-worker-contract.ts';

export interface CollectorWorkerServiceConfig {
    readonly onEvent: (event: CollectorEvent) => void;
}

/**
 * The page's handle on the collector running beside it.
 */
export class CollectorWorkerService {
    private readonly config: CollectorWorkerServiceConfig;
    private worker: Worker | null = null;

    constructor(config: CollectorWorkerServiceConfig) {
        this.config = config;
        this.handleWorkerMessage = this.handleWorkerMessage.bind(this);
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
        worker.removeEventListener('message', this.handleWorkerMessage);
        worker.terminate();
        this.worker = null;
    }

    private send(command: CollectorCommand): void {
        this.worker?.postMessage(command);
    }

    private handleWorkerMessage(event: MessageEvent<CollectorEvent>): void {
        this.config.onEvent(event.data);
    }
}
