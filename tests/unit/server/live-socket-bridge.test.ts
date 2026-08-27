import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFrame, buildWindow } from '../../mocks/chart-services.ts';
import type { LiveTailService, LiveTailSubscriptionRequest } from '../../../src/server/services/live-tail-service.ts';
import { LiveSocketBridge } from '../../../src/server/services/live-socket-bridge.ts';
import { type FakeSocket, openFakeSocket } from '../../mocks/websocket.ts';

describe('LiveSocketBridge', () => {
    let socket: FakeSocket;
    let subscription: LiveTailSubscriptionRequest | null;
    let unsubscribe: ReturnType<typeof vi.fn>;
    let subscribe: ReturnType<typeof vi.fn>;

    function buildBridge(): LiveSocketBridge {
        return new LiveSocketBridge({
            socket,
            liveTail: { subscribe } as unknown as LiveTailService,
            instrumentSymbol: 'BTCUSDT',
            afterMs: 1_000,
            priceBucketSize: 10,
        });
    }

    beforeEach(() => {
        socket = openFakeSocket();
        subscription = null;
        unsubscribe = vi.fn();
        subscribe = vi.fn((request: LiveTailSubscriptionRequest) => {
            subscription = request;
            return unsubscribe;
        });
    });

    it('passes the grid on, so the tail can announce what it is following', () => {
        buildBridge().start();

        expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({
            instrumentSymbol: 'BTCUSDT', afterMs: 1_000, priceBucketSize: 10,
        }));
    });

    it('writes a window of frames as bytes and every other message as text', () => {
        // Two typed arrays a column, which JSON would send as digits; the type
        // is one either way, so only the encoding differs.
        buildBridge().start();

        subscription!.onMessage({ kind: 'frames', window: buildWindow([buildFrame(2_000)]) });
        subscription!.onMessage({ kind: 'stalled', lastFrameAtMs: 2_000 });

        expect(Buffer.isBuffer(socket.sent[0])).toBe(true);
        expect(JSON.parse(socket.sent[1] as string)).toMatchObject({ kind: 'stalled' });
    });

    it('refuses the socket rather than throwing when the tail will not take it', () => {
        // The gateway caps concurrent tails; a refusal has to reach the reader
        // as a close code, not as an unhandled error inside a route handler.
        subscribe.mockImplementation(() => { throw new Error('Too many live tails'); });

        buildBridge().start();

        expect(socket.closures).toEqual([{ code: 1013, reason: 'Too many live tails' }]);
        expect(socket.sent).toEqual([]);
    });

    it('lets go of the tail when the reader closes the page', () => {
        buildBridge().start();

        socket.fire('close');

        expect(unsubscribe).toHaveBeenCalled();
    });

    it('writes nothing into a socket that is no longer open', () => {
        // A frame arriving between the close and the unsubscribe would
        // otherwise throw inside the tail and take the other readers with it.
        const bridge = buildBridge();
        bridge.start();
        const sentBefore = socket.sent.length;
        socket.setReadyState(3);

        subscription!.onMessage({ kind: 'frames', window: buildWindow([buildFrame(2_000)]) });

        expect(socket.sent).toHaveLength(sentBefore);
    });

    it('detaches from the socket when it is stopped, so a later close is nobody s', () => {
        const bridge = buildBridge();
        bridge.start();

        bridge.stop();
        socket.fire('close');

        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
});
