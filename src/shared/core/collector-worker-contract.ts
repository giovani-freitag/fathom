import type { CollectorLogLevel } from './collector-log-level.ts';
import type { LiveMessage } from './live-message.ts';

/** What the page asks the collector to do. */
export type CollectorCommand =
    | { readonly kind: 'start' }
    | { readonly kind: 'stop' }
    | {
        readonly kind: 'subscribe';
        readonly instrumentSymbol: string;
        /** Newest instant the page already holds. */
        readonly afterMs: number;
    }
    | { readonly kind: 'unsubscribe' };

/** What the collector is doing, as the page needs to describe it. */
export type CollectorState =
    | 'starting'
    | 'recording'
    | 'reconnecting'
    | 'degraded'
    | 'refused'
    | 'stopped';

/**
 * What the collector tells the page.
 *
 * The `live` envelope carries exactly what a gateway sends over its socket, so
 * the page reads one type whichever half of the product it is talking to.
 */
export type CollectorEvent =
    | { readonly kind: 'log'; readonly level: CollectorLogLevel; readonly message: string }
    | { readonly kind: 'state'; readonly state: CollectorState; readonly detail?: string }
    | { readonly kind: 'live'; readonly message: LiveMessage };
