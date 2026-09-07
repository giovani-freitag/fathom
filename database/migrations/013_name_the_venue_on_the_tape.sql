-- Which venue every recorded execution came from.
--
-- Migration 011 named the venue on the squares of the book and left the tape
-- for its own migration, because `trade_cluster` carries two continuous
-- aggregates and a continuous aggregate's definition cannot be altered. This is
-- the half of that work the base table can take: the column, the backfill, and
-- the identity the rows are deduplicated by. The aggregates above it are
-- rebuilt by `scripts/rekey-trade-rollups.mjs`, which has to refresh them
-- outside a transaction and so cannot live here.
--
-- What it prevents. The identity index is UNIQUE and the collector inserts with
-- ON CONFLICT DO NOTHING, so a row that collides is dropped rather than stored.
-- Keyed by the symbol alone, the second venue to print at a given instant and
-- price would have had that print silently discarded — a quiet loss, on the one
-- side of the recording that looks complete either way.
--
-- Unlike 012, this one does not wait for the collector to be rebuilt. That
-- clause names no columns, so Postgres resolves it against whichever unique
-- index is there, and swapping one for the other changes nothing for a
-- collector that has not been replaced yet: every row it writes takes the
-- venue from the default below, and dedupes against itself exactly as before.
--
-- Compression is left segmented by the symbol alone. Changing `segmentby` on a
-- hypertable that already has compressed chunks is not a thing this can do
-- safely, and what it would buy is a narrower scan once two venues share a
-- symbol — not a different answer.
--
-- Safe to run twice, like every migration here.

ALTER TABLE trade_cluster
    ADD COLUMN IF NOT EXISTS venue TEXT NOT NULL DEFAULT 'binance-futures';

-- Stated rather than left to the default, so a reader of this file knows the
-- backfill happened rather than assuming it.
UPDATE trade_cluster SET venue = 'binance-futures' WHERE venue IS NULL;

-- The new identity first, so that at no instant is there no unique index to
-- deduplicate against.
CREATE UNIQUE INDEX IF NOT EXISTS trade_cluster_contract_identity_idx
    ON trade_cluster (venue, instrument_symbol, executed_at DESC, price_bucket_index);

DROP INDEX IF EXISTS trade_cluster_identity_idx;
