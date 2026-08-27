import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { Drawing, DrawingAnchor } from '../../../../src/shared/core/drawing.ts';
import {
    DrawingsController,
    MAXIMUM_DRAWINGS_PER_INSTRUMENT,
} from '../../../../src/app/drawings/drawings-controller.ts';
import { DEFAULT_PREFERENCES, type PreferencesService } from '../../../../src/app/services/preferences-service.ts';
import type { ViewerPreferences } from '../../../../src/app/services/preferences-service.ts';

interface Harness {
    readonly drawings: DrawingsController;
    readonly write: Mock<(preferences: Partial<ViewerPreferences>) => void>;
}

function buildHarness(stored: readonly Drawing[] = []): Harness {
    const write: Harness['write'] = vi.fn();
    let names = 0;

    const drawings = new DrawingsController({
        preferences: {
            read: () => ({ ...DEFAULT_PREFERENCES, drawings: stored }),
            write,
        } as unknown as PreferencesService,
        readInstrumentSymbol: () => 'BTCUSDT',
        newId: () => `mark-${(names += 1)}`,
    });

    return { drawings, write };
}

function at(atMs: number, price: number): DrawingAnchor {
    return { atMs, price };
}

/** The last thing written to storage, as marks. */
function readPersisted(harness: Harness): readonly Drawing[] {
    return harness.write.mock.calls.at(-1)?.[0]?.drawings ?? [];
}

describe('DrawingsController arming a tool', () => {
    let harness: Harness;

    beforeEach(() => { harness = buildHarness(); });

    it('holds the tool the next press will draw with', () => {
        harness.drawings.arm('trend-line');

        expect(harness.drawings.store.read().armedTool).toBe('trend-line');
    });

    it('hands the pointer back when the tool is put down', () => {
        harness.drawings.arm('trend-line');

        harness.drawings.arm(null);

        expect(harness.drawings.store.read().armedTool).toBeNull();
    });

    it('drops a mark half drawn when the tool is put down', () => {
        harness.drawings.arm('trend-line');
        harness.drawings.begin({ anchor: at(1_000, 100), hitId: null });

        harness.drawings.arm(null);

        expect(harness.drawings.store.read().draft).toBeNull();
    });
});

describe('DrawingsController drawing a level', () => {
    let harness: Harness;

    beforeEach(() => {
        harness = buildHarness();
        harness.drawings.arm('horizontal-line');
    });

    it('keeps the level a single press left', () => {
        harness.drawings.begin({ anchor: at(1_000, 100), hitId: null });
        harness.drawings.settle();

        expect(harness.drawings.store.read().drawings).toHaveLength(1);
    });

    it('pins it to the price the press landed on', () => {
        harness.drawings.begin({ anchor: at(1_000, 100), hitId: null });
        harness.drawings.settle();

        expect(harness.drawings.store.read().drawings[0]?.anchors).toEqual([at(1_000, 100)]);
    });

    it('lets the press be fine-tuned before it is let go', () => {
        harness.drawings.begin({ anchor: at(1_000, 100), hitId: null });
        harness.drawings.drag(at(1_400, 105));
        harness.drawings.settle();

        expect(harness.drawings.store.read().drawings[0]?.anchors).toEqual([at(1_400, 105)]);
    });

    it('puts the tool down once the mark is made', () => {
        // A tool that stayed armed would draw a second level on the next press,
        // when what a reader means by that press is almost always to select.
        harness.drawings.begin({ anchor: at(1_000, 100), hitId: null });
        harness.drawings.settle();

        expect(harness.drawings.store.read().armedTool).toBeNull();
    });

    it('leaves the new mark selected', () => {
        harness.drawings.begin({ anchor: at(1_000, 100), hitId: null });
        harness.drawings.settle();

        expect(harness.drawings.store.read().selectedId).toBe('mark-1');
    });
});

describe('DrawingsController drawing a segment', () => {
    let harness: Harness;

    beforeEach(() => {
        harness = buildHarness();
        harness.drawings.arm('trend-line');
    });

    it('draws it between where the press started and where it ended', () => {
        harness.drawings.begin({ anchor: at(1_000, 100), hitId: null });
        harness.drawings.drag(at(3_000, 200));
        harness.drawings.settle();

        expect(harness.drawings.store.read().drawings[0]?.anchors)
            .toEqual([at(1_000, 100), at(3_000, 200)]);
    });

    it('shows it while it is being dragged out', () => {
        harness.drawings.begin({ anchor: at(1_000, 100), hitId: null });

        harness.drawings.drag(at(2_000, 150));

        expect(harness.drawings.store.read().draft?.anchors).toEqual([at(1_000, 100), at(2_000, 150)]);
    });

    it('keeps nothing for a press that never moved', () => {
        // A segment of no length is invisible, cannot be grabbed again, and
        // would be stored for ever.
        harness.drawings.begin({ anchor: at(1_000, 100), hitId: null });
        harness.drawings.settle();

        expect(harness.drawings.store.read().drawings).toEqual([]);
    });

    it('leaves nothing half drawn behind either', () => {
        harness.drawings.begin({ anchor: at(1_000, 100), hitId: null });
        harness.drawings.settle();

        expect(harness.drawings.store.read().draft).toBeNull();
    });

    it('tells one mark from the next by its tone', () => {
        harness.drawings.begin({ anchor: at(1_000, 100), hitId: null });
        harness.drawings.drag(at(2_000, 150));
        harness.drawings.settle();
        harness.drawings.arm('trend-line');
        harness.drawings.begin({ anchor: at(1_000, 200), hitId: null });
        harness.drawings.drag(at(2_000, 250));
        harness.drawings.settle();

        const [first, second] = harness.drawings.store.read().drawings;
        expect(first?.tone).not.toBe(second?.tone);
    });
});

describe('DrawingsController moving a mark', () => {
    let harness: Harness;

    beforeEach(() => {
        harness = buildHarness();
        harness.drawings.arm('trend-line');
        harness.drawings.begin({ anchor: at(1_000, 100), hitId: null });
        harness.drawings.drag(at(3_000, 200));
        harness.drawings.settle();
    });

    it('carries the mark the press landed on', () => {
        harness.drawings.begin({ anchor: at(2_000, 150), hitId: 'mark-1' });
        harness.drawings.drag(at(2_500, 160));
        harness.drawings.settle();

        expect(harness.drawings.store.read().drawings[0]?.anchors)
            .toEqual([at(1_500, 110), at(3_500, 210)]);
    });

    it('moves nothing when the press landed on bare chart', () => {
        harness.drawings.begin({ anchor: at(2_000, 150), hitId: null });
        harness.drawings.drag(at(2_500, 160));

        expect(harness.drawings.store.read().drawings[0]?.anchors)
            .toEqual([at(1_000, 100), at(3_000, 200)]);
    });

    it('ignores a drag that no press began', () => {
        harness.drawings.settle();

        harness.drawings.drag(at(9_000, 900));

        expect(harness.drawings.store.read().drawings[0]?.anchors)
            .toEqual([at(1_000, 100), at(3_000, 200)]);
    });
});

describe('DrawingsController remembering what was drawn', () => {
    it('opens with what the reader left last time', () => {
        const stored: Drawing = {
            id: 'kept',
            kind: 'horizontal-line',
            instrumentSymbol: 'BTCUSDT',
            anchors: [at(1_000, 100)],
            tone: 'cyan',
        };

        expect(buildHarness([stored]).drawings.store.read().drawings).toEqual([stored]);
    });

    it('writes a new mark out where the next session will find it', () => {
        const harness = buildHarness();
        harness.drawings.arm('horizontal-line');

        harness.drawings.begin({ anchor: at(1_000, 100), hitId: null });
        harness.drawings.settle();

        expect(readPersisted(harness)).toHaveLength(1);
    });

    it('writes the move out as well, so a mark stays where it was left', () => {
        const harness = buildHarness();
        harness.drawings.arm('horizontal-line');
        harness.drawings.begin({ anchor: at(1_000, 100), hitId: null });
        harness.drawings.settle();

        harness.drawings.begin({ anchor: at(1_000, 100), hitId: 'mark-1' });
        harness.drawings.drag(at(1_000, 120));
        harness.drawings.settle();

        expect(readPersisted(harness)[0]?.anchors).toEqual([at(1_000, 120)]);
    });

    it('forgets the oldest once a chart holds more marks than it may', () => {
        // Unbounded, a reader who draws every day fills the one record every
        // preference shares until nothing can be written at all.
        const harness = buildHarness();
        for (let index = 0; index < MAXIMUM_DRAWINGS_PER_INSTRUMENT + 3; index += 1) {
            harness.drawings.arm('horizontal-line');
            harness.drawings.begin({ anchor: at(1_000, index), hitId: null });
            harness.drawings.settle();
        }

        expect(harness.drawings.store.read().drawings).toHaveLength(MAXIMUM_DRAWINGS_PER_INSTRUMENT);
    });

    it('keeps the newest of them', () => {
        const harness = buildHarness();
        for (let index = 0; index < MAXIMUM_DRAWINGS_PER_INSTRUMENT + 1; index += 1) {
            harness.drawings.arm('horizontal-line');
            harness.drawings.begin({ anchor: at(1_000, index), hitId: null });
            harness.drawings.settle();
        }

        expect(harness.drawings.store.read().drawings.at(-1)?.anchors)
            .toEqual([at(1_000, MAXIMUM_DRAWINGS_PER_INSTRUMENT)]);
    });
});

describe('DrawingsController restyling a mark', () => {
    let harness: Harness;

    beforeEach(() => {
        harness = buildHarness();
        harness.drawings.arm('horizontal-line');
        harness.drawings.begin({ anchor: at(1_000, 100), hitId: null });
        harness.drawings.settle();
    });

    it('gives it the weight it was handed', () => {
        harness.drawings.restyle('mark-1', { width: 'thick' });

        expect(harness.drawings.store.read().drawings[0]?.width).toBe('thick');
    });

    it('changes only what it was handed, leaving the rest of the look alone', () => {
        harness.drawings.restyle('mark-1', { width: 'thick' });
        const tone = harness.drawings.store.read().drawings[0]?.tone;

        harness.drawings.restyle('mark-1', { style: 'dashed' });

        expect(harness.drawings.store.read().drawings[0])
            .toMatchObject({ tone, width: 'thick', style: 'dashed' });
    });

    it('paints it in the tone it was given', () => {
        harness.drawings.restyle('mark-1', { tone: 'cyan' });

        expect(harness.drawings.store.read().drawings[0]?.tone).toBe('cyan');
    });

    it('writes the colour out, so it comes back the same next session', () => {
        harness.drawings.restyle('mark-1', { tone: 'cyan' });

        expect(readPersisted(harness)[0]?.tone).toBe('cyan');
    });

    it('leaves the other marks alone', () => {
        harness.drawings.arm('horizontal-line');
        harness.drawings.begin({ anchor: at(2_000, 200), hitId: null });
        harness.drawings.settle();

        harness.drawings.restyle('mark-1', { tone: 'cyan' });

        expect(harness.drawings.store.read().drawings[1]?.tone).not.toBe('cyan');
    });
});

describe('DrawingsController removing a mark', () => {
    let harness: Harness;

    beforeEach(() => {
        harness = buildHarness();
        harness.drawings.arm('horizontal-line');
        harness.drawings.begin({ anchor: at(1_000, 100), hitId: null });
        harness.drawings.settle();
    });

    it('takes it off the chart', () => {
        harness.drawings.remove('mark-1');

        expect(harness.drawings.store.read().drawings).toEqual([]);
    });

    it('leaves nothing selected once what was selected is gone', () => {
        harness.drawings.remove('mark-1');

        expect(harness.drawings.store.read().selectedId).toBeNull();
    });

    it('writes the removal out, so it does not come back next session', () => {
        harness.drawings.remove('mark-1');

        expect(readPersisted(harness)).toEqual([]);
    });

    it('ignores an id it never drew', () => {
        harness.drawings.remove('nobody');

        expect(harness.drawings.store.read().drawings).toHaveLength(1);
    });
});

describe('DrawingsController stepping back and forward', () => {
    let harness: Harness;

    /** Draws one level, which is one step a reader could take back. */
    function drawLevel(price: number): void {
        harness.drawings.arm('horizontal-line');
        harness.drawings.begin({ anchor: at(1_000, price), hitId: null });
        harness.drawings.settle();
    }

    beforeEach(() => { harness = buildHarness(); });

    it('offers no step back on a chart nothing has happened to', () => {
        expect(harness.drawings.store.read().canUndo).toBe(false);
    });

    it('offers one once a mark is made', () => {
        drawLevel(100);

        expect(harness.drawings.store.read().canUndo).toBe(true);
    });

    it('takes the mark back off the chart', () => {
        drawLevel(100);

        harness.drawings.undo();

        expect(harness.drawings.store.read().drawings).toEqual([]);
    });

    it('puts it back on', () => {
        drawLevel(100);
        harness.drawings.undo();

        harness.drawings.redo();

        expect(harness.drawings.store.read().drawings).toHaveLength(1);
    });

    it('writes each step out, so a reload does not undo the undo', () => {
        drawLevel(100);

        harness.drawings.undo();

        expect(readPersisted(harness)).toEqual([]);
    });

    it('takes a removal back', () => {
        drawLevel(100);
        harness.drawings.remove('mark-1');

        harness.drawings.undo();

        expect(harness.drawings.store.read().drawings).toHaveLength(1);
    });

    it('takes a recolour back', () => {
        drawLevel(100);
        const original = harness.drawings.store.read().drawings[0]?.tone;
        harness.drawings.restyle('mark-1', { tone: 'cyan' });

        harness.drawings.undo();

        expect(harness.drawings.store.read().drawings[0]?.tone).toBe(original);
    });

    it('takes a whole move back as one step, not one per frame', () => {
        // A drag rewrites a mark many times a second, and a step back per frame
        // is not a step anybody can use.
        drawLevel(100);
        harness.drawings.begin({ anchor: at(1_000, 100), hitId: 'mark-1' });
        harness.drawings.drag(at(1_000, 110));
        harness.drawings.drag(at(1_000, 120));
        harness.drawings.settle();

        harness.drawings.undo();

        expect(harness.drawings.store.read().drawings[0]?.anchors).toEqual([at(1_000, 100)]);
    });

    it('counts a press that only selected as no step at all', () => {
        drawLevel(100);
        harness.drawings.begin({ anchor: at(1_000, 100), hitId: 'mark-1' });
        harness.drawings.settle();

        harness.drawings.undo();

        expect(harness.drawings.store.read().drawings).toEqual([]);
    });

    it('lets go of a selection the step took away', () => {
        // Kept, the controls go on offering to remove what is no longer there.
        drawLevel(100);

        harness.drawings.undo();

        expect(harness.drawings.store.read().selectedId).toBeNull();
    });

    it('gives up what was ahead once the reader draws again', () => {
        drawLevel(100);
        harness.drawings.undo();

        drawLevel(200);

        expect(harness.drawings.store.read().canRedo).toBe(false);
    });

    it('does nothing when there is nothing to step back to', () => {
        harness.drawings.undo();

        expect(harness.drawings.store.read().drawings).toEqual([]);
    });
});

describe('DrawingsController with no contract on the chart', () => {
    it('draws nothing, because a mark belongs to a contract', () => {
        const drawings = new DrawingsController({
            preferences: {
                read: () => DEFAULT_PREFERENCES,
                write: vi.fn(),
            } as unknown as PreferencesService,
            readInstrumentSymbol: () => null,
            newId: () => 'mark',
        });
        drawings.arm('horizontal-line');

        drawings.begin({ anchor: at(1_000, 100), hitId: null });

        expect(drawings.store.read().draft).toBeNull();
    });
});

describe('DrawingsController measuring a move', () => {
    let harness: Harness;

    beforeEach(() => { harness = buildHarness(); });

    function measure(): void {
        harness.drawings.arm('measure');
        harness.drawings.begin({ anchor: at(1_000, 100), hitId: null });
        harness.drawings.drag(at(5_000, 120));
        harness.drawings.settle();
    }

    it('leaves the reading on the chart, where it was taken', () => {
        measure();

        expect(harness.drawings.store.read().draft?.kind).toBe('measure');
    });

    it('never keeps it, because a measurement answers a question and is done', () => {
        measure();

        expect(harness.drawings.store.read().drawings).toEqual([]);
    });

    it('writes nothing out, so it is not there again next session', () => {
        measure();

        expect(harness.write).not.toHaveBeenCalled();
    });

    it('is no step to go back over', () => {
        measure();

        expect(harness.drawings.store.read().canUndo).toBe(false);
    });

    it('puts the tool down after it, like every other', () => {
        measure();

        expect(harness.drawings.store.read().armedTool).toBeNull();
    });

    it('takes it off the chart on the next press anywhere', () => {
        measure();

        harness.drawings.select(null);

        expect(harness.drawings.store.read().draft).toBeNull();
    });
});
