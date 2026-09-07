-- Which venue every recorded square and every gap came from.
--
-- Migration 010 named the venue on the registry and said the archive's own key
-- was "a separate change with a rewrite behind it, and it is not needed until
-- two venues record the same symbol at once". This is that change: a reader can
-- now open any contract any venue lists and start recording it from the chart,
-- so two venues recording one symbol is a press away rather than a plan.
--
-- What it prevents. The identity indexes below are UNIQUE, and a block still
-- filling is written over as it grows so that a re-write lands on the row it
-- wrote before. Keyed by the symbol alone, bybit's BTCUSDT would have landed on
-- binance's rows — not beside them, over them — and an order book cannot be
-- recorded again after the fact.
--
-- The column carries a default, and keeps it. Every row already here came from
-- one venue and the default names it, so the backfill is a metadata change
-- rather than a rewrite of four gigabytes. The default also keeps a collector
-- built before this migration writing correctly instead of failing every
-- insert: it records that venue and no other. Dropping the default belongs to
-- the release that ships a collector naming the venue itself.
--
-- The tape is not here. `trade_cluster` carries two continuous aggregates that
-- group by `instrument_symbol`, and a continuous aggregate's definition cannot
-- be altered — it has to be dropped, recreated and re-materialised, over twelve
-- compressed chunks. That is its own migration and its own window.
--
-- Safe to run twice, like every migration here.

ALTER TABLE whole_book.liquidity_block
    ADD COLUMN IF NOT EXISTS venue TEXT NOT NULL DEFAULT 'binance-futures';
ALTER TABLE whole_book.liquidity_chunk
    ADD COLUMN IF NOT EXISTS venue TEXT NOT NULL DEFAULT 'binance-futures';
ALTER TABLE recording_gap
    ADD COLUMN IF NOT EXISTS venue TEXT NOT NULL DEFAULT 'binance-futures';

-- Stated rather than left to the default, so a reader of this file knows the
-- backfill happened rather than assuming it.
UPDATE whole_book.liquidity_block SET venue = 'binance-futures' WHERE venue IS NULL;
UPDATE whole_book.liquidity_chunk SET venue = 'binance-futures' WHERE venue IS NULL;
UPDATE recording_gap SET venue = 'binance-futures' WHERE venue IS NULL;

-- The new keys first, so that at no instant is there no index to write through.
CREATE UNIQUE INDEX IF NOT EXISTS whole_book_block_contract_idx
    ON whole_book.liquidity_block (venue, instrument_symbol, detail_level, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS whole_book_chunk_contract_idx
    ON whole_book.liquidity_chunk
       (venue, instrument_symbol, detail_level, started_at DESC, lowest_bucket_index);

-- What a window read asks for: one contract, one level, one stretch of time.
CREATE INDEX IF NOT EXISTS whole_book_chunk_contract_window_idx
    ON whole_book.liquidity_chunk (venue, instrument_symbol, detail_level, started_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS recording_gap_contract_identity_idx
    ON recording_gap (venue, instrument_symbol, gap_started_at);
CREATE INDEX IF NOT EXISTS recording_gap_contract_time_idx
    ON recording_gap (venue, instrument_symbol, gap_started_at DESC);

-- The ones that name the symbol alone stay, and 012 takes them away.
--
-- A running collector upserts with ON CONFLICT (instrument_symbol,
-- detail_level, started_at), and Postgres resolves that clause by finding a
-- unique index on exactly those columns. Dropped here, the very next insert
-- from a collector built before this migration fails — and a recording that
-- stops is a hole in a book that cannot be recorded again.
--
-- Until they go, a second venue's first square is REFUSED by the old index
-- rather than written over the first venue's. Refusing is the safe half of the
-- collision: it costs that square and says so, where overwriting costs the
-- other venue's history and says nothing.
