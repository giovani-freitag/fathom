import type { CollectorEvent } from '../../shared/core/collector-worker-contract.ts';
import { type CollectorLog, describeLogFields, type LogFields } from '../core/collector-log.ts';

export interface BrowserCollectorLogConfig {
    /** Sends one event to the page that owns this worker. */
    readonly post: (event: CollectorEvent) => void;
}

/**
 * Builds a log that narrates the collector to the page hosting it.
 *
 * @param config - Where events are posted.
 * @returns The log the supervisor should be given in a browser registration.
 */
export function createBrowserCollectorLog(config: BrowserCollectorLogConfig): CollectorLog {
    // Fields are folded into the sentence: the page shows a line of prose, and
    // a structured sink on the other side would have nothing to do with them.
    return build(config.post, {});
}

function build(post: (event: CollectorEvent) => void, bound: LogFields): CollectorLog {
    return {
        info: (message, fields) => {
            post({ kind: 'log', level: 'info', message: stamp(message, bound, fields) });
        },
        warning: (message, fields) => {
            post({ kind: 'log', level: 'warning', message: stamp(message, bound, fields) });
        },
        child: (fields) => build(post, { ...bound, ...fields }),
    };
}

function stamp(message: string, bound: LogFields, fields?: LogFields): string {
    return `${message}${describeLogFields({ ...bound, ...fields })}`;
}
