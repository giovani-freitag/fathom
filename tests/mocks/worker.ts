import { vi } from 'vitest';
import type { CollectorCommand, CollectorEvent } from '../../src/shared/core/collector-worker-contract.ts';

/** A worker that keeps what it was told and can answer back. */
export class FakeWorker implements Partial<Worker> {
    static readonly built: FakeWorker[] = [];

    readonly commands: CollectorCommand[] = [];
    readonly terminate = vi.fn();

    private readonly listeners = new Map<string, Set<EventListener>>();

    constructor() {
        FakeWorker.built.push(this);
    }

    postMessage(command: CollectorCommand): void {
        this.commands.push(command);
    }

    addEventListener(type: string, listener: EventListener): void {
        const forType = this.listeners.get(type) ?? new Set<EventListener>();
        forType.add(listener);
        this.listeners.set(type, forType);
    }

    removeEventListener(type: string, listener: EventListener): void {
        this.listeners.get(type)?.delete(listener);
    }

    /**
     * Says something back to the page, as the collector would.
     *
     * @param event - What the collector is reporting.
     */
    say(event: CollectorEvent): void {
        const message = { data: event } as unknown as Event;
        for (const listener of this.listeners.get('message') ?? []) {
            listener(message);
        }
    }

    /** How many listeners of a kind are still attached. */
    countListeners(type: string): number {
        return this.listeners.get(type)?.size ?? 0;
    }
}

/** The most recent worker the page built. */
export function readLastWorker(): FakeWorker {
    const worker = FakeWorker.built.at(-1);
    if (worker === undefined) {
        throw new Error('No worker was built');
    }
    return worker;
}

/** Puts a fake worker behind `new Worker(...)` and forgets earlier ones. */
export function stubWorkerConstructor(): void {
    FakeWorker.built.length = 0;
    vi.stubGlobal('Worker', FakeWorker);
}
