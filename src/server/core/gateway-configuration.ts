import { MAXIMUM_WINDOW_MS } from '../../shared/core/api-contract.ts';
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 8787;
const DEFAULT_VIEWER_DIST_PATH = 'dist/app';

/** Raised when the environment cannot produce a usable configuration. */
export class ConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ConfigurationError';
    }
}

export interface GatewayConfiguration {
    readonly host: string;
    readonly port: number;
    readonly databaseUrl: string;
    readonly viewerDistPath: string;
    /** Secret a shared link must carry; empty leaves every route open. */
    /** True when the gateway is reached through a public tunnel. */
}

export const LIVE_TAIL_SETTINGS = {
    /**
     * How often the archive is checked for newly recorded frames.
     */
    pollIntervalMs: 500,
    maxFramesPerPoll: 120,
    /** Frames older than this are not replayed to a socket that just connected. */
    initialBacklogMs: 60_000,
    /**
     * Live tails allowed at once.
     */
    maximumSubscriptions: 24,
} as const;

export const QUERY_LIMITS = {
    maximumRangeMs: MAXIMUM_WINDOW_MS,
    maximumClusters: 60_000,
} as const;

/**
 * Ceiling on how hard the archive can be asked to work.
 */
export const REQUEST_BUDGET = {
    maximumRequestsPerMinute: 240,
    windowMs: 60_000,
} as const;

/**
 * Reads the gateway's configuration from the process environment.
 *
 * @returns A validated configuration.
 * @throws ConfigurationError when DATABASE_URL is missing or the port is not a valid port number.
 */
export function readGatewayConfiguration(): GatewayConfiguration {
    const databaseUrl = readText('DATABASE_URL', '');
    if (databaseUrl === '') {
        throw new ConfigurationError('Missing required environment variable: DATABASE_URL');
    }

    const port = Number(readText('GATEWAY_PORT', String(DEFAULT_PORT)));
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new ConfigurationError('GATEWAY_PORT must be a valid port number');
    }


    return {
        host: readText('GATEWAY_HOST', DEFAULT_HOST),
        port,
        databaseUrl,
        // Blank would resolve to the directory the gateway runs in, and the
        // static route would then serve the project itself — `.env` included.
        viewerDistPath: readText('VIEWER_DIST_PATH', DEFAULT_VIEWER_DIST_PATH),
    };
}

/**
 * Reads a variable that has something sensible to fall back on.
 *
 * @param variableName - The variable to read.
 * @param fallbackValue - What an unset or blank variable means.
 * @returns The configured text, trimmed, or the fallback.
 */
function readText(variableName: string, fallbackValue: string): string {
    // Blank reads as unset throughout: emptying a variable is how a `.env` says
    // it does not apply.
    return process.env[variableName]?.trim() || fallbackValue;
}
