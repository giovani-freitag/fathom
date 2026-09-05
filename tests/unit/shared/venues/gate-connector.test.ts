import { describe, expect, it } from 'vitest';
import { findContradictions } from '../../../../src/shared/core/venue-connector.ts';
import { GATE_CONNECTOR } from '../../../../src/shared/venues/gate-connector.ts';

const ASKED = {
    symbol: 'BTC_USDT',
    widthMs: 60_000,
    fromMs: 1_788_621_900_000,
    toMs: 1_788_622_020_000,
    limit: 1_000,
};

/** Two candles in the venue's own order: the quote volume, then close, high, low, open. */
const CANDLES = [
    ['1788621900', '207733.76', '79762.8', '79770.0', '79756.8', '79756.9', '2.604471', 'true'],
    ['1788621960', '78388.01', '79767', '79767.1', '79764.2', '79764.2', '0.982743', 'false'],
];

describe('the connector for a venue that sends close before open', () => {
    it('declares what it reads and reads what it declares', () => {
        expect(findContradictions(GATE_CONNECTOR)).toEqual([]);
    });

    it('reads the venue\'s field order, which is nobody else\'s', () => {
        // Close, high, low, open — with the volume in the quote currency in
        // front of all four. Read as the usual order the open becomes a
        // turnover of two hundred thousand and the chart draws a wall.
        const [bar] = GATE_CONNECTOR.readBars(CANDLES, ASKED);

        expect(bar?.openPrice).toBe(79_756.9);
        expect(bar?.highPrice).toBe(79_770);
        expect(bar?.lowPrice).toBe(79_756.8);
        expect(bar?.closePrice).toBe(79_762.8);
    });

    it('counts the volume in the base currency, which is what the chart counts in', () => {
        const [bar] = GATE_CONNECTOR.readBars(CANDLES, ASKED);

        expect(bar?.volume).toBe(2.604471);
    });

    it('reads the instant as seconds, and keeps the venue\'s own order of bars', () => {
        const page = GATE_CONNECTOR.readBars(CANDLES, ASKED);

        expect(page.map((bar) => bar.openedAtMs)).toEqual([1_788_621_900_000, 1_788_621_960_000]);
    });

    it('turns a count of decimals into the step it stands for', () => {
        const listed = GATE_CONNECTOR.readInstruments([
            { id: 'BTC_USDT', base: 'BTC', quote: 'USDT', precision: 6, trade_status: 'tradable' },
        ]);

        expect(listed[0]?.priceStep).toBeCloseTo(0.000001, 12);
        expect(listed[0]?.isTrading).toBe(true);
    });

    it('reads an update by the range it covers', () => {
        const diff = GATE_CONNECTOR.readUpdate({
            time: 1_788_622_241,
            channel: 'spot.order_book_update',
            event: 'update',
            result: {
                t: 1_788_622_241_515,
                s: 'BTC_USDT',
                U: 39_609_137_666,
                u: 39_609_137_685,
                b: [['79695.6', '0.013175']],
                a: [],
            },
        });

        expect(diff?.firstUpdateId).toBe(39_609_137_666);
        expect(diff?.finalUpdateId).toBe(39_609_137_685);
        expect(diff?.previousFinalUpdateId).toBe(39_609_137_665);
    });

    it('says nothing about the venue\'s answer to the subscription itself', () => {
        expect(GATE_CONNECTOR.readUpdate({
            channel: 'spot.order_book_update',
            event: 'subscribe',
            result: { status: 'success' },
        })).toBeNull();
    });

    it('reads the ladder by the id the venue only sends when asked', () => {
        const snapshot = GATE_CONNECTOR.readSnapshot({
            id: 39_609_067_492,
            asks: [['79767.1', '0.174204']],
            bids: [['79767', '0.385461']],
        });

        expect(snapshot.lastUpdateId).toBe(39_609_067_492);
        expect(GATE_CONNECTOR.planSnapshot('BTC_USDT').url).toContain('with_id=true');
    });

    it('subscribes without stamping the request, because it holds no clock', () => {
        const plan = GATE_CONNECTOR.planStream('BTC_USDT', '');

        expect(plan.greetings?.join(' ')).not.toContain('"time"');
        expect(plan.greetings).toHaveLength(2);
    });
});
