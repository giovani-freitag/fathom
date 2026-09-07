import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createIndicatorKernel, renderWithKernel } from '../../../../mocks/indicator-kernel.tsx';
import { FIRST_VENUE } from '../../../../../src/shared/core/recording-control.ts';
import type { RecordedContract, RecordingControl, StorageBudget } from '../../../../../src/shared/core/recording-control.ts';
import { type ReactElement, useState } from 'react';
import { buildTranslate } from '../../../../../src/app/i18n/translator.ts';
import { observedSize } from '../../../../fixtures/observed-size.ts';
import { stubViewport } from '../../../../fixtures/viewport.ts';
import { RecordingPanel, type RecordingPanelProps } from '../../../../../src/app/indicators/book/recording-panel.tsx';
import type { OpenPair } from '../../../../../src/app/indicators/book/current-pair-recording.tsx';

const CONTRACTS: RecordedContract[] = [
    { venue: FIRST_VENUE, instrumentSymbol: 'BTCUSDT', priceBucketSize: 10, frameIntervalMs: 1_000, isEnabled: true },
    { venue: FIRST_VENUE, instrumentSymbol: 'ETHUSDT', priceBucketSize: 0.5, frameIntervalMs: 1_000, isEnabled: false },
];

/**
 * The panel with whoever mounts it holding the step it is on.
 *
 * The app holds it in `BookPanel`, because the listing takes the whole card
 * over. Left optional, the panel kept a copy to fall back on and every test
 * drove that copy — so the one path production runs had no test at all.
 */
function HoldingPanel(props: Omit<RecordingPanelProps, 'isPicking' | 'onPickingChange'>): ReactElement {
    const [isPicking, setIsPicking] = useState(false);
    return <RecordingPanel {...props} isPicking={isPicking} onPickingChange={setIsPicking} />;
}

describe('RecordingPanel', () => {
    let budget: StorageBudget;
    let saveContract: Mock<(contract: RecordedContract) => Promise<void>>;
    let setBudget: Mock<(maximumBytes: number) => Promise<void>>;
    let onContractsChanged: Mock<() => Promise<void> | void>;

    function renderPanel(openPair?: OpenPair): void {
        const recording = {
            listContracts: () => Promise.resolve(CONTRACTS),
            readBudget: () => Promise.resolve(budget),
            saveContract,
            setBudget,
            pruneToBudget: vi.fn().mockResolvedValue(0),
        } as unknown as RecordingControl;

        render(
            <HoldingPanel
                recording={recording}
                onContractsChanged={onContractsChanged}
                translate={buildTranslate('en')}
                {...openPair === undefined ? {} : { openPair }}
            />,
        );
    }

    beforeEach(() => {
        saveContract = vi.fn<(contract: RecordedContract) => Promise<void>>()
            .mockResolvedValue(undefined);
        onContractsChanged = vi.fn<() => Promise<void> | void>();
        setBudget = vi.fn<(maximumBytes: number) => Promise<void>>().mockResolvedValue(undefined);
        budget = { maximumBytes: 10_737_418_240, usedBytes: 1_073_741_824, availableBytes: null };
    });

    it('says a change failed when the listing that confirms it will not answer', async () => {
        // The save succeeded and the confirmation did not. Run after the guard
        // rather than inside it, the failure told nobody: the reader was shown a
        // recording that had started against a listing that never said so.
        onContractsChanged = vi.fn<() => Promise<void> | void>()
            .mockRejectedValue(new Error('the listing is unavailable'));
        renderPanel({ venue: FIRST_VENUE, symbol: 'BTCUSDT', lastPrice: 79_000 });

        fireEvent.click(await screen.findByRole('button', { name: 'Stop recording BTCUSDT' }));

        expect(await screen.findByText('That change could not be saved.')).toBeDefined();
    });

    it('switches the contract on the chart off without opening the listing', async () => {
        // A reader looking at a pair has already said which one they mean.
        // Managing it meant opening a card, finding it among nine hundred rows,
        // and coming back.
        renderPanel({ venue: FIRST_VENUE, symbol: 'BTCUSDT', lastPrice: 79_000 });

        fireEvent.click(await screen.findByRole('button', { name: 'Stop recording BTCUSDT' }));

        await vi.waitFor(() => {
            expect(saveContract).toHaveBeenCalledWith(
                expect.objectContaining({ instrumentSymbol: 'BTCUSDT', isEnabled: false }),
            );
        });
    });

    it('offers to record the contract on the chart, asking the grid first', async () => {
        // The grid cannot be changed once a recording holds history on it, so
        // the press this shortcut saves is the one that opens the list, never
        // the one that decides.
        renderPanel({ venue: 'bybit', symbol: 'AAVEUSDT', lastPrice: 133.5 });

        fireEvent.click(await screen.findByRole('button', { name: 'Record AAVEUSDT' }));
        const grids = await screen.findByText('Price per row for AAVEUSDT');
        fireEvent.click(within(grids.parentElement!).getAllByRole('button')[0]!);

        await vi.waitFor(() => {
            expect(saveContract).toHaveBeenCalledWith(
                expect.objectContaining({ venue: 'bybit', instrumentSymbol: 'AAVEUSDT', isEnabled: true }),
            );
        });
    });

    it('offers nothing about a chart that is on no contract', () => {
        renderPanel();

        expect(screen.queryByRole('button', { name: /Record |Stop recording/ })).toBeNull();
    });

    it('counts what is being recorded rather than listing it twice', async () => {
        // The rows live in the card that opens from here, where each carries
        // its own switch. Written in both places they are two lists to keep in
        // step, and this is the one that cannot show what is missing from it.
        renderPanel();

        // One pair counted as one pair: the line used to read "Recording 1
        // pairs", which is what every reader saw on their first contract.
        expect(await screen.findByText(/Recording one pair on binance-futures/)).toBeDefined();
        expect(screen.getByText(/1 switched off/)).toBeDefined();
        expect(screen.queryByRole('switch', { name: 'Record BTCUSDT' })).toBeNull();
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
        setBudget.mockRejectedValue(new Error('The local archive aborted a transaction'));
        renderPanel();

        fireEvent.keyDown(await screen.findByRole('slider', { name: 'Storage ceiling' }), { key: 'ArrowRight' });

        expect(await screen.findByText('That change could not be saved.')).toBeTruthy();
        expect(screen.queryByText(/aborted a transaction/)).toBeNull();
    });
});


const showAt = stubViewport();

describe('what else could be recorded', () => {
    // The rail and the phone's select are different trees. These describe
    // the rail unless they say otherwise.
    afterEach(() => { showAt(1_280); });

    const budget: StorageBudget = {
        maximumBytes: 10_737_418_240,
        usedBytes: 1_073_741_824,
        availableBytes: null,
    };

    function renderInKernel(
        saveContract: Mock<(contract: RecordedContract) => Promise<void>>,
        removeContract: Mock<(venue: string, symbol: string) => Promise<void>>
            = vi.fn<(venue: string, symbol: string) => Promise<void>>().mockResolvedValue(undefined),
        contracts: readonly RecordedContract[] = CONTRACTS,
    ): void {
        const recording = {
            listContracts: () => Promise.resolve(contracts),
            readBudget: () => Promise.resolve(budget),
            saveContract,
            removeContract,
            setBudget: vi.fn().mockResolvedValue(undefined),
            pruneToBudget: vi.fn().mockResolvedValue(0),
        } as unknown as RecordingControl;

        renderWithKernel(createIndicatorKernel(), (
            <HoldingPanel
                recording={recording}
                onContractsChanged={() => undefined}
                translate={buildTranslate('en')}
            />
        ));
    }

    it('names the venue in the count, because two of them list the same pair', async () => {
        renderInKernel(vi.fn<(contract: RecordedContract) => Promise<void>>().mockResolvedValue(undefined));

        expect(await screen.findByText(new RegExp(FIRST_VENUE))).toBeDefined();
    });

    it('switches a contract off from the row it is listed on', async () => {
        // The picker upstream reads that listing, so it has to be told: a
        // contract only reaches the registry once its collector has started.
        const saveContract = vi.fn<(contract: RecordedContract) => Promise<void>>()
            .mockResolvedValue(undefined);
        renderInKernel(saveContract);
        fireEvent.click(await screen.findByRole('button', { name: 'Choose what to record' }));

        const listing = await screen.findByRole('list', { name: 'Record a pair' });
        fireEvent.click(within(listing).getByRole('switch', { name: 'Record BTCUSDT' }));

        await waitFor(() => {
            expect(saveContract).toHaveBeenCalledWith(expect.objectContaining({
                instrumentSymbol: 'BTCUSDT', isEnabled: false,
            }));
        });
    });

    it('offers the venues that publish a book, and names the ones that do not', async () => {
        renderInKernel(vi.fn<(contract: RecordedContract) => Promise<void>>().mockResolvedValue(undefined));

        fireEvent.click(await screen.findByRole('button', { name: 'Choose what to record' }));

        // The rail of the card that opens over the chart, which is the same
        // rail the contract picker has.
        showAt(1_280);
        const rail = await screen.findByRole('navigation', { name: 'Venues' });
        expect(rail.textContent).toContain('bybit');
        expect(rail.textContent).toContain('gate');
        // Declared `book: null`, so there is nothing on them to capture.
        expect(rail.textContent).not.toContain('okx ');
        expect(screen.getByText(/No connector here reads a book/)).toBeDefined();
    });

    it('asks which venue outright on a phone, and still says why three of six are offered', async () => {
        // Laid down as a strip the rail hid its own heading and dropped the
        // line explaining why the chart lists six venues and this offers three.
        showAt(390);
        renderInKernel(vi.fn<(contract: RecordedContract) => Promise<void>>().mockResolvedValue(undefined));

        fireEvent.click(await screen.findByRole('button', { name: 'Choose what to record' }));

        expect(await screen.findByRole('combobox', { name: 'Venues' })).toBeDefined();
        expect(screen.queryByRole('navigation', { name: 'Venues' })).toBeNull();
        expect(screen.getByText(/No connector here reads a book/)).toBeDefined();
    });

    it('lays out for the box it is in rather than for the window around it', async () => {
        // It opens inside a settings column two hundred and eighty-eight pixels
        // wide. Asked of the window, the answer on a desk was "wide": the card
        // laid out a two-hundred-and-twenty-four pixel rail, left sixty-four
        // pixels for a thousand contracts, and scrolled sideways.
        showAt(1_440);
        observedSize.width = 288;
        renderInKernel(vi.fn<(contract: RecordedContract) => Promise<void>>().mockResolvedValue(undefined));

        fireEvent.click(await screen.findByRole('button', { name: 'Choose what to record' }));

        expect(await screen.findByRole('combobox', { name: 'Venues' })).toBeDefined();
        expect(screen.queryByRole('navigation', { name: 'Venues' })).toBeNull();
    });

    it('does not say which venue twice over on the screen with least room', async () => {
        // The select names the venue, and the banner named it again in a row of
        // its own directly underneath — with the quote chips beside it, which
        // narrow a listing the reader is already narrowing in the field above.
        showAt(390);
        renderInKernel(vi.fn<(contract: RecordedContract) => Promise<void>>().mockResolvedValue(undefined));

        fireEvent.click(await screen.findByRole('button', { name: 'Choose what to record' }));

        await screen.findByRole('combobox', { name: 'Venues' });
        expect(screen.queryByRole('button', { name: 'USDT' })).toBeNull();
    });

    it('records a pair on the grid that was chosen for it', async () => {
        // The grid cannot be changed later without two of them ending up in one
        // history, so it is asked before the recording starts rather than after.
        const saveContract = vi.fn<(contract: RecordedContract) => Promise<void>>()
            .mockResolvedValue(undefined);
        renderInKernel(saveContract);
        fireEvent.click(await screen.findByRole('button', { name: 'Choose what to record' }));

        fireEvent.click(await screen.findByRole('button', { name: /NANOUSDT/ }));
        // The venue answered nothing about what it trades at, so the grids fall
        // back to the tick — which is the case this mock stands for.
        fireEvent.click(await screen.findByRole('button', { name: '0.01 per row' }));

        expect(saveContract).toHaveBeenCalledWith({
            venue: FIRST_VENUE,
            instrumentSymbol: 'NANOUSDT',
            priceBucketSize: 0.01,
            frameIntervalMs: 1_000,
            isEnabled: true,
        });
    });

    it('changes the grid of a contract already recording', async () => {
        // Not a decision made once for ever: the archive says which grid each
        // block holds, so what is stored stays readable and the collector is
        // rebuilt on the new one.
        const saveContract = vi.fn<(contract: RecordedContract) => Promise<void>>()
            .mockResolvedValue(undefined);
        renderInKernel(saveContract);
        fireEvent.click(await screen.findByRole('button', { name: 'Choose what to record' }));

        fireEvent.click(await screen.findByRole('button', { name: /Change the grid BTCUSDT records on/ }));
        fireEvent.click(await screen.findByRole('button', { name: '2 per row' }));

        await waitFor(() => {
            expect(saveContract).toHaveBeenCalledWith(expect.objectContaining({
                instrumentSymbol: 'BTCUSDT',
                priceBucketSize: 2,
                isEnabled: true,
            }));
        });
    });

    it('heads each group as a heading, and names the list under it', async () => {
        // Read aloud, three unlabelled lists say "list, two items… list, three
        // items" and nothing about which pairs are recording.
        renderInKernel(vi.fn<(contract: RecordedContract) => Promise<void>>().mockResolvedValue(undefined));

        fireEvent.click(await screen.findByRole('button', { name: 'Choose what to record' }));

        const heading = await screen.findByRole('heading', { name: 'Recording' });
        expect(screen.getByRole('list', { name: 'Recording' })).toBeDefined();
        expect(heading).toBeDefined();
    });

    it('does not offer to switch off a contract that is already off', async () => {
        // The safer alternative it names has to exist: told to switch off what
        // is already off, a reader hunts for a switch that would change nothing.
        renderInKernel(vi.fn<(contract: RecordedContract) => Promise<void>>().mockResolvedValue(undefined));
        fireEvent.click(await screen.findByRole('button', { name: 'Choose what to record' }));

        fireEvent.click(await screen.findByRole('button', {
            name: 'Delete ETHUSDT and everything it recorded',
        }));

        expect(await screen.findByText(/already switched off/)).toBeDefined();
    });

    it('says which grid is in force in the name the button answers to', async () => {
        // The value is written on the button, and the name it carried named
        // only the action — so a reader who cannot see it had to open the
        // chooser to find out what they were on.
        renderInKernel(vi.fn<(contract: RecordedContract) => Promise<void>>().mockResolvedValue(undefined));

        fireEvent.click(await screen.findByRole('button', { name: 'Choose what to record' }));

        const grid = await screen.findByRole('button', { name: /Change the grid BTCUSDT records on/ });

        // The figure itself, not merely a place where one could go.
        expect(grid.getAttribute('aria-label')).toContain('10 per row');
    });

    it('leaves the grid in force reachable, rather than skipping it', async () => {
        // Disabled, it fell out of the tab order: a reader tabbing the options
        // never met the one they were on, and heard "unavailable" if they did.
        renderInKernel(vi.fn<(contract: RecordedContract) => Promise<void>>().mockResolvedValue(undefined));
        fireEvent.click(await screen.findByRole('button', { name: 'Choose what to record' }));

        fireEvent.click(await screen.findByRole('button', { name: /Change the grid BTCUSDT records on/ }));

        const current = await screen.findByRole('button', { name: '10 per row', current: true });
        expect(current.hasAttribute('disabled')).toBe(false);
    });

    it('says what changing the grid costs before it is changed', async () => {
        renderInKernel(vi.fn<(contract: RecordedContract) => Promise<void>>().mockResolvedValue(undefined));
        fireEvent.click(await screen.findByRole('button', { name: 'Choose what to record' }));

        fireEvent.click(await screen.findByRole('button', { name: /Change the grid BTCUSDT records on/ }));

        expect(await screen.findByText(/keeps the grid it was written on/)).toBeDefined();
    });

    it('asks before deleting a recording, and says what is lost', async () => {
        // Apart from the switch on purpose: one keeps everything that was
        // captured, and an order book cannot be recorded again.
        const removeContract = vi.fn<(venue: string, symbol: string) => Promise<void>>()
            .mockResolvedValue(undefined);
        renderInKernel(
            vi.fn<(contract: RecordedContract) => Promise<void>>().mockResolvedValue(undefined),
            removeContract,
        );
        fireEvent.click(await screen.findByRole('button', { name: 'Choose what to record' }));

        fireEvent.click(await screen.findByRole('button', {
            name: 'Delete BTCUSDT and everything it recorded',
        }));

        expect(await screen.findByText(/cannot be recorded again/)).toBeDefined();
        expect(removeContract).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Delete it' }));

        await waitFor(() => {
            expect(removeContract).toHaveBeenCalledWith(FIRST_VENUE, 'BTCUSDT');
        });
    });

    it('claims no assets for a contract the listing never reached', async () => {
        // Only the symbol is known. Filling the base with it drew the pair as
        // "ETHUSDT/", which is not what anything calls it.
        renderInKernel(vi.fn<(contract: RecordedContract) => Promise<void>>().mockResolvedValue(undefined));
        fireEvent.click(await screen.findByRole('button', { name: 'Choose what to record' }));

        const row = (await screen.findByRole('switch', { name: 'Record ETHUSDT' })).closest('li');

        expect(row?.textContent).not.toContain('ETHUSDT/');
    });

    it('hands the focus back to the button that asked, once the question is answered', async () => {
        // Opened from a control rather than from a trigger of its own, so
        // nothing gave the focus back: a reader who cancelled landed on the
        // document, a hundred and fifty rows away from where they were.
        renderInKernel(vi.fn<(contract: RecordedContract) => Promise<void>>().mockResolvedValue(undefined));
        fireEvent.click(await screen.findByRole('button', { name: 'Choose what to record' }));

        const trash = await screen.findByRole('button', {
            name: 'Delete BTCUSDT and everything it recorded',
        });
        trash.focus();
        fireEvent.click(trash);
        fireEvent.click(await screen.findByRole('button', { name: 'Keep it' }));

        await waitFor(() => {
            expect(document.activeElement).toBe(trash);
        });
    });

    it('counts the rows it drew, including the ones it lifted past the cut', async () => {
        // It counted the listing instead, and said "150 of 895" over 151 rows.
        renderInKernel(vi.fn<(contract: RecordedContract) => Promise<void>>().mockResolvedValue(undefined));
        fireEvent.click(await screen.findByRole('button', { name: 'Choose what to record' }));
        await screen.findByRole('switch', { name: 'Record ETHUSDT' });

        const drawn = screen.getAllByRole('listitem')
            .filter((row) => row.querySelector('button[aria-label^="Open"], [role="switch"], button[aria-label^="Change"]'))
            .length;

        expect(drawn).toBeGreaterThan(0);
    });

    it('takes a deleted contract out of what is recording', async () => {
        // The row it was on is a row about a machine that is running. Deleted
        // and left where it was, the panel says a recording exists that does
        // not, and the switch on it would build one nobody asked for.
        let contracts = [...CONTRACTS];
        const recording = {
            // A fresh list each time, as every real one answers: the archive is
            // read again, not handed back the array it gave last time.
            listContracts: () => Promise.resolve([...contracts]),
            readBudget: () => Promise.resolve(budget),
            saveContract: vi.fn().mockResolvedValue(undefined),
            removeContract: vi.fn((venue: string, symbol: string) => {
                contracts = contracts.filter((one) => !(one.venue === venue
                    && one.instrumentSymbol === symbol));
                return Promise.resolve();
            }),
            setBudget: vi.fn().mockResolvedValue(undefined),
            pruneToBudget: vi.fn().mockResolvedValue(0),
        } as unknown as RecordingControl;

        renderWithKernel(createIndicatorKernel(), (
            <HoldingPanel
                recording={recording}
                onContractsChanged={() => undefined}
                translate={buildTranslate('en')}
            />
        ));
        fireEvent.click(await screen.findByRole('button', { name: 'Choose what to record' }));
        fireEvent.click(await screen.findByRole('button', {
            name: 'Delete BTCUSDT and everything it recorded',
        }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete it' }));

        await waitFor(() => {
            expect(screen.queryByRole('switch', { name: 'Record BTCUSDT' })).toBeNull();
        });
        // Back among the pairs the venue offers, where it can be recorded again.
        const listing = await screen.findByRole('list', { name: 'Record a pair' });
        expect(within(listing).getByRole('button', { name: /BTCUSDT/ }).textContent)
            .toContain('choose a grid');
    });

    it('leaves a switched-off contract off when only its grid changes', async () => {
        // The control says it changes the grid. Starting a recording is the
        // switch on the same row, and a reader who wanted the one and got both
        // has a collector running against a venue they did not ask to reach.
        const saveContract = vi.fn<(contract: RecordedContract) => Promise<void>>()
            .mockResolvedValue(undefined);
        renderInKernel(saveContract, undefined, [{
            venue: FIRST_VENUE,
            instrumentSymbol: 'NANOUSDT',
            priceBucketSize: 0.001,
            frameIntervalMs: 1_000,
            isEnabled: false,
        }]);
        fireEvent.click(await screen.findByRole('button', { name: 'Choose what to record' }));

        fireEvent.click(await screen.findByRole('button', { name: /Change the grid NANOUSDT records on/ }));
        // One the contract is not already on: pressing the current grid does
        // nothing now, which is the point of it staying reachable.
        // A grid it is not already on: pressing the one in force does nothing
        // now, which is the point of it staying reachable.
        fireEvent.click(await screen.findByRole('button', { name: '0.002 per row' }));

        await waitFor(() => {
            expect(saveContract).toHaveBeenCalledWith(expect.objectContaining({
                instrumentSymbol: 'NANOUSDT',
                isEnabled: false,
            }));
        });
    });

    it('lists a contract being recorded that the venue listing never reached', async () => {
        // The listing stops at a couple of hundred rows and a venue trades a
        // thousand. A pair recorded from the far end of it was reachable only
        // by searching a name the reader had no way to know was there.
        renderInKernel(vi.fn<(contract: RecordedContract) => Promise<void>>().mockResolvedValue(undefined));

        fireEvent.click(await screen.findByRole('button', { name: 'Choose what to record' }));

        expect(await screen.findByRole('switch', { name: 'Record ETHUSDT' })).toBeDefined();
    });

    it('narrows the contracts it lifted to the top by what was typed', async () => {
        // Lifting a recorded pair past the row cut is right; lifting it past
        // the search as well left every recording standing under a name that
        // matched none of them.
        renderInKernel(vi.fn<(contract: RecordedContract) => Promise<void>>().mockResolvedValue(undefined));
        fireEvent.click(await screen.findByRole('button', { name: 'Choose what to record' }));
        expect(await screen.findByRole('switch', { name: 'Record ETHUSDT' })).toBeDefined();

        fireEvent.change(await screen.findByLabelText('Search pairs'), { target: { value: 'ZZZQQ' } });

        await waitFor(() => {
            expect(screen.queryByRole('switch', { name: 'Record ETHUSDT' })).toBeNull();
        });
    });

    it('heads the contracts that are off with what they are, not with "Recording"', async () => {
        renderInKernel(vi.fn<(contract: RecordedContract) => Promise<void>>().mockResolvedValue(undefined));

        fireEvent.click(await screen.findByRole('button', { name: 'Choose what to record' }));

        expect(await screen.findByText('Switched off')).toBeDefined();
    });

    it('says it is asking while the venue answers, rather than drawing an empty card', async () => {
        // A listing is written `reading` with no rows on the same tick it is
        // asked for, so a card that only tests the kind of the listing draws
        // three groups of nothing for as long as the venue takes — which reads
        // as a venue that trades nothing, or as a card that broke.
        const recording = {
            listContracts: () => Promise.resolve([]),
            readBudget: () => Promise.resolve(budget),
            saveContract: vi.fn().mockResolvedValue(undefined),
            removeContract: vi.fn().mockResolvedValue(undefined),
            setBudget: vi.fn().mockResolvedValue(undefined),
            pruneToBudget: vi.fn().mockResolvedValue(0),
        } as unknown as RecordingControl;

        renderWithKernel(
            createIndicatorKernel([], () => new Promise(() => undefined)),
            (
                <HoldingPanel
                    recording={recording}
                    onContractsChanged={() => undefined}
                    translate={buildTranslate('en')}
                />
            ),
        );
        fireEvent.click(await screen.findByRole('button', { name: 'Choose what to record' }));

        expect(await screen.findByText(/Asking the venue/)).toBeDefined();
    });

    it('says a venue refused and offers to ask again, rather than asking for ever', async () => {
        // A refusal and an answer that has not arrived read the same from here,
        // and the request is never sent a second time: without this the card
        // says it is asking until the page is reloaded.
        const recording = {
            listContracts: () => Promise.resolve(CONTRACTS),
            readBudget: () => Promise.resolve(budget),
            saveContract: vi.fn().mockResolvedValue(undefined),
            removeContract: vi.fn().mockResolvedValue(undefined),
            setBudget: vi.fn().mockResolvedValue(undefined),
            pruneToBudget: vi.fn().mockResolvedValue(0),
        } as unknown as RecordingControl;

        renderWithKernel(
            createIndicatorKernel([], () => Promise.reject(new Error('the venue is down'))),
            (
                <HoldingPanel
                    recording={recording}
                    onContractsChanged={() => undefined}
                    translate={buildTranslate('en')}
                />
            ),
        );
        fireEvent.click(await screen.findByRole('button', { name: 'Choose what to record' }));

        expect(await screen.findByRole('button', { name: 'Try again' })).toBeDefined();
    });

    it('lifts what is already being recorded to the top, with its switch on the row', async () => {
        // A reader who came to switch one off would otherwise be searching a
        // thousand rows for the four they own — and the switch for those four
        // was in a different list from the pairs themselves.
        const saveContract = vi.fn<(contract: RecordedContract) => Promise<void>>()
            .mockResolvedValue(undefined);
        renderInKernel(saveContract);
        fireEvent.click(await screen.findByRole('button', { name: 'Choose what to record' }));

        const listing = await screen.findByRole('list', { name: 'Record a pair' });
        const said = within(listing).getAllByRole('listitem').map((row) => row.textContent);
        expect(said[0]).toContain('Recording');
        expect(said[1]).toContain('BTCUSDT');

        // The same switch as the panel's, on the row the pair is listed on.
        const switches = screen.getAllByRole('switch', { name: 'Record BTCUSDT' });
        fireEvent.click(switches[switches.length - 1]!);

        await waitFor(() => {
            expect(saveContract).toHaveBeenCalledWith(expect.objectContaining({
                instrumentSymbol: 'BTCUSDT',
                isEnabled: false,
            }));
        });
    });
});
