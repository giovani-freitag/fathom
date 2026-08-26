import { describe, expect, it } from 'vitest';
import type { AddedIndicator } from '../../../../src/shared/core/indicator-selection.ts';
import { findLayerContribution, listDrawnOverlays } from '../../../../src/app/indicators/layer-contributions.ts';

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
