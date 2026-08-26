import { createBrowserCollectorLog } from '../../../src/workers/browser/browser-collector-log.ts';
import type { CollectorEvent } from '../../../src/shared/core/collector-worker-contract.ts';
import { describe, expect, it } from 'vitest';
import { describeLogFields, formatLogLine } from '../../../src/workers/core/collector-log.ts';

describe('describeLogFields', () => {
    it('says nothing when a line carries nothing', () => {
        expect(describeLogFields()).toBe('');
        expect(describeLogFields({})).toBe('');
    });

    it('renders each field as a name and a value', () => {
        expect(describeLogFields({ instrumentSymbol: 'ETHUSDT', silentForMs: 121_000 }))
            .toBe(' instrumentSymbol=ETHUSDT silentForMs=121000');
    });
});

describe('formatLogLine', () => {
    it('marks which stream a line belongs to', () => {
        expect(formatLogLine('warning', 'Market data stream lost')).toContain('WARN');
        expect(formatLogLine('info', 'Recording')).toContain('INFO');
    });

    it('carries the fields after the message', () => {
        expect(formatLogLine('info', 'Recording', { instrumentSymbol: 'BTCUSDT' }))
            .toMatch(/Recording instrumentSymbol=BTCUSDT$/);
    });
});

describe('createBrowserCollectorLog', () => {
    function collect(): { readonly events: CollectorEvent[]; readonly post: (event: CollectorEvent) => void } {
        const events: CollectorEvent[] = [];
        return { events, post: (event) => { events.push(event); } };
    }

    it('posts what it was told, at the level it was told', () => {
        const sink = collect();

        createBrowserCollectorLog({ post: sink.post }).warning('Order book desynchronized');

        expect(sink.events).toEqual([
            { kind: 'log', level: 'warning', message: 'Order book desynchronized' },
        ]);
    });

    it('folds a bound field into every line, because the page holds only a sentence', () => {
        const sink = collect();
        const log = createBrowserCollectorLog({ post: sink.post })
            .child({ instrumentSymbol: 'ETHUSDT' });

        log.info('Recording', { frameIntervalMs: 1_000 });

        expect(sink.events[0]).toMatchObject({
            message: 'Recording instrumentSymbol=ETHUSDT frameIntervalMs=1000',
        });
    });

    it('keeps the fields of the log a child was made from', () => {
        const sink = collect();
        const log = createBrowserCollectorLog({ post: sink.post })
            .child({ instrumentSymbol: 'LTCUSDT' })
            .child({ attempt: 2 });

        log.warning('Retrying');

        expect(sink.events[0]).toMatchObject({
            message: 'Retrying instrumentSymbol=LTCUSDT attempt=2',
        });
    });
});
