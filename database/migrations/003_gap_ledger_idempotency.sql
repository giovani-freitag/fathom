-- The gap ledger is the record of what was lost, so a write of it must be able
-- to be retried. Without a natural key a retry duplicates, which is why the
-- recorder used to fire it once and give up: it had no safe way to try again.
CREATE UNIQUE INDEX IF NOT EXISTS recording_gap_identity_idx
    ON recording_gap (instrument_symbol, gap_started_at);
