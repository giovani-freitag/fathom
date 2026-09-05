import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createIndicatorKernel, renderWithKernel } from '../../../../mocks/indicator-kernel.tsx';
import { FIRST_VENUE } from '../../../../../src/shared/core/recording-control.ts';
import type { RecordedContract, RecordingControl, StorageBudget } from '../../../../../src/shared/core/recording-control.ts';
import { buildTranslate } from '../../../../../src/app/i18n/translator.ts';
import { RecordingPanel } from '../../../../../src/app/indicators/book/recording-panel.tsx';

const CONTRACTS: RecordedContract[] = [
    { venue: FIRST_VENUE, instrumentSymbol: 'BTCUSDT', priceBucketSize: 10, frameIntervalMs: 1_000, isEnabled: true },
    { venue: FIRST_VENUE, instrumentSymbol: 'ETHUSDT', priceBucketSize: 0.5, frameIntervalMs: 1_000, isEnabled: false },
];

describe('RecordingPanel', () => {
    let budget: StorageBudget;
    let saveContract: Mock<(contract: RecordedContract) => Promise<void>>;
    let setBudget: Mock<(maximumBytes: number) => Promise<void>>;
    let onContractsChanged: Mock<() => void>;

    function renderPanel(): void {
        const recording = {
            listContracts: () => Promise.resolve(CONTRACTS),
            readBudget: () => Promise.resolve(budget),
            saveContract,
            setBudget,
            pruneToBudget: vi.fn().mockResolvedValue(0),
        } as unknown as RecordingControl;

        render(
            <RecordingPanel
                recording={recording}
                onContractsChanged={onContractsChanged}
                translate={buildTranslate('en')}
            />,
        );
    }

    beforeEach(() => {
        saveContract = vi.fn<(contract: RecordedContract) => Promise<void>>()
            .mockResolvedValue(undefined);
        onContractsChanged = vi.fn<() => void>();
        setBudget = vi.fn<(maximumBytes: number) => Promise<void>>().mockResolvedValue(undefined);
        budget = { maximumBytes: 10_737_418_240, usedBytes: 1_073_741_824, availableBytes: null };
    });

    it('shows each contract with the switch in the state it is stored in', async () => {
        renderPanel();

        const btc = await screen.findByRole('switch', { name: 'Record BTCUSDT' });
        expect(btc.getAttribute('data-state')).toBe('checked');
        expect(screen.getByRole('switch', { name: 'Record ETHUSDT' }).getAttribute('data-state'))
            .toBe('unchecked');
    });

    it('saves a contract that is switched on and says the listing moved', async () => {
        // The picker upstream reads that listing, so it has to be told: a
        // contract only reaches the registry once its collector has started.
        renderPanel();

        fireEvent.click(await screen.findByRole('switch', { name: 'Record ETHUSDT' }));

        await waitFor(() => {
            expect(saveContract).toHaveBeenCalledWith(expect.objectContaining({
                instrumentSymbol: 'ETHUSDT', isEnabled: true,
            }));
        });
        await waitFor(() => { expect(onContractsChanged).toHaveBeenCalled(); });
    });

    it('offers fixed ceilings when the host will not say how much room there is', async () => {
        renderPanel();

        const ceiling = await screen.findByRole('slider', { name: 'Storage ceiling' });
        expect(ceiling.getAttribute('aria-valuemax')).toBe('4');
        expect(screen.getByText('10 GB')).toBeTruthy();
    });

    it('offers shares of the quota when the host does name one', async () => {
        budget = { maximumBytes: 1_000_000_000, usedBytes: 0, availableBytes: 4_000_000_000 };

        renderPanel();

        // A quarter of four gigabytes, in gibibytes: the ceilings on offer are
        // shares of what the host allows, not the fixed list it falls back to.
        const ceiling = await screen.findByRole('slider', { name: 'Storage ceiling' });
        expect(ceiling.getAttribute('aria-valuemax')).toBe('3');
        expect(screen.getByText('0.9 GB')).toBeTruthy();
        expect(screen.queryByText('100 GB')).toBeNull();
    });

    it('raises the ceiling by a step from the keyboard', async () => {
        renderPanel();
        const ceiling = await screen.findByRole('slider', { name: 'Storage ceiling' });

        fireEvent.keyDown(ceiling, { key: 'ArrowRight' });

        await waitFor(() => {
            expect(setBudget).toHaveBeenCalledWith(25 * 1_073_741_824);
        });
    });

    it('names a failed change rather than quoting the driver at the reader', async () => {
        saveContract.mockRejectedValue(new Error('The local archive aborted a transaction'));
        renderPanel();

        fireEvent.click(await screen.findByRole('switch', { name: 'Record ETHUSDT' }));

        expect(await screen.findByText('That change could not be saved.')).toBeTruthy();
        expect(screen.queryByText(/aborted a transaction/)).toBeNull();
    });
});


describe('what else could be recorded', () => {
    const budget: StorageBudget = {
        maximumBytes: 10_737_418_240,
        usedBytes: 1_073_741_824,
        availableBytes: null,
    };

    function renderInKernel(saveContract: Mock<(contract: RecordedContract) => Promise<void>>): void {
        const recording = {
            listContracts: () => Promise.resolve(CONTRACTS),
            readBudget: () => Promise.resolve(budget),
            saveContract,
            setBudget: vi.fn().mockResolvedValue(undefined),
            pruneToBudget: vi.fn().mockResolvedValue(0),
        } as unknown as RecordingControl;

        renderWithKernel(createIndicatorKernel(), (
            <RecordingPanel
                recording={recording}
                onContractsChanged={() => undefined}
                translate={buildTranslate('en')}
            />
        ));
    }

    it('files each contract under the venue that publishes it', async () => {
        // Two venues both list BTCUSDT. A row that says only the symbol is a
        // row about whichever one the reader assumed.
        renderInKernel(vi.fn<(contract: RecordedContract) => Promise<void>>().mockResolvedValue(undefined));

        expect(await screen.findByText(FIRST_VENUE)).toBeDefined();
    });

    it('offers the venues that publish a book, and names the ones that do not', async () => {
        renderInKernel(vi.fn<(contract: RecordedContract) => Promise<void>>().mockResolvedValue(undefined));

        fireEvent.click(await screen.findByRole('button', { name: 'Record another pair' }));

        expect(screen.getByRole('button', { name: FIRST_VENUE, pressed: true })).toBeDefined();
        // Declared `book: null`, so there is nothing on them to capture.
        expect(screen.queryByRole('button', { name: 'okx' })).toBeNull();
        expect(screen.getByText(/publish no book/)).toBeDefined();
    });

    it('records a pair on the grid that was chosen for it', async () => {
        // The grid cannot be changed later without two of them ending up in one
        // history, so it is asked before the recording starts rather than after.
        const saveContract = vi.fn<(contract: RecordedContract) => Promise<void>>()
            .mockResolvedValue(undefined);
        renderInKernel(saveContract);
        fireEvent.click(await screen.findByRole('button', { name: 'Record another pair' }));

        fireEvent.click(await screen.findByRole('button', { name: /NANOUSDT/ }));
        fireEvent.click(await screen.findByRole('button', { name: '0.001 per row' }));

        expect(saveContract).toHaveBeenCalledWith({
            venue: FIRST_VENUE,
            instrumentSymbol: 'NANOUSDT',
            priceBucketSize: 0.001,
            frameIntervalMs: 1_000,
            isEnabled: true,
        });
    });

    it('says a pair is already on the list rather than offering it twice', async () => {
        renderInKernel(vi.fn<(contract: RecordedContract) => Promise<void>>().mockResolvedValue(undefined));
        fireEvent.click(await screen.findByRole('button', { name: 'Record another pair' }));

        const btc = await screen.findByRole('button', { name: /BTCUSDT/ });

        expect(btc.textContent).toContain('on the list');
        expect(btc.hasAttribute('disabled')).toBe(true);
    });
});
