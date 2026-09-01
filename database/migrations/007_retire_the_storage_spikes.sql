-- Retires the storage experiments and promotes the one that won.
--
-- Three ways of keeping the whole book were written side by side so they could
-- be measured against each other: tiles of the recorded band with one coarse
-- whole-book level beside them, the same book on one fine grid written two
-- ways, and the book cut into fixed squares stacked in levels of detail.
--
-- The squares won on every reading that was taken. A day of the book came back
-- in a quarter of a second against nearly seven; the whole book stored smaller
-- than the band the recording keeps -- nineteen megabytes against two hundred
-- and thirty-three over the same twenty-two hours; and the collector spent a
-- third less once it wrote only them.
--
-- Nothing goes with the losers. Every instant they held is in the squares,
-- which reach further back than either of them did.
--
-- This runs before the migration that creates the schema it renames into, so an
-- archive already holding the squares is carried across by its name rather than
-- copied row by row.

DROP TABLE IF EXISTS liquidity_tile;
DROP SCHEMA IF EXISTS spike_c CASCADE;
DROP SCHEMA IF EXISTS spike_mp4 CASCADE;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'spike_chunks')
        AND NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'whole_book')
    THEN
        ALTER SCHEMA spike_chunks RENAME TO whole_book;
    END IF;
END
$$;
