-- Takes away the keys that named a symbol without the venue it came from.
--
-- Split from 011 because of one line in the collector: it upserts with
--
--     ON CONFLICT (instrument_symbol, detail_level, started_at)
--
-- and Postgres resolves that clause by finding a unique index on exactly those
-- columns. Run against a collector built before 011, this migration makes the
-- very next insert fail, and a recording that stops is a hole in a book that
-- cannot be recorded again.
--
-- SO: RUN THIS ONLY AFTER the collector on this machine is running a build
-- whose upsert names the venue. Its own migration, deliberately, so that
-- applying every migration in order — which is what the runner does — cannot
-- reach it while an older collector is writing.
--
-- Until it runs, a second venue's first square is refused by the old index
-- rather than written over the first venue's. That is the safe half of the
-- collision: it costs that square and says so, where overwriting costs the
-- other venue's history silently.
--
-- Safe to run twice, like every migration here.

-- Twice over, because these indexes answer to two names. A database that has
-- been through the rename in 008 carries them as `spike_chunks_*` — the tables
-- were renamed and the indexes over them were not — while 008 itself declares
-- them as `whole_book_*` and creates them on a database that has neither.
--
-- And 008 runs before this file, every time, because the runner applies them all
-- in order and keeps no ledger. So the name 008 creates has to be dropped here
-- as well as the name history left behind: written for one name only, this would
-- have taken away an index the same run had just put back.
DROP INDEX IF EXISTS whole_book.spike_chunks_block_identity_idx;
DROP INDEX IF EXISTS whole_book.spike_chunks_chunk_identity_idx;
DROP INDEX IF EXISTS whole_book.spike_chunks_chunk_window_idx;
DROP INDEX IF EXISTS whole_book.whole_book_block_identity_idx;
DROP INDEX IF EXISTS whole_book.whole_book_chunk_identity_idx;
DROP INDEX IF EXISTS whole_book.whole_book_chunk_window_idx;
DROP INDEX IF EXISTS recording_gap_identity_idx;
DROP INDEX IF EXISTS recording_gap_symbol_time_idx;
