import type { CollectorCommand, CollectorEvent } from '../../shared/core/collector-worker-contract.ts';

/**
 * The slice of a Worker's global this collector actually uses.
 */
export interface CollectorWorkerScope {
    readonly location: { readonly search: string };
    readonly indexedDB: IDBFactory | undefined;
    readonly navigator: { readonly storage?: { estimate(): Promise<StorageEstimate> } };
    postMessage(event: CollectorEvent): void;
    addEventListener(
        type: 'message',
        listener: (event: MessageEvent<CollectorCommand>) => void,
    ): void;
}
