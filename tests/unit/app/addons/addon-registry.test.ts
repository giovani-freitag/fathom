import { afterEach, describe, expect, it } from 'vitest';
import {
    ADDON_ID_PREFIX,
    findAddon,
    forgetAddon,
    isAddonId,
    listAddons,
    registerAddon,
} from '../../../../src/app/addons/addon-registry.ts';
import { findChartLayer, findIndicator, listOfferedLayers } from '../../../../src/app/indicators/indicator-catalogue.ts';
import type { Indicator } from '../../../../src/shared/core/draw-plan.ts';

const MINE: Indicator = {
    label: 'My mean',
    parameters: [],
    compute: () => ({ series: [] }),
};

const registered: string[] = [];

function register(name: string, indicator: Indicator = MINE): string {
    const id = registerAddon(name, indicator);
    registered.push(id);
    return id;
}

afterEach(() => {
    registered.splice(0).forEach(forgetAddon);
});

describe('a reading a reader wrote', () => {
    it('is found by the same lookup the shipped ones are', () => {
        const id = register('mine');

        expect(findIndicator(id)).toBe(MINE);
        expect(findChartLayer(id)).toBe(MINE);
    });

    it('cannot claim a name the build ships under', () => {
        // The prefix is reserved, so however a reader names their reading it
        // lands somewhere no shipped one can be.
        const id = register('delta');

        expect(id).not.toBe('delta');
        expect(findIndicator('delta')).not.toBe(MINE);
    });

    it('replaces the one before it under the same name', () => {
        const replacement: Indicator = { ...MINE, label: 'Second try' };
        register('mine');

        register('mine', replacement);

        expect(findIndicator(`${ADDON_ID_PREFIX}mine`)).toBe(replacement);
        expect(listAddons()).toHaveLength(1);
    });

    it('is offered in the palette alongside what the build ships', () => {
        const id = register('mine');

        const offered = listOfferedLayers().map((entry) => entry.id);

        expect(offered).toContain(id);
        expect(offered).toContain('sma');
    });

    it('leaves nothing behind once it is forgotten', () => {
        const id = registerAddon('mine', MINE);

        forgetAddon(id);

        expect(findAddon(id)).toBeNull();
        expect(listOfferedLayers().map((entry) => entry.id)).not.toContain(id);
    });

    it('is told apart from a shipped one by its id alone', () => {
        expect(isAddonId(register('mine'))).toBe(true);
        expect(isAddonId('sma')).toBe(false);
    });
});

describe('what the chart does with a reading it no longer has', () => {
    it('finds nothing rather than the wrong thing', () => {
        // A stored selection outlives the script that produced it, so a reload
        // with nothing loaded has to resolve to nothing.
        expect(findIndicator(`${ADDON_ID_PREFIX}gone`)).toBeNull();
    });
});
