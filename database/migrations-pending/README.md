# Migrations that wait for something

The runner applies every file in `database/migrations/` in order, every time it
runs, and keeps no ledger. That is deliberate: a migration written to be safe to
re-run needs no bookkeeping, and a table that has to be right about the past
before anyone can diagnose the present is a table that makes outages longer.

It also means a migration that is only safe *after* something else has happened
cannot live there. This directory is where those wait, with the condition
written at the top of each one. Move a file into `database/migrations/` when its
condition is met; the next run picks it up.

## What is waiting

Nothing, at the moment. Both of the migrations this directory was made for have
run: `012` once the collector was rebuilt to name the venue in its upsert, and
the venue on `trade_cluster` as `013` alongside
`scripts/rekey-trade-rollups.mjs`, which rebuilds the two continuous aggregates
that a migration cannot alter.

The directory stays because the next migration that has to wait for something
will need it, and because the reason above is worth keeping written down.
