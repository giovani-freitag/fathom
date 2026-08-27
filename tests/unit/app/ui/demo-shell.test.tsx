import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DemoServiceContainer } from '../../../../src/app/core/demo-service-container.ts';
import { DemoShell } from '../../../../src/app/ui/demo-shell.tsx';
import type { InstrumentCoverage } from '../../../../src/shared/core/api-contract.ts';

vi.mock('../../../../src/app/app.tsx', () => ({
    // The chart draws to a canvas jsdom has no context for; what this shell
    // decides is whether to mount it at all, so a marker is enough.
    App: () => <div data-testid="chart" />,
}));

const RECORDED: InstrumentCoverage = {
    instrumentSymbol: 'BTCUSDT', priceBucketSize: 10, frameIntervalMs: 1_000,
    firstFrameAtMs: 1_000, lastFrameAtMs: 2_000,
};

const APPEARANCE = { locale: 'en', themeChoice: 'system', resolvedTheme: 'dark' } as const;

const NOTHING_YET: InstrumentCoverage = { ...RECORDED, firstFrameAtMs: null, lastFrameAtMs: null };

describe('DemoShell', () => {
    let openDatabase: ReturnType<typeof vi.fn>;
    let fetchInstruments: ReturnType<typeof vi.fn>;

    function renderShell(): void {
        const container = {
            database: { open: openDatabase, close: vi.fn() },
            collector: { start: vi.fn(), stop: vi.fn() },
            chart: { dispose: vi.fn() },
            api: { fetchInstruments },
            appearance: {
                // One object, handed back every read: `useSyncExternalStore`
                // compares snapshots by identity, and a fresh one per call is
                // an endless change it re-renders to keep up with.
                store: { read: () => APPEARANCE, subscribe: () => () => undefined },
                start: vi.fn(),
                dispose: vi.fn(),
            },
        } as unknown as DemoServiceContainer;

        render(
            <DemoShell
                factory={null}
                storage={null}
                appearanceHost={null}
                build={() => container}
            />,
        );
    }

    beforeEach(() => {
        vi.useFakeTimers();
        openDatabase = vi.fn().mockResolvedValue(undefined);
        fetchInstruments = vi.fn().mockResolvedValue([NOTHING_YET]);
    });

    it('holds the chart back until a second exists for it to draw', async () => {
        // The chart decides there is nothing to show the first time it looks,
        // and a page that starts its own recording is empty at that moment.
        renderShell();

        await vi.advanceTimersByTimeAsync(3_000);

        expect(screen.queryByTestId('chart')).toBeNull();
        expect(screen.getByText('Recording starts now')).toBeTruthy();
    });

    it('mounts the chart once the first frame has been recorded', async () => {
        renderShell();
        fetchInstruments.mockResolvedValue([RECORDED]);

        await vi.advanceTimersByTimeAsync(2_000);

        // Waited for rather than asserted straight after the tick: advancing a
        // timer starts the read, and the answer lands a promise later.
        await vi.waitFor(() => { expect(screen.queryByTestId('chart')).not.toBeNull(); });
    });

    it('explains itself when the browser will not let the page record', async () => {
        openDatabase.mockRejectedValue(new Error('This browser exposes no IndexedDB'));

        renderShell();
        await vi.advanceTimersByTimeAsync(0);

        expect(screen.getByText('This browser will not let the demo record')).toBeTruthy();
        // The driver's own sentence goes to the console, not to the reader.
        expect(screen.queryByText(/exposes no IndexedDB/)).toBeNull();
    });
});
