import { vi } from 'vitest';
import type { PostgresService } from '../../src/database/core/postgres-service.ts';

export interface PostgresServiceMock {
    readonly service: PostgresService;
    readonly selectRows: ReturnType<typeof vi.fn>;
    readonly execute: ReturnType<typeof vi.fn>;
}

/**
 * Exposes both query methods as spies so a test can capture the statement and
 * the bound values, which is where the behaviour worth asserting lives.
 */
export function createPostgresServiceMock(): PostgresServiceMock {
    const selectRows = vi.fn().mockResolvedValue([]);
    const execute = vi.fn().mockResolvedValue(0);

    return {
        service: { selectRows, execute } as unknown as PostgresService,
        selectRows,
        execute,
    };
}
