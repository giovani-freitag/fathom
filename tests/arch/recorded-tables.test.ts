import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MIGRATIONS = fileURLToPath(new URL('../../database/migrations', import.meta.url));

/** The tables the budget counts and the pruning drops. */
function countedTables(): string[] {
    const source = readFileSync(`${ROOT}/src/database/services/recording-control-service.ts`, 'utf8');
    const block = /const RECORDED_TABLES = \[([\s\S]*?)\] as const;/.exec(source);
    return [...(block?.[1] ?? '').matchAll(/'([^']+)'/g)].map((one) => one[1]!);
}

/** Every table the migrations turn into a hypertable, which is what fills the disk. */
function storedTables(): string[] {
    const found = new Set<string>();
    for (const file of readdirSync(MIGRATIONS)) {
        const sql = readFileSync(`${MIGRATIONS}/${file}`, 'utf8');
        for (const match of sql.matchAll(/create_hypertable\(\s*'([^']+)'/g)) {
            found.add(match[1]!);
        }
    }
    return [...found];
}

describe('what the recording budget counts', () => {
    it('counts every store a migration made a hypertable of', () => {
        // A store left out is a store nothing prunes: it never shows in what the
        // reader is told they are using, and it goes on growing after the budget
        // has started dropping the rest. The squares were added a day after
        // this list was last read and were missed — thirty megabytes uncounted,
        // and unprunable, while the budget reported eight hundred and fifty-seven.
        const counted = countedTables();

        expect(storedTables().filter((table) => !counted.includes(table))).toEqual([]);
    });

    it('finds both lists at all, so a rename cannot empty this check', () => {
        expect([countedTables().length > 2, storedTables().length > 2]).toEqual([true, true]);
    });
});
