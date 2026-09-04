import { afterEach, describe, expect, it } from 'vitest';
import { forgetAddon, registerAddon } from '../../../../src/app/addons/addon-registry.ts';
import { createIndicatorKernel } from '../../../mocks/indicator-kernel.tsx';
import type { Indicator, PlanDraft } from '../../../../src/shared/core/draw-plan.ts';
import { readLayerDefaults } from '../../../../src/app/indicators/indicator-catalogue.ts';
import { withIndicatorAdded } from '../../../../src/shared/core/indicator-selection.ts';

const registered: string[] = [];

function register(name: string, indicator: Indicator): string {
    const id = registerAddon(name, indicator);
    registered.push(id);
    return id;
}

afterEach(() => { registered.splice(0).forEach(forgetAddon); });

/** A reading that fails in whichever way a test is about. */
function buildBroken(how: 'compute' | 'sources'): Indicator {
    return {
        label: 'Broken',
        parameters: [],
        resolveSources: () => {
            if (how === 'sources') {
                throw new Error('it broke declaring');
            }
            return {};
        },
        compute: (): PlanDraft => { throw new Error('it broke drawing'); },
    };
}

const SOUND: Indicator = {
    label: 'Sound',
    parameters: [],
    compute: (input): PlanDraft => ({
        series: [{
            label: 'Sound',
            tone: 'phosphor',
            shape: 'line',
            atMs: Float64Array.from(input.bars.bars.map((bar) => bar.closedAtMs)),
            value: Float64Array.from(input.bars.bars.map((bar) => bar.closePrice)),
        }],
    }),
};

function chartWith(...ids: readonly string[]) {
    const kernel = createIndicatorKernel([]);
    kernel.container.chart.updateIndicators((current) => ids.reduce(
        (added, indicatorId) => withIndicatorAdded({
            added,
            indicatorId,
            settings: readLayerDefaults({ label: '', parameters: [] }),
            tone: 'phosphor',
            isRepeatable: false,
        }),
        current,
    ));
    return kernel;
}

describe('a reading that throws while the chart draws it', () => {
    it('loses its own drawing and nothing else', () => {
        // The whole point of catching it. Uncaught, one reader's arithmetic
        // takes down the book, the candles and every other layer with it.
        const broken = register('broken', buildBroken('compute'));
        const sound = register('sound', SOUND);

        const kernel = chartWith(broken, sound, 'sma');

        expect(kernel.readPlans().map((plan) => plan.indicatorId)).toEqual([sound, 'sma']);
    });

    it('says why, against the copy it belongs to', () => {
        const broken = register('broken', buildBroken('compute'));

        const kernel = chartWith(broken);

        const [entry] = kernel.readAdded();
        expect(kernel.readFailures()[entry!.instanceId]).toBe('it broke drawing');
    });

    it('is caught while it declares what it reads, not only while it draws', () => {
        // `resolveSources` runs first and is a reader's code too.
        const broken = register('broken', buildBroken('sources'));

        const kernel = chartWith(broken, 'sma');

        expect(kernel.readPlans().map((plan) => plan.indicatorId)).toEqual(['sma']);
    });

    it('says nothing about a reading that drew perfectly well', () => {
        const sound = register('sound', SOUND);

        const kernel = chartWith(sound);

        expect(kernel.readFailures()).toEqual({});
    });

    it('stops saying so once the reading is fixed', () => {
        const broken = register('broken', buildBroken('compute'));
        const kernel = chartWith(broken);

        registerAddon('broken', SOUND);
        kernel.container.chart.updateIndicators((current) => [...current]);

        expect(kernel.readFailures()).toEqual({});
        expect(kernel.readPlans()).toHaveLength(1);
    });
});
