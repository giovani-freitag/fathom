import { describe, expect, it } from 'vitest';
import { OrderBookState } from '../../../../src/services/order-book/order-book-state.ts';

describe('OrderBookState', () => {
    it('collapses different decimal formattings of one price onto a single level', () => {
        const state = new OrderBookState();

        state.replaceWith([['78945.10', '3']], [['78950.0', '1']]);
        state.applyDelta([['78945.1', '5']], []);

        expect([...state.bidLevels.entries()]).toEqual([[78_945.1, 5]]);
    });

    it('removes a level when an update carries a zero quantity', () => {
        const state = new OrderBookState();

        state.replaceWith([['100', '3'], ['99', '2']], [['101', '1']]);
        state.applyDelta([['100', '0']], []);

        expect(state.bidLevels.has(100)).toBe(false);
    });

    it('discards everything outside a snapshot when replacing', () => {
        const state = new OrderBookState();

        state.replaceWith([['100', '3']], [['101', '1']]);
        state.replaceWith([['90', '4']], [['91', '2']]);

        expect(state.levelCount).toBe(2);
    });

    it('resolves the touch from the extremes of each side', () => {
        const state = new OrderBookState();

        state.replaceWith([['99', '1'], ['100', '2'], ['98', '3']], [['103', '1'], ['101', '2']]);

        expect(state.resolveTopOfBook()).toEqual({ bestBidPrice: 100, bestAskPrice: 101 });
    });

    it('reports no touch while a side is empty', () => {
        const state = new OrderBookState();

        state.replaceWith([['100', '1']], []);

        expect(state.resolveTopOfBook()).toBeNull();
    });

    it('reports no touch while the book is crossed', () => {
        const state = new OrderBookState();

        state.replaceWith([['102', '1']], [['101', '1']]);

        expect(state.resolveTopOfBook()).toBeNull();
    });
});

describe('OrderBookState.mergeWithinLadderSpan', () => {
    it('replaces levels the ladder covers', () => {
        const state = new OrderBookState();
        state.replaceWith([['100', '1'], ['99', '1']], [['101', '1']]);

        state.mergeWithinLadderSpan([['100', '9'], ['99', '9']], [['101', '9']]);

        expect(state.bidLevels.get(100)).toBe(9);
    });

    it('drops a level the ladder no longer lists inside its own span', () => {
        const state = new OrderBookState();
        state.replaceWith([['100', '1'], ['99', '1'], ['98', '1']], [['101', '1']]);

        state.mergeWithinLadderSpan([['100', '5'], ['98', '5']], [['101', '1']]);

        expect(state.bidLevels.has(99)).toBe(false);
    });

    it('keeps deep levels the ladder never reached', () => {
        const state = new OrderBookState();
        state.replaceWith([['100', '1'], ['50', '7']], [['101', '1']]);

        state.mergeWithinLadderSpan([['100', '2'], ['99', '2']], [['101', '2']]);

        expect(state.bidLevels.get(50)).toBe(7);
    });

    it('leaves the book untouched when the ladder is empty', () => {
        const state = new OrderBookState();
        state.replaceWith([['100', '1']], [['101', '1']]);

        state.mergeWithinLadderSpan([], []);

        expect(state.levelCount).toBe(2);
    });
});

describe('OrderBookState.pruneBeyond', () => {
    it('drops levels further than the distance from the reference', () => {
        const state = new OrderBookState();
        state.replaceWith([['100', '1'], ['80', '1']], [['101', '1'], ['130', '1']]);

        const prunedCount = state.pruneBeyond(100, 10);

        expect(prunedCount).toBe(2);
    });

    it('keeps levels exactly on the boundary', () => {
        const state = new OrderBookState();
        state.replaceWith([['90', '1']], [['110', '1']]);

        state.pruneBeyond(100, 10);

        expect(state.levelCount).toBe(2);
    });
});
