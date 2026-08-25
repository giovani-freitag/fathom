// The cookie accessors this guard uses are added to fastify by a plugin, so the
// declaration has to be pulled in explicitly wherever the plugin is not imported.
import type {} from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** Name of the cookie a visitor carries once the link has been opened. */
const COOKIE_NAME = 'fathom_access';

/** Paths that answer before the guard, so a tunnel can be probed without the token. */
const UNGUARDED_PATHS = new Set(['/api/health']);

const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface AccessGuardConfig {
    /** Secret the link carries; an empty value leaves every route open. */
    readonly accessToken: string;
    /** Marks the cookie Secure, which a browser only returns over https. */
    readonly isTunnelled: boolean;
}

/**
 * Trades a token in the link for a cookie, then requires that cookie.
 *
 * A cookie rather than a header because the browser cannot set headers on a
 * WebSocket handshake: the live tail would be the one route left unguarded.
 * Trading the token once also means the shared link carries the secret exactly
 * once instead of on every request in every log along the way.
 */
export class AccessGuard {
    private readonly config: AccessGuardConfig;

    constructor(config: AccessGuardConfig) {
        this.config = config;
        this.protect = this.protect.bind(this);
    }

    get isEnabled(): boolean {
        return this.config.accessToken.length > 0;
    }

    /**
     * Lets a request through, or answers it with a refusal.
     *
     * @param request - The incoming request.
     * @param reply - The reply to answer with when the request is refused.
     */
    async protect(request: FastifyRequest, reply: FastifyReply): Promise<void> {
        if (!this.isEnabled || UNGUARDED_PATHS.has(request.url.split('?')[0] ?? '')) {
            return;
        }

        const offeredToken = readOfferedToken(request);
        if (offeredToken !== null && this.matches(offeredToken)) {
            this.grant(reply);
            // Redirected rather than answered so the token leaves the address
            // bar, and so a shared screenshot cannot hand it to anyone else.
            await reply.redirect('/', 303);
            return;
        }

        if (this.matches(request.cookies[COOKIE_NAME] ?? '')) {
            return;
        }

        await this.refuse(request, reply);
    }

    /**
     * Answers a refusal in the shape the caller can read.
     *
     * A person opening a shared link in a browser gets a sentence; a program
     * gets JSON. Serving raw JSON to a browser turns "you need the full link"
     * into something that reads like the site is broken.
     */
    private async refuse(request: FastifyRequest, reply: FastifyReply): Promise<void> {
        const wantsHtml = (request.headers.accept ?? '').includes('text/html');
        if (!wantsHtml) {
            await reply.code(401).send({ error: 'Unauthorized', message: 'This chart needs an access link' });
            return;
        }

        await reply.code(401).type('text/html; charset=utf-8').send(REFUSAL_PAGE);
    }

    private grant(reply: FastifyReply): void {
        reply.setCookie(COOKIE_NAME, this.config.accessToken, {
            path: '/',
            httpOnly: true,
            sameSite: 'lax',
            secure: this.config.isTunnelled,
            maxAge: COOKIE_MAX_AGE_SECONDS,
        });
    }

    /**
     * Compares in constant time, so a wrong answer never reveals how wrong.
     */
    private matches(offered: string): boolean {
        const expected = this.config.accessToken;
        if (offered.length !== expected.length) {
            return false;
        }
        let difference = 0;
        for (let index = 0; index < expected.length; index += 1) {
            difference |= offered.charCodeAt(index) ^ expected.charCodeAt(index);
        }
        return difference === 0;
    }
}

function readOfferedToken(request: FastifyRequest): string | null {
    const query = request.query as Record<string, unknown>;
    const offered = query['token'];
    return typeof offered === 'string' && offered.length > 0 ? offered : null;
}

const REFUSAL_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Fathom</title>
<style>
  body { margin:0; min-height:100dvh; display:grid; place-items:center; background:#05080c;
         color:#dce7f1; font:15px/1.6 ui-monospace, "SF Mono", monospace; padding:2rem; }
  main { max-width:30rem; text-align:center; }
  h1 { font-size:1rem; letter-spacing:.24em; text-transform:uppercase; color:#35e0c4; margin:0 0 1.25rem; }
  p { color:#9db0c2; margin:0 0 .75rem; }
  code { color:#62778b; }
</style>
</head>
<body>
<main>
  <h1>Fathom</h1>
  <p>This chart needs the full access link.</p>
  <p><code>…/?token=…</code></p>
  <p>Ask whoever sent it for the link.</p>
</main>
</body>
</html>`;
