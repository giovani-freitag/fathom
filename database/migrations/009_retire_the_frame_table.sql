-- The recording moved into the chunked archive, and nothing reads a row per
-- instant any more.
--
-- The chart draws the whole book as squares stacked in levels, the live tail
-- extends that same store, the coverage a listing carries is read out of it,
-- and the disk budget prunes its partitions. What is dropped here is the store
-- those replaced — every instant it held was recorded into the archive first,
-- and verified against it column by column before this ran.
--
-- Safe to run twice, like every migration here.

-- The bars that were folded out of it go first: they are continuous aggregates
-- over the table, so the table cannot be dropped while they stand. Nothing has
-- read them since the candles started coming from the venue.
DROP MATERIALIZED VIEW IF EXISTS book_bar_hour CASCADE;
DROP MATERIALIZED VIEW IF EXISTS book_bar_minute CASCADE;

DROP TABLE IF EXISTS liquidity_frame CASCADE;
