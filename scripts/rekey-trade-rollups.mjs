#!/usr/bin/env node
// Rebuilds the execution rollups so they group by the venue as well as the symbol.
//
// A continuous aggregate's definition cannot be altered — it has to be dropped,
// created again and re-materialised — so this cannot live in a migration
// alongside the column it follows. Two reasons, both hard: `refresh_continuous_
// aggregate` is a procedure that refuses to run inside a transaction block, and
// the runner sends each migration file as one statement batch, which is one. And
// a migration holding an unguarded DROP would empty these rollups on every run.
//
//   node --env-file-if-exists=.env scripts/rekey-trade-rollups.mjs
//
// Safe to run against the live recording, and safe to run twice. It writes
// nothing to `trade_cluster`: everything here is derived from that table and can
// be built again from it at any time. Run it a second time and it finds the
// rollups already grouped by venue and exits without touching them.
//
// What it costs while it runs: a window zoomed out far enough to be answered
// from a rollup shows less volume than it should, until the refresh reaches it.
// Nothing is lost — the executions are in `trade_cluster` throughout, and the
// rollups are only a faster way of asking the same question.
//
// Order matters. The hour rollup is built on top of the minute one, so the hour
// is dropped first and created last, and each is refreshed before the one above
// it reads from it.

import pg from 'pg';

/**
 * How the two rollups are declared, coarsest last.
 *
 * The definitions are the ones in `002_trade_rollups.sql`; a fresh database gets
 * them from there and never runs this. Kept in step by hand, which is the price
 * of a definition that cannot be altered — and the check below fails loudly if
 * they ever drift, rather than materialising the wrong shape.
 */
const ROLLUPS = [
    {
        name: 'trade_cluster_minute',
        bucket: '1 minute',
        from: 'trade_cluster',
        policy: { start: '3 hours', end: '2 minutes', every: '1 minute' },
    },
    {
        name: 'trade_cluster_hour',
        bucket: '1 hour',
        from: 'trade_cluster_minute',
        policy: { start: '3 days', end: '2 hours', every: '30 minutes' },
    },
];

const url = process.env['DATABASE_URL'];
if (url === undefined || url === '') {
    process.stderr.write('DATABASE_URL is not set\n');
    process.exit(1);
}

/**
 * The statement that declares one rollup.
 *
 * @param rollup - Which rollup, and what it is built from.
 * @returns The `CREATE MATERIALIZED VIEW` for it, with no data in it yet.
 */
function declare(rollup) {
    return `CREATE MATERIALIZED VIEW ${rollup.name}
        WITH (timescaledb.continuous) AS
        SELECT
            time_bucket(INTERVAL '${rollup.bucket}', executed_at) AS executed_at,
            venue,
            instrument_symbol,
            price_bucket_size,
            price_bucket_index,
            SUM(buy_quantity)::REAL           AS buy_quantity,
            SUM(sell_quantity)::REAL          AS sell_quantity,
            SUM(trade_count)::INTEGER         AS trade_count,
            MAX(largest_trade_quantity)::REAL AS largest_trade_quantity
        FROM ${rollup.from}
        GROUP BY 1, 2, 3, 4, 5
        WITH NO DATA`;
}

/**
 * Whether a rollup already carries the venue.
 *
 * @param client - The connection to ask on.
 * @param name - Which rollup.
 * @returns True where it is already grouped by the venue.
 */
async function namesVenue(client, name) {
    const { rows } = await client.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_name = $1 AND column_name = 'venue'`,
        [name],
    );
    return rows.length > 0;
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
    // The base table first. Without the column the rollups cannot name it, and
    // the migration that adds it may simply not have been run yet.
    if (!await namesVenue(client, 'trade_cluster')) {
        throw new Error('trade_cluster has no venue column — run the migrations first');
    }

    const already = await Promise.all(ROLLUPS.map((one) => namesVenue(client, one.name)));
    if (already.every(Boolean)) {
        process.stdout.write('the rollups already name the venue; nothing to do\n');
        process.exit(0);
    }

    // Coarsest first: the hour rollup reads from the minute one, so the minute
    // one cannot be dropped while it stands.
    for (const rollup of [...ROLLUPS].reverse()) {
        process.stdout.write(`dropping ${rollup.name}\n`);
        await client.query(`DROP MATERIALIZED VIEW IF EXISTS ${rollup.name} CASCADE`);
    }

    for (const rollup of ROLLUPS) {
        process.stdout.write(`declaring ${rollup.name}\n`);
        await client.query(declare(rollup));

        // Every instant there is, in one call. The policies below only ever
        // look a few hours back, so a rollup left to them would hold the last
        // three hours and answer for nothing before that — which reads as a
        // recording that never happened rather than as one not yet rolled up.
        process.stdout.write(`materialising ${rollup.name} over its whole history\n`);
        await client.query(`CALL refresh_continuous_aggregate('${rollup.name}', NULL, NULL)`);

        await client.query(
            `SELECT add_continuous_aggregate_policy($1,
                 start_offset => $2::INTERVAL,
                 end_offset   => $3::INTERVAL,
                 schedule_interval => $4::INTERVAL,
                 if_not_exists => TRUE)`,
            [rollup.name, rollup.policy.start, rollup.policy.end, rollup.policy.every],
        );

        // Answered live past the watermark, the way it was before: without this
        // the volume of the newest couple of minutes is missing while the candle
        // beside it is drawn, so a bar appears to have traded nothing.
        await client.query(
            `ALTER MATERIALIZED VIEW ${rollup.name} SET (timescaledb.materialized_only = false)`,
        );
    }

    process.stdout.write('the rollups now name the venue\n');
} finally {
    await client.end();
}
