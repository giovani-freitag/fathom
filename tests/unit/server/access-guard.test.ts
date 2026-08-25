import type { FastifyReply, FastifyRequest } from 'fastify';
import { AccessGuard } from '../../../src/server/services/access-guard.ts';
import { describe, expect, it, vi } from 'vitest';

const TOKEN = 'a-token-long-enough-to-matter';

interface ReplyStub {
    readonly reply: FastifyReply;
    readonly setCookie: ReturnType<typeof vi.fn>;
    readonly redirect: ReturnType<typeof vi.fn>;
    readonly code: ReturnType<typeof vi.fn>;
    readonly send: ReturnType<typeof vi.fn>;
    readonly type: ReturnType<typeof vi.fn>;
}

function createReply(): ReplyStub {
    const setCookie = vi.fn();
    const redirect = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue(undefined);
    const type = vi.fn();
    const code = vi.fn();
    const reply = { setCookie, redirect, code, send, type } as unknown as FastifyReply;
    code.mockReturnValue(reply);
    type.mockReturnValue(reply);
    return { reply, setCookie, redirect, code, send, type };
}

function createRequest(options: {
    url?: string;
    query?: Record<string, unknown>;
    cookies?: Record<string, string>;
    accept?: string;
} = {}): FastifyRequest {
    return {
        url: options.url ?? '/',
        query: options.query ?? {},
        cookies: options.cookies ?? {},
        headers: { accept: options.accept ?? '' },
    } as unknown as FastifyRequest;
}

function buildGuard(accessToken = TOKEN): AccessGuard {
    return new AccessGuard({ accessToken, isTunnelled: false });
}

describe('AccessGuard when no token is configured', () => {
    it('leaves every route open', async () => {
        const reply = createReply();

        await buildGuard('').protect(createRequest(), reply.reply);

        expect(reply.code).not.toHaveBeenCalled();
    });

    it('reports itself as disabled', () => {
        expect(buildGuard('').isEnabled).toBe(false);
    });
});

describe('AccessGuard with a token', () => {
    it('refuses a request carrying nothing', async () => {
        const reply = createReply();

        await buildGuard().protect(createRequest(), reply.reply);

        expect(reply.code).toHaveBeenCalledWith(401);
    });

    it('refuses a wrong token without hinting how wrong', async () => {
        const reply = createReply();

        await buildGuard().protect(createRequest({ query: { token: 'nope' } }), reply.reply);

        expect(reply.code).toHaveBeenCalledWith(401);
    });

    it('refuses a cookie that only shares a prefix', async () => {
        const reply = createReply();

        await buildGuard().protect(
            createRequest({ cookies: { fathom_access: TOKEN.slice(0, -1) } }),
            reply.reply,
        );

        expect(reply.code).toHaveBeenCalledWith(401);
    });

    it('trades a correct token for a cookie', async () => {
        const reply = createReply();

        await buildGuard().protect(createRequest({ query: { token: TOKEN } }), reply.reply);

        expect(reply.setCookie).toHaveBeenCalledWith('fathom_access', TOKEN, expect.objectContaining({
            httpOnly: true,
            path: '/',
        }));
    });

    it('redirects so the token leaves the address bar', async () => {
        const reply = createReply();

        await buildGuard().protect(createRequest({ query: { token: TOKEN } }), reply.reply);

        expect(reply.redirect).toHaveBeenCalledWith('/', 303);
    });

    it('lets a request with the cookie through untouched', async () => {
        const reply = createReply();

        await buildGuard().protect(createRequest({ cookies: { fathom_access: TOKEN } }), reply.reply);

        expect([reply.code.mock.calls.length, reply.redirect.mock.calls.length]).toEqual([0, 0]);
    });

    it('answers the health probe without a token, so a tunnel can be checked', async () => {
        const reply = createReply();

        await buildGuard().protect(createRequest({ url: '/api/health' }), reply.reply);

        expect(reply.code).not.toHaveBeenCalled();
    });

    it('still guards a route whose name merely starts like the probe', async () => {
        const reply = createReply();

        await buildGuard().protect(createRequest({ url: '/api/healthy-secrets' }), reply.reply);

        expect(reply.code).toHaveBeenCalledWith(401);
    });

    it('answers a browser with a page it can read', async () => {
        const reply = createReply();

        await buildGuard().protect(createRequest({ accept: 'text/html,*/*' }), reply.reply);

        expect(reply.type).toHaveBeenCalledWith('text/html; charset=utf-8');
    });

    it('answers a program with json', async () => {
        const reply = createReply();

        await buildGuard().protect(createRequest({ accept: 'application/json' }), reply.reply);

        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'Unauthorized' }));
    });

    it('marks the cookie Secure when it is reached through a tunnel', async () => {
        const reply = createReply();
        const guard = new AccessGuard({ accessToken: TOKEN, isTunnelled: true });

        await guard.protect(createRequest({ query: { token: TOKEN } }), reply.reply);

        expect(reply.setCookie).toHaveBeenCalledWith('fathom_access', TOKEN,
            expect.objectContaining({ secure: true }));
    });
});
