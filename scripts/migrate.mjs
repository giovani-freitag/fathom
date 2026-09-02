#!/usr/bin/env node
// Applies every migration in order, against whatever DATABASE_URL names.
//
// Node rather than psql: the image this runs in has the database driver and no
// database client, and a step that only works from a checkout is a step that
// does not work for anyone who was handed a compose file and nothing else.
//
// Each migration is written to be safe to re-run, so this makes no ledger and
// keeps none. Applying them all every time is a second on a database that
// already has them, and the alternative is a table that has to be right about
// what happened before anyone can find out what is wrong.
//
//   node --env-file-if-exists=.env scripts/migrate.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS = fileURLToPath(new URL('../database/migrations', import.meta.url));

/** How long to keep trying the database, for a container that started first. */
const WAIT_MS = 60_000;
const RETRY_MS = 1_000;

const url = process.env['DATABASE_URL'];
if (url === undefined || url === '') {
    process.stderr.write('DATABASE_URL is not set\n');
    process.exit(1);
}

/**
 * Opens a connection, waiting for a database that is still coming up.
 *
 * @returns A connected client.
 * @throws Error when the database never answered.
 */
async function connect() {
    const until = Date.now() + WAIT_MS;
    for (;;) {
        const client = new pg.Client({ connectionString: url });
        try {
            await client.connect();
            return client;
        } catch (error) {
            await client.end().catch(() => undefined);
            if (Date.now() >= until) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
        }
    }
}

const client = await connect();
try {
    for (const name of readdirSync(MIGRATIONS).filter((one) => one.endsWith('.sql')).sort()) {
        process.stdout.write(`applying ${name}\n`);
        await client.query(readFileSync(`${MIGRATIONS}/${name}`, 'utf8'));
    }
    process.stdout.write('migrations applied\n');
} finally {
    await client.end();
}
