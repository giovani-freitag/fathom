import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ConfigurationError,
    readGatewayConfiguration,
} from '../../../src/server/core/gateway-configuration.ts';

/** Every variable the gateway reads, so a host's own settings cannot leak in. */
const GATEWAY_VARIABLES = [
    'DATABASE_URL',
    'GATEWAY_HOST',
    'GATEWAY_PORT',
    'VIEWER_DIST_PATH',
];

describe('readGatewayConfiguration', () => {
    beforeEach(() => {
        GATEWAY_VARIABLES.forEach((name) => { vi.stubEnv(name, ''); });
        vi.stubEnv('DATABASE_URL', 'postgres://fathom@localhost/fathom');
    });

    afterEach(() => { vi.unstubAllEnvs(); });

    it('runs on defaults when the environment says nothing', () => {
        const configuration = readGatewayConfiguration();

        expect(configuration).toEqual({
            host: '0.0.0.0',
            port: 8787,
            databaseUrl: 'postgres://fathom@localhost/fathom',
            viewerDistPath: 'dist/app',
        });
    });

    it('refuses to start with nowhere to read from', () => {
        vi.stubEnv('DATABASE_URL', '');

        expect(() => readGatewayConfiguration()).toThrow(ConfigurationError);
    });

    it('serves the built viewer rather than the whole working directory', () => {
        // Blank resolves to the process directory, and the gateway then serves
        // the project root — `.env`, the sources, everything — to anyone who
        // reaches the port.
        vi.stubEnv('VIEWER_DIST_PATH', '   ');

        expect(readGatewayConfiguration().viewerDistPath).toBe('dist/app');
    });

    it('listens on every interface rather than on no host at all', () => {
        vi.stubEnv('GATEWAY_HOST', '   ');

        expect(readGatewayConfiguration().host).toBe('0.0.0.0');
    });

    it('takes the port the environment set', () => {
        vi.stubEnv('GATEWAY_PORT', '9000');

        expect(readGatewayConfiguration().port).toBe(9000);
    });

    it('refuses a port outside the range a port can have', () => {
        vi.stubEnv('GATEWAY_PORT', '70000');

        expect(() => readGatewayConfiguration()).toThrow(ConfigurationError);
    });

    it('refuses a port that is not a whole number', () => {
        vi.stubEnv('GATEWAY_PORT', '8787.5');

        expect(() => readGatewayConfiguration()).toThrow(ConfigurationError);
    });



});
