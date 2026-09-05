import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    CONTROL_BAR_CLASSES,
    CONTROL_CHIP_CLASSES,
    CONTROL_HEIGHT,
    CONTROL_INPUT_CLASSES,
    FLOATING_CARD_CLASSES,
    FLOATING_SURFACE_CLASSES,
} from '../../../../src/app/ui/control-shell.ts';

const UI_ROOT = join(process.cwd(), 'src', 'app', 'ui');

/** Every component of the interface, wherever in the folder it sits. */
function listComponents(root: string): string[] {
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
        const path = join(root, entry.name);
        if (entry.isDirectory()) {
            return listComponents(path);
        }
        return entry.name.endsWith('.tsx') ? [path] : [];
    });
}

describe('control-shell', () => {
    it('gives every control the reader presses the same height', () => {
        expect(CONTROL_CHIP_CLASSES).toContain(CONTROL_HEIGHT);
    });

    it('gives a field the reader types into that same height', () => {
        expect(CONTROL_INPUT_CLASSES).toContain(CONTROL_HEIGHT);
    });

    it('makes every floating shell out of the same material', () => {
        // The shape is each one's own; the hairline, the ground and the blur
        // are not, or the chart looks like it is wearing three interfaces.
        expect(FLOATING_CARD_CLASSES).toContain(FLOATING_SURFACE_CLASSES);
    });

    it('gives a bar of controls the same shell top or bottom', () => {
        // The header and the dock ask the same questions in the same shapes;
        // one of them styled by hand is the one that drifts.
        expect(CONTROL_BAR_CLASSES).toContain('overflow-x-auto');
    });

    it('is the only place the floating ground is named', () => {
        // Written once because it had drifted: a panel at full opacity beside
        // one at ninety-five per cent, a blur beside a smaller blur.
        const named = listComponents(UI_ROOT)
            .filter((path) => readFileSync(path, 'utf8').includes('bg-abyss-800/95'));

        expect(named).toEqual([]);
    });

    it('is the only place a control in force names its colours', () => {
        // The tint on its own says "this is the one"; the same tint on hover
        // says something else and is left alone. A component that names the
        // first is one that will be left behind when it changes.
        const named = listComponents(UI_ROOT)
            .filter((path) => /(?<!hover:)bg-phosphor\/12/.test(readFileSync(path, 'utf8')));

        expect(named).toEqual([]);
    });
});

describe('a bar of controls that does not fit', () => {
    it('never hides its scrollbar without saying there is more', () => {
        // The two decisions travel together or the bar lies: six of thirteen
        // tools sat off the edge of a phone behind a row that looked complete.
        const hidesTheScrollbar = CONTROL_BAR_CLASSES.includes('scrollbar-width:none');

        expect(hidesTheScrollbar && !CONTROL_BAR_CLASSES.includes('edge-fade')).toBe(false);
    });

    it('fades its edges with a rule that is actually written down', () => {
        // This used to read the gradient out of the class string, and passed
        // while nothing was faded at all: the value was long enough to be split
        // across two literals in the source, and Tailwind scans the source
        // rather than the string the source builds. So it generated no rule,
        // and the assertion never knew. Naming a class is only half the claim —
        // the other half is that something defines it.
        const styles = readFileSync(join(import.meta.dirname, '../../../../src/app/styles/theme.css'), 'utf8');
        const rule = styles.split('.edge-fade {')[1]?.split('}')[0] ?? '';

        expect(CONTROL_BAR_CLASSES).toContain('edge-fade');
        expect(rule).toContain('mask-image');
        expect(rule).toContain('transparent');
    });
});
