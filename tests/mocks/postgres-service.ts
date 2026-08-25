import { vi } from 'vitest';
import type { PostgresService } from '../../src/database/postgres/postgres-service.ts';

/** The two query methods, typed so a test can return rows without a cast. */
type SelectRowsSpy = ReturnType<typeof vi.fn<(statement: string, parameters?: readonly unknown[]) => Promise<unknown[]>>>;
type ExecuteSpy = ReturnType<typeof vi.fn<(statement: string, parameters?: readonly unknown[]) => Promise<number>>>;

export interface PostgresServiceMock {
    readonly service: PostgresService;
    readonly selectRows: SelectRowsSpy;
    readonly execute: ExecuteSpy;
}

/**
 * Exposes both query methods as spies so a test can capture the statement and
 * the bound values, which is where the behaviour worth asserting lives.
 */
export function createPostgresServiceMock(): PostgresServiceMock {
    const selectRows: SelectRowsSpy = vi.fn(() => Promise.resolve<unknown[]>([]));
    const execute: ExecuteSpy = vi.fn(() => Promise.resolve(0));

    return {
        service: { selectRows, execute } as unknown as PostgresService,
        selectRows,
        execute,
    };
}
