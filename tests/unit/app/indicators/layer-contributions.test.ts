import { describe, expect, it } from 'vitest';
import type { AddedIndicator } from '../../../../src/shared/core/indicator-selection.ts';
import {
    findLayerContribution,
    isLayerRecolourable,
    isLayerTunable,
    listDrawnOverlays,
} from '../../../../src/app/indicators/layer-contributions.ts';

const BOOK: AddedIndicator = {
    instanceId: 'depth-1', indicatorId: 'depth', settings: {}, tone: 'muted',
};

describe('what a layer contributes to the shell', () => {
    it('carries the mark of a layer that is on the chart', () => {
        const drawn = listDrawnOverlays([BOOK]);

        expect(drawn.map((overlay) => overlay.instanceId)).toEqual(['depth-1']);
    });

    it('carries nothing for a layer that is hidden', () => {
        // Hiding a layer leaves the chart it would have drawn on; a mark left
        // over it would be describing something no longer there.
        const drawn = listDrawnOverlays([{ ...BOOK, isHidden: true }]);

        expect(drawn).toEqual([]);
    });

    it('carries nothing for a layer that contributes nothing', () => {
        const drawn = listDrawnOverlays([
            { instanceId: 'ema-1', indicatorId: 'ema', settings: {}, tone: 'amber' },
        ]);

        expect(drawn).toEqual([]);
    });

    it('says which layer must stay on the chart', () => {
        // The book holds what is being recorded, so a control that goes away
        // with it is a collector nobody can stop.
        expect(findLayerContribution('depth')?.isRemovable).toBe(false);
        expect(findLayerContribution('ema')).toBeNull();
    });
});

describe('whether a layer has anything to open onto', () => {
    it('says no for one that declares no knob and brought no panel', () => {
        // A control that opens onto an empty panel teaches a reader that opening
        // is not worth it. Asked of something this build has never heard of,
        // which is what caught the rule reading backwards.
        expect(isLayerTunable('bare')).toBe(false);
    });

    it('says yes for one that declares a knob', () => {
        expect(isLayerTunable('candles')).toBe(true);
    });

    it('says yes for one that brought a panel instead', () => {
        // The book's own knobs are not the whole of it; the recording controls
        // it carries are reason enough to open. Kept as its own arm although
        // the book also declares knobs, because the panel is a source of
        // content in its own right and losing the knobs must not close the card
        // on the controls that stop a recording.
        expect(findLayerContribution('depth')?.Panel).toBeDefined();
        expect(isLayerTunable('depth')).toBe(true);
    });
});

describe('whether a reading with no knobs has a card worth opening', () => {
    it('says no for one whose colours are the reading itself', () => {
        // The delta: bought above nought and sold below, so a copy tinted to
        // tell it from another would say something false. Nothing to set, and
        // pressing it on the chart opened a card with a name and a close button.
        expect(isLayerTunable('delta')).toBe(false);
    });

    it('says yes for one that can still be recoloured', () => {
        // The cumulative delta declares no knob either, but it is drawn in the
        // colour its copy was given — so the card holds the swatches, and
        // refusing to open it left no way to change them at all.
        expect(isLayerTunable('cvd')).toBe(true);
    });

    it('says no for a layer the host paints in colours that already mean something', () => {
        expect(isLayerRecolourable('depth')).toBe(false);
    });

    it('says no for a layer this build has never heard of', () => {
        expect(isLayerRecolourable('nothing-like-that')).toBe(false);
    });
});
