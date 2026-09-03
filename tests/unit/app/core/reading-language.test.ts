import { afterEach, describe, expect, it } from 'vitest';
import type { AppearanceState } from '../../../../src/app/core/appearance-controller.ts';
import { DEFAULT_LOCALE, type Locale, speakIn } from '../../../../src/shared/core/reading-words.ts';
import { findAddon, forgetAddon } from '../../../../src/app/addons/addon-registry.ts';
import { ObservableStore } from '../../../../src/app/core/observable-store.ts';
import { rebuildReadingsOnLanguageChange } from '../../../../src/app/core/service-container.ts';
import type { SavedReading } from '../../../../src/app/services/addon-library/addon-library-service.ts';

/** A reading whose name is written in both languages the page speaks. */
const NAMED_IN_BOTH = `
const fathom = require('fathom');
exports.default = {
    label: fathom.inWords({ en: 'My mean', 'pt-BR': 'Minha média' }),
    parameters: [],
    compute: () => ({ series: [] }),
};
`;

const SAVED: SavedReading = {
    key: 'mine',
    name: 'Mine',
    source: '',
    compiled: NAMED_IN_BOTH,
    savedAtMs: 0,
};

function watchWith(locale: Locale) {
    const store = new ObservableStore<AppearanceState>({
        initialState: {
            locale,
            themeChoice: 'dark',
            resolvedTheme: 'dark',
            isLegendCollapsed: false,
            gridChoice: 'both',
        },
    });
    const redraws: number[] = [];

    rebuildReadingsOnLanguageChange({
        appearance: { store },
        addons: { list: () => [SAVED] },
        chart: { updateIndicators: () => { redraws.push(1); } },
    });

    return { store, redraws };
}

afterEach(() => {
    forgetAddon('addon:mine');
    speakIn(DEFAULT_LOCALE);
});

describe('a reading that names itself in the reader language', () => {
    it('is built again when the reader changes language', () => {
        const { store } = watchWith('en');

        speakIn('pt-BR');
        store.update((state) => ({ ...state, locale: 'pt-BR' }));

        expect(findAddon('addon:mine')?.label).toBe('Minha média');
    });

    it('is redrawn, since the name is read off while the chart draws it', () => {
        const { store, redraws } = watchWith('en');

        speakIn('pt-BR');
        store.update((state) => ({ ...state, locale: 'pt-BR' }));

        expect(redraws).toHaveLength(1);
    });

    it('is left alone when something else about the page changes', () => {
        // The appearance carries the theme too, and rebuilding every reading
        // on a theme change is a redraw of the whole chart for nothing.
        const { store, redraws } = watchWith('en');

        store.update((state) => ({ ...state, themeChoice: 'light', resolvedTheme: 'light' }));

        expect(redraws).toEqual([]);
    });
});
