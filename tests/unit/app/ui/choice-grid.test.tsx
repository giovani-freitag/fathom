import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Choice } from '../../../../src/app/ui/choice.ts';
import { ChoiceGrid } from '../../../../src/app/ui/choice-grid.tsx';
import { CONTROL_HEIGHT } from '../../../../src/app/ui/control-shell.ts';

const CHOICES: readonly Choice[] = [
    { value: 'one', label: 'One' },
    { value: 'two', label: 'Two', detail: '2' },
    { value: 'three', label: 'Three', isDisabled: true, title: 'Not yet' },
];

function renderGrid(isStacked: boolean): string[] {
    const chosen: string[] = [];
    render(
        <ChoiceGrid
            label="Numbers"
            value="one"
            choices={CHOICES}
            isStacked={isStacked}
            onChoose={(value) => { chosen.push(value); }}
        />,
    );
    return chosen;
}

describe('ChoiceGrid', () => {
    it('shows every choice at once, which is what a panel has the room for', () => {
        renderGrid(false);

        expect(screen.getAllByRole('radio')).toHaveLength(CHOICES.length);
    });

    it('marks the one in force without anything being touched', () => {
        renderGrid(false);

        expect(screen.getByRole('radio', { name: 'One' }).getAttribute('aria-checked')).toBe('true');
    });

    it('answers with the value that was pressed', () => {
        const chosen = renderGrid(false);

        screen.getByRole('radio', { name: /Two/ }).click();

        expect(chosen).toEqual(['two']);
    });

    it('says why a choice cannot be picked, for the reader who tries', () => {
        renderGrid(false);

        const refused = screen.getByRole('radio', { name: 'Three' });

        expect([refused.hasAttribute('disabled'), refused.getAttribute('title')]).toEqual([true, 'Not yet']);
    });

    it('draws a chip at the one control height, like everything else pressed', () => {
        // Written once because it was written four ways in one bar, and a row of
        // controls at four heights reads as assembled rather than designed.
        renderGrid(false);

        expect(screen.getByRole('radio', { name: 'One' }).className).toContain(CONTROL_HEIGHT);
    });

    it('draws a choice on a line of its own at that same height', () => {
        renderGrid(true);

        expect(screen.getByRole('radio', { name: 'One' }).className).toContain(CONTROL_HEIGHT);
    });

    it('sets the figure a choice is about beside its label', () => {
        renderGrid(false);

        expect(screen.getByRole('radio', { name: /Two/ }).textContent).toContain('2');
    });
});
