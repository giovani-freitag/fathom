import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RecordedContract, RecordingControl, StorageBudget } from '../../../../src/shared/core/recording-control.ts';
import { buildTranslate } from '../../../../src/app/i18n/translator.ts';
import { RecordingPanel } from '../../../../src/app/ui/recording-panel.tsx';

const CONTRACTS: RecordedContract[] = [
    { instrumentSymbol: 'BTCUSDT', priceBucketSize: 10, frameIntervalMs: 1_000, isEnabled: true },
    { instrumentSymbol: 'ETHUSDT', priceBucketSize: 0.5, frameIntervalMs: 1_000, isEnabled: false },
];

describe('RecordingPanel', () => {
    let budget: StorageBudget;
    let saveContract: Mock<(contract: RecordedContract) => Promise<void>>;
    let onContractsChanged: Mock<() => void>;

    function renderPanel(): void {
        const recording = {
            listContracts: () => Promise.resolve(CONTRACTS),
            readBudget: () => Promise.resolve(budget),
            saveContract,
            setBudget: vi.fn().mockResolvedValue(undefined),
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

        expect(await screen.findByRole('button', { name: '10 GB' })).toBeTruthy();
    });

    it('offers shares of the quota when the host does name one', async () => {
        budget = { maximumBytes: 1_000_000_000, usedBytes: 0, availableBytes: 4_000_000_000 };

        renderPanel();

        // A quarter of four gigabytes, in gibibytes: the ceilings on offer are
        // shares of what the host allows, not the fixed list it falls back to.
        expect(await screen.findByRole('button', { name: '0.9 GB' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: '100 GB' })).toBeNull();
    });

    it('names a failed change rather than quoting the driver at the reader', async () => {
        saveContract.mockRejectedValue(new Error('The local archive aborted a transaction'));
        renderPanel();

        fireEvent.click(await screen.findByRole('switch', { name: 'Record ETHUSDT' }));

        expect(await screen.findByText('That change could not be saved.')).toBeTruthy();
        expect(screen.queryByText(/aborted a transaction/)).toBeNull();
    });
});
