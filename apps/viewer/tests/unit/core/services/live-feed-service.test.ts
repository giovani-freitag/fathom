import { LiveFeedService, type LiveFeedStatus } from '@core/services/live-feed/live-feed-service';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface SocketStub {
    readonly url: string;
    binaryType: string;
    readyState: number;
    close: ReturnType<typeof vi.fn>;
    addEventListener: (type: string, handler: (event: unknown) => void) => void;
    removeEventListener: (type: string, handler: (event: unknown) => void) => void;
    emit: (type: string, event?: unknown) => void;
}

const openSockets: SocketStub[] = [];

function installSocketStub(): void {
    class StubSocket {
        static readonly OPEN = 1;
        readonly OPEN = 1;
        readonly url: string;
        binaryType = '';
        readyState = 1;
        readonly close = vi.fn();
        private readonly handlers = new Map<string, ((event: unknown) => void)[]>();

        constructor(url: URL | string) {
            this.url = String(url);
            openSockets.push(this);
        }

        addEventListener(type: string, handler: (event: unknown) => void): void {
            this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
        }

        removeEventListener(type: string, handler: (event: unknown) => void): void {
            this.handlers.set(type, (this.handlers.get(type) ?? []).filter((h) => h !== handler));
        }

        emit(type: string, event: unknown = {}): void {
            for (const handler of [...(this.handlers.get(type) ?? [])]) {
                handler(event);
            }
        }
    }
    vi.stubGlobal('WebSocket', StubSocket);
}

function buildSubscription(statuses: LiveFeedStatus[]) {
    return {
        instrumentSymbol: 'BTCUSDT',
        afterMs: 1_000,
        onFrames: vi.fn(),
        onText: vi.fn(),
        onStatusChanged: (status: LiveFeedStatus) => statuses.push(status),
    };
}

describe('LiveFeedService', () => {
    beforeEach(() => {
        openSockets.length = 0;
        installSocketStub();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('resumes strictly after the instant the viewer already holds', () => {
        const service = new LiveFeedService({ baseUrl: 'http://gateway.test' });

        service.connect(buildSubscription([]));

        expect(openSockets[0]?.url).toContain('afterMs=1000');
    });

    it('speaks the socket scheme, not the page one', () => {
        const service = new LiveFeedService({ baseUrl: 'http://gateway.test' });

        service.connect(buildSubscription([]));

        expect(openSockets[0]?.url.startsWith('ws://')).toBe(true);
    });

    it('reports streaming once the socket opens', () => {
        const statuses: LiveFeedStatus[] = [];
        const service = new LiveFeedService({ baseUrl: 'http://gateway.test' });
        service.connect(buildSubscription(statuses));

        openSockets[0]?.emit('open');

        expect(statuses).toContain('streaming');
    });

    it('reconnects after a transient close', async () => {
        const service = new LiveFeedService({ baseUrl: 'http://gateway.test' });
        service.connect(buildSubscription([]));

        openSockets[0]?.emit('close', new CloseEvent('close', { code: 1006 }));
        await vi.advanceTimersByTimeAsync(2_000);

        expect(openSockets.length).toBe(2);
    });

    it('stops retrying when the gateway refuses on policy', async () => {
        const service = new LiveFeedService({ baseUrl: 'http://gateway.test' });
        service.connect(buildSubscription([]));

        openSockets[0]?.emit('close', new CloseEvent('close', { code: 1008 }));
        await vi.advanceTimersByTimeAsync(30_000);

        expect(openSockets.length).toBe(1);
    });

    it('says it was refused rather than pretending to reconnect', async () => {
        const statuses: LiveFeedStatus[] = [];
        const service = new LiveFeedService({ baseUrl: 'http://gateway.test' });
        service.connect(buildSubscription(statuses));

        openSockets[0]?.emit('close', new CloseEvent('close', { code: 1008 }));
        await vi.advanceTimersByTimeAsync(1_000);

        expect(statuses.at(-1)).toBe('refused');
    });

    it('opens no further sockets once disconnected', async () => {
        const service = new LiveFeedService({ baseUrl: 'http://gateway.test' });
        service.connect(buildSubscription([]));

        service.disconnect();
        await vi.advanceTimersByTimeAsync(30_000);

        expect(openSockets.length).toBe(1);
    });
});
