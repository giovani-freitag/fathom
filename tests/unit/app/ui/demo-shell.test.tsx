import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { CollectorEvent } from '../../../../src/shared/core/collector-worker-contract.ts';
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
    lastMidPrice: 79_000,
};

const APPEARANCE = { locale: 'en', themeChoice: 'system', resolvedTheme: 'dark' } as const;

const NOTHING_YET: InstrumentCoverage = { ...RECORDED, firstFrameAtMs: null, lastFrameAtMs: null };

describe('DemoShell', () => {
    let openDatabase: ReturnType<typeof vi.fn>;
    let fetchInstruments: ReturnType<typeof vi.fn>;
    /** Reports what the collector is doing, the way the worker does. */
    let report: (event: CollectorEvent) => void;

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
                build={(config) => {
                    report = config.onCollectorEvent;
                    return container;
                }}
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

    /** Brings the shell to the chart, which is where the notice can appear. */
    async function showChart(): Promise<void> {
        renderShell();
        fetchInstruments.mockResolvedValue([RECORDED]);
        await vi.advanceTimersByTimeAsync(2_000);
        await vi.waitFor(() => { expect(screen.queryByTestId('chart')).not.toBeNull(); });
        // Recording rather than starting: what the collector is doing is its own
        // state and holds the strip, and this notice is about something else.
        await act(async () => {
            report({ kind: 'state', state: 'recording' });
            await Promise.resolve();
        });
    }

    /** What a browser does to a tab the reader has moved away from. */
    async function goToAnotherTab(): Promise<void> {
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'));
            await Promise.resolve();
        });
    }

    it('says why the gaps are there when the reader comes back', async () => {
        await showChart();

        await goToAnotherTab();

        expect(screen.getByText(/was in the background/)).toBeTruthy();
    });

    it('lets go of it on its own, because it explains a moment already passed', async () => {
        // Left up, it is a strip across the chart for the rest of the session.
        await showChart();
        await goToAnotherTab();

        await act(async () => { await vi.advanceTimersByTimeAsync(13_000); });

        expect(screen.queryByText(/was in the background/)).toBeNull();
    });

    it('closes when the reader closes it', async () => {
        await showChart();
        await goToAnotherTab();

        await act(async () => {
            screen.getByRole('button', { name: 'Dismiss' }).click();
            await Promise.resolve();
        });

        expect(screen.queryByText(/was in the background/)).toBeNull();
    });

    it('does not say it again once the reader has closed it', async () => {
        // Someone working across tabs would otherwise be told the same thing
        // every time they came back.
        await showChart();
        await goToAnotherTab();
        await act(async () => {
            screen.getByRole('button', { name: 'Dismiss' }).click();
            await Promise.resolve();
        });

        await goToAnotherTab();

        expect(screen.queryByText(/was in the background/)).toBeNull();
    });
});
