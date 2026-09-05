/** How long a connector's name may be before it stops fitting anywhere. */
export const MAXIMUM_CONNECTOR_NAME_LENGTH = 32;

/** As many connectors as a reader is likely to keep straight. */
export const MAXIMUM_STORED_CONNECTORS = 10;

/** As much source as one connector may be before it is refused. */
export const MAXIMUM_CONNECTOR_SOURCE_BYTES = 256 * 1024;

/**
 * A connector a reader brought, kept as the source they gave.
 *
 * The source rather than what it evaluated to: a function cannot be written to
 * storage, and re-reading the same text on every load is also the only way a
 * reader can be shown what they installed before it runs again.
 */
export interface StoredConnector {
    /** What the connector answers to, which is written into every recording. */
    readonly id: string;
    /** What the reader called it, for the interface to show. */
    readonly name: string;
    readonly source: string;
    /** When it was installed, so a reader can tell two attempts apart. */
    readonly installedAtMs: number;
}

/**
 * The connectors as they can be trusted, out of whatever storage held.
 *
 * Storage is a file the reader can edit, and the source in it is about to be
 * evaluated: a field that is not a string reaches the evaluator as one anyway.
 *
 * @param stored - Whatever was parsed out of storage.
 * @returns The readable ones, in the order they were installed.
 */
export function readStoredConnectors(stored: unknown): readonly StoredConnector[] {
    if (!Array.isArray(stored)) {
        return [];
    }

    return stored
        .filter(isStoredConnector)
        .filter((connector) => connector.source.length <= MAXIMUM_CONNECTOR_SOURCE_BYTES)
        .slice(0, MAXIMUM_STORED_CONNECTORS)
        .map((connector) => ({
            id: connector.id,
            name: connector.name.slice(0, MAXIMUM_CONNECTOR_NAME_LENGTH),
            source: connector.source,
            installedAtMs: connector.installedAtMs,
        }));
}

/**
 * Whether something out of storage is a connector.
 */
function isStoredConnector(candidate: unknown): candidate is StoredConnector {
    const connector = candidate as Partial<StoredConnector> | null;
    return typeof connector?.id === 'string' && connector.id !== ''
        && typeof connector.name === 'string'
        && typeof connector.source === 'string' && connector.source !== ''
        && typeof connector.installedAtMs === 'number' && Number.isFinite(connector.installedAtMs);
}
