import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServerHarness, type ServerHarness } from '../../mocks/server-harness.ts';

const ACCESS_TOKEN = 'a-shared-secret';

describe('a guarded gateway', () => {
    let harness: ServerHarness;

    beforeEach(() => {
        harness = createServerHarness({}, { accessToken: ACCESS_TOKEN });
    });

    afterEach(async () => { await harness.server.stop(); });

    it('refuses a request carrying nothing', async () => {
        const response = await harness.server.getApp().inject({ method: 'GET', url: '/api/instruments' });

        expect(response.statusCode).toBe(401);
    });

    it('asks the archive nothing for a request it refused', async () => {
        // Answered but still handled, an unauthenticated request costs a database
        // read apiece, which is a way in even when the reply says no.
        await harness.server.getApp().inject({ method: 'GET', url: '/api/instruments' });

        expect(harness.query.listInstruments).not.toHaveBeenCalled();
    });

    it('writes nothing for a change it refused', async () => {
        await harness.server.getApp().inject({
            method: 'PUT',
            url: '/api/recording',
            payload: { instrumentSymbol: 'BTCUSDT', priceBucketSize: 10, frameIntervalMs: 1_000, isEnabled: false },
        });

        expect(harness.control.saveContract).not.toHaveBeenCalled();
    });

    it('answers the health probe so a tunnel can be checked', async () => {
        const response = await harness.server.getApp().inject({ method: 'GET', url: '/api/health' });

        expect(response.statusCode).toBe(200);
    });

    it('lets a request carrying the cookie through', async () => {
        const response = await harness.server.getApp().inject({
            method: 'GET',
            url: '/api/instruments',
            cookies: { fathom_access: ACCESS_TOKEN },
        });

        expect(response.statusCode).toBe(200);
    });

    it('trades a token in the link for a cookie', async () => {
        const response = await harness.server.getApp().inject({
            method: 'GET',
            url: `/?token=${ACCESS_TOKEN}`,
        });

        expect(response.cookies).toContainEqual(expect.objectContaining({ name: 'fathom_access' }));
    });
});
