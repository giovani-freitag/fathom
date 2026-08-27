import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { type ReactElement } from 'react';
import { createIndicatorKernel, renderWithKernel } from '../../../mocks/indicator-kernel.tsx';
import { EN_DICTIONARY } from '../../../../src/app/i18n/dictionaries/en.ts';
import { SettingsDrawer } from '../../../../src/app/ui/settings-drawer.tsx';

function renderDrawer(): void {
    function Harness(): ReactElement {
        return <SettingsDrawer isOpen onOpenChange={() => undefined} />;
    }

    renderWithKernel(createIndicatorKernel([]), <Harness />);
}

describe('SettingsDrawer', () => {
    it('carries what the chart looks like', () => {
        renderDrawer();

        expect(screen.getByText(EN_DICTIONARY['settings.appearance'])).toBeDefined();
    });

    it('carries no second list of the layers on the chart', () => {
        // Two lists of one thing, answering to different controls, is a reader
        // wondering which of them is the real one.
        renderDrawer();

        expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull();
    });

    it('offers no way to add a layer either', () => {
        renderDrawer();

        expect(screen.queryByRole('searchbox')).toBeNull();
    });
});
