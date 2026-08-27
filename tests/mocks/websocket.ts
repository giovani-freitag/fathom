import type { WebSocket } from '@fastify/websocket';

/** The one ready state a live socket cares about. */
export const SOCKET_OPEN = 1;

export interface FakeSocket extends WebSocket {
    readonly sent: unknown[];
    readonly closures: { code: number; reason: string }[];
    fire: (event: string) => void;
    setReadyState: (state: number) => void;
}

/**
 * A socket that keeps what it was sent and how it was closed.
 *
 * @returns A fresh open socket.
 */
export function openFakeSocket(): FakeSocket {
    const listeners: Record<string, (() => void)[]> = {};
    const sent: unknown[] = [];
    const closures: { code: number; reason: string }[] = [];
    let readyState = SOCKET_OPEN;

    return {
        OPEN: SOCKET_OPEN,
        get readyState() { return readyState; },
        send: (payload: unknown) => { sent.push(payload); },
        close: (code: number, reason: string) => { closures.push({ code, reason }); },
        on: (event: string, handler: () => void) => { (listeners[event] ??= []).push(handler); },
        off: (event: string, handler: () => void) => {
            listeners[event] = (listeners[event] ?? []).filter((existing) => existing !== handler);
        },
        sent,
        closures,
        fire: (event: string) => { for (const handler of listeners[event] ?? []) { handler(); } },
        setReadyState: (state: number) => { readyState = state; },
    } as unknown as FakeSocket;
}
