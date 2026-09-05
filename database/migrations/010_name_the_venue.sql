-- Which venue a contract was recorded from, on the registry that names them.
--
-- The registry has been keyed by symbol alone, which was true while there was
-- one venue. Two venues both listing BTCUSDT would have been one row, and the
-- second to register would have taken the grid of the first — silently, and
-- with a recording already underway on the old grid.
--
-- Only the registry is keyed here. The recorded data keeps its own key: a
-- symbol in the archive belongs to whichever contract wrote it, and every
-- writer reaches it through a registry row that now says which venue that was.
-- Widening the archive's key is a separate change with a rewrite behind it,
-- and it is not needed until two venues record the same symbol at once.
--
-- Safe to run twice, like every migration here.

ALTER TABLE instrument_registry
    ADD COLUMN IF NOT EXISTS venue TEXT NOT NULL DEFAULT 'binance-futures';

-- Everything already recorded came from one venue, and the default names it.
-- Stated rather than left to the default so a reader of this file knows the
-- backfill happened rather than assuming it.
UPDATE instrument_registry SET venue = 'binance-futures' WHERE venue IS NULL;

-- The symbol alone stops being the key. Dropped by whatever the old constraint
-- is called, because a table created before this ran named it for itself, and
-- replaced only when it is not already the pair — a second run of this file
-- must find the work done rather than try to do it again.
DO $$
DECLARE
    held TEXT;
BEGIN
    SELECT conname INTO held
    FROM pg_constraint
    WHERE conrelid = 'instrument_registry'::regclass AND contype = 'p';

    IF held = 'instrument_registry_venue_symbol_key' THEN
        RETURN;
    END IF;

    IF held IS NOT NULL THEN
        EXECUTE format('ALTER TABLE instrument_registry DROP CONSTRAINT %I', held);
    END IF;

    ALTER TABLE instrument_registry
        ADD CONSTRAINT instrument_registry_venue_symbol_key
        PRIMARY KEY (venue, instrument_symbol);
END $$;
