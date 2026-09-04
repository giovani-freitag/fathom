import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { ConfirmDialog } from '../../../../src/app/ui/confirm-dialog.tsx';
import { createIndicatorKernel, renderWithKernel } from '../../../mocks/indicator-kernel.tsx';

function renderDialog(isOpen: boolean, done: string[], closed: boolean[]) {
    renderWithKernel(
        createIndicatorKernel([]),
        <ConfirmDialog
            isOpen={isOpen}
            onOpenChange={(next) => { closed.push(next); }}
            title="Delete this reading?"
            body="It goes for good."
            confirmLabel="Delete"
            onConfirm={() => { done.push('done'); }}
        />,
    );
}

describe('asking before something that cannot be taken back', () => {
    it('says what is being destroyed, not just that something is', () => {
        renderDialog(true, [], []);

        expect(screen.getByText('Delete this reading?')).toBeTruthy();
        expect(screen.getByText('It goes for good.')).toBeTruthy();
    });

    it('does the thing only when the reader says so', () => {
        const done: string[] = [];

        renderDialog(true, done, []);

        expect(done).toEqual([]);
        fireEvent.click(screen.getByText('Delete'));
        expect(done).toEqual(['done']);
    });

    it('offers keeping it as the answer that is not destructive', () => {
        const done: string[] = [];
        const closed: boolean[] = [];

        renderDialog(true, done, closed);
        fireEvent.click(screen.getByText('Keep it'));

        expect(done).toEqual([]);
        expect(closed).toContain(false);
    });

    it('asks nothing while it is closed', () => {
        renderDialog(false, [], []);

        expect(screen.queryByText('Delete this reading?')).toBeNull();
    });
});
