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
    readonly accessToken: string;
    /** True when the gateway is reached through a public tunnel. */
    readonly isTunnelled: boolean;
}

export const LIVE_TAIL_SETTINGS = {
    /**
     * How often the archive is checked for newly recorded frames.
     *
     * The collector writes on a one-second grid, so polling faster only costs
     * queries; the visible lag stays bounded by the collector's own flush.
     */
    pollIntervalMs: 500,
    maxFramesPerPoll: 120,
    /** Frames older than this are not replayed to a socket that just connected. */
    initialBacklogMs: 60_000,
    /**
     * Live tails allowed at once.
     *
     * Each one polls the archive on its own cursor, and the archive is the same
     * database the collector writes to. Bound to a LAN address, a handful of
     * forgotten tabs is normal and a runaway client should not be able to starve
     * the recording.
     */
    maximumSubscriptions: 24,
} as const;

export const QUERY_LIMITS = {
    maximumRangeMs: 90 * 24 * 60 * 60 * 1_000,
    maximumClusters: 60_000,
} as const;

/**
 * Ceiling on how hard the archive can be asked to work.
 *
 * The collector writes to the same database, one row a second, and that row is
 * the only thing here that cannot be rebuilt. A visitor hammering the widest
 * depth query competes with it for the disk, so the cap protects the recording
 * rather than the reader.
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
    const databaseUrl = process.env['DATABASE_URL'];
    if (databaseUrl === undefined || databaseUrl.trim() === '') {
        throw new ConfigurationError('Missing required environment variable: DATABASE_URL');
    }

    const port = Number(process.env['GATEWAY_PORT'] ?? 8787);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new ConfigurationError('GATEWAY_PORT must be a valid port number');
    }

    return {
        host: process.env['GATEWAY_HOST'] ?? '0.0.0.0',
        port,
        databaseUrl: databaseUrl.trim(),
        viewerDistPath: process.env['VIEWER_DIST_PATH'] ?? 'dist/app',
        accessToken: (process.env['FATHOM_ACCESS_TOKEN'] ?? '').trim(),
        isTunnelled: process.env['FATHOM_TUNNELLED'] === 'true',
    };
}
