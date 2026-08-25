import type { CollectorLogLevel } from './collector-log-level.ts';

/** What the page asks the collector to do. */
export type CollectorCommand =
    | { readonly kind: 'start' }
    | { readonly kind: 'stop' };

/** What the collector is doing, as the page needs to describe it. */
export type CollectorState =
    | 'starting'
    | 'recording'
    | 'reconnecting'
    | 'degraded'
    | 'refused'
    | 'stopped';

/** What the collector tells the page. */
export type CollectorEvent =
    | { readonly kind: 'log'; readonly level: CollectorLogLevel; readonly message: string }
    | { readonly kind: 'state'; readonly state: CollectorState; readonly detail?: string }
    | { readonly kind: 'captured'; readonly capturedAtMs: number };
