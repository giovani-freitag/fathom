-- The same heat map again, cut into addressable squares and stacked in levels.
--
-- The two schemas beside this one each keep one picture per stretch of time,
-- and the band they draw follows the price. That is compact and unaddressable:
-- to answer for a corner of the chart the reader is looking at, the whole
-- stretch has to be decoded and thrown away. Measured, six hours of the finest
-- level costs half a second to read that way, and a month five and a half
-- minutes.
--
-- So the grid is fixed here, and a square of it can be handed over as it lies.
-- Five hundred and twelve instants by five hundred and twelve prices, measured
-- rather than chosen: over five hours of a recorded book, that shape stores two
-- percent smaller than the band that follows the price, while a shorter one
-- stores sixteen percent larger. A wall stands for hundreds of seconds, and
-- length along time is what the compressor has to work with.
--
-- Above the finest level, each one folds four instants into one, keeping the
-- largest at each price. Time only: prices stay where they are, because the two
-- axes of the chart are zoomed apart and widening the hours is not a request
-- for coarser prices. Largest is what makes this exact rather than approximate:
-- it is associative, so the largest of a stack of levels is the largest of the
-- instants underneath it, and a coarse reading equals the fine one folded. The
-- whole stack costs about eighty percent on top of the finest level, and
-- answers a month in three tenths of a second instead of five minutes.
--
-- None of it is recorded. Every level above nought is derived from nought, and
-- nought from the same frames the recording is built from. Any of it can be
-- dropped and rebuilt: it is an index, not a second recording.

CREATE SCHEMA IF NOT EXISTS whole_book;

-- What every column of one stretch of time carries, whatever price it is at.
--
-- Apart from the squares because it belongs to the time and not to the price:
-- kept on each square it would be written once per price block, and a reader
-- that fetched two squares of the same stretch would be handed it twice.
CREATE TABLE IF NOT EXISTS whole_book.liquidity_block (
    instrument_symbol  TEXT             NOT NULL,
    detail_level       SMALLINT         NOT NULL,
    -- The first instant of the block, on this level's own grid.
    started_at         TIMESTAMPTZ      NOT NULL,
    ended_at           TIMESTAMPTZ      NOT NULL,
    -- What one column of THIS level covers, already multiplied out.
    column_interval_ms INTEGER          NOT NULL,
    price_bucket_size  DOUBLE PRECISION NOT NULL,
    column_count       SMALLINT         NOT NULL,
    step_ratio         REAL             NOT NULL,
    smallest_quantity  REAL             NOT NULL,
    best_bid_prices    REAL[]           NOT NULL,
    best_ask_prices    REAL[]           NOT NULL
);

-- One square: a stretch of time by a stretch of prices, on one level.
CREATE TABLE IF NOT EXISTS whole_book.liquidity_chunk (
    instrument_symbol   TEXT        NOT NULL,
    detail_level        SMALLINT    NOT NULL,
    started_at          TIMESTAMPTZ NOT NULL,
    -- The first price of the square, on this level's own grid. Fixed, so the
    -- same prices always land in the same square and a reader can name one.
    lowest_bucket_index INTEGER     NOT NULL,
    column_count        SMALLINT    NOT NULL,
    low_plane           BYTEA       NOT NULL,
    high_plane          BYTEA
);

SELECT create_hypertable('whole_book.liquidity_block', 'started_at',
                         chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);
SELECT create_hypertable('whole_book.liquidity_chunk', 'started_at',
                         chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);

-- A block still filling is written over as it grows, so a re-write has to land
-- on the row it wrote before rather than beside it.
CREATE UNIQUE INDEX IF NOT EXISTS whole_book_block_identity_idx
    ON whole_book.liquidity_block (instrument_symbol, detail_level, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS whole_book_chunk_identity_idx
    ON whole_book.liquidity_chunk
       (instrument_symbol, detail_level, started_at DESC, lowest_bucket_index);

-- What a window read asks for: one level, one stretch of time, some prices.
CREATE INDEX IF NOT EXISTS whole_book_chunk_window_idx
    ON whole_book.liquidity_chunk (instrument_symbol, detail_level, started_at DESC);
