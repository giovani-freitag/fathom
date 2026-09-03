import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { createIndicatorKernel, renderWithKernel } from '../../../../mocks/indicator-kernel.tsx';
import { IndicatorParameters } from '../../../../../src/app/ui/indicators/indicator-parameters.tsx';
import { Params } from '../../../../../src/shared/core/addon-api.ts';
import type { AddedIndicator } from '../../../../../src/shared/core/indicator-selection.ts';
import type { Indicator } from '../../../../../src/shared/core/draw-plan.ts';

const ADDED: AddedIndicator = {
    instanceId: 'mine-1',
    indicatorId: 'addon:mine',
    settings: {},
    tone: 'phosphor',
};

function renderKnobs(indicator: Indicator): void {
    renderWithKernel(
        createIndicatorKernel([]),
        <IndicatorParameters
            indicator={indicator}
            added={ADDED}
            onRetune={() => undefined}
            onRecolour={() => undefined}
        />,
    );
}

describe('what a knob is called', () => {
    it('is what the reading declared', () => {
        // Read off a key built from the name instead, a reading that named its
        // own control was labelled with whatever the build calls a knob of that
        // name — `periodBars` came out as "Bars" however it was declared.
        const mine: Indicator = {
            label: 'Mine',
            parameters: [Params.integer('periodBars').called('Period')],
            compute: () => ({ series: [] }),
        };

        renderKnobs(mine);

        expect(screen.getByLabelText('Period')).toBeTruthy();
    });

    it('falls back to a key built from its name, for the ones this build ships', () => {
        // The nineteen shipped readings name nothing and are labelled from the
        // dictionary, which is what keeps them translated.
        const shipped: Indicator = {
            label: 'Shipped',
            parameters: [{ name: 'periodBars', kind: 'integer', defaultValue: 20, minimum: 2, maximum: 400 }],
            compute: () => ({ series: [] }),
        };

        renderKnobs(shipped);

        expect(screen.getByLabelText('Bars')).toBeTruthy();
    });

    it('renders a phrase no dictionary has, as written', () => {
        const mine: Indicator = {
            label: 'Mine',
            parameters: [Params.decimal('wobble').called('How much it wobbles')],
            compute: () => ({ series: [] }),
        };

        renderKnobs(mine);

        expect(screen.getByLabelText('How much it wobbles')).toBeTruthy();
    });
});
