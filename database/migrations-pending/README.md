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

- **`012_retire_the_symbol_only_keys.sql`** — waits for the collector on this
  machine to be running a build whose upsert names the venue. Until then the
  old indexes have to stay, because Postgres resolves `ON CONFLICT (cols)` by
  finding a unique index on exactly those columns, and an insert that fails is
  a hole in a book nobody can record again.

- **The venue on `trade_cluster`** — not written yet. Its two continuous
  aggregates, `trade_cluster_minute` and `trade_cluster_hour`, group by the
  symbol, and a continuous aggregate's definition cannot be altered: it has to
  be dropped, recreated and re-materialised, over twelve compressed chunks.
  That needs a window somebody chose. Until it runs, two things go by the
  symbol alone: what a window of executions answers with, and what taking a
  contract away deletes — so removing one exchange's `BTCUSDT` takes every
  exchange's executions of that symbol with it, while leaving each one's book
  where it is.
