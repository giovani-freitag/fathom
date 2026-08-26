-- Bars of the book mid, pre-grouped on the two coarser time grids.
--
-- The chart used to bin candles from the frames it already held, which made the
-- bin a function of the browser's width: the same viewport on a phone and on a
-- desktop produced bars 4.7x apart. A bar has to be the same everywhere, so it
-- comes from a declared interval against the archive rather than from whatever
-- resolution the depth field happened to be fetched at.
--
-- These carry the mid of the book, not a traded price. A traded close is
-- derivable from the execution grid to within a hundredth of a percent, so this
-- is a choice: the mid is what the recording is of, and it is defined in every
-- second the collector saw, including the ones nothing traded in.

CREATE MATERIALIZED VIEW IF NOT EXISTS book_bar_minute
WITH (timescaledb.continuous) AS
SELECT
    time_bucket(INTERVAL '1 minute', captured_at)                      AS opened_at,
    instrument_symbol,
    first((best_bid_price + best_ask_price) / 2, captured_at)          AS open_price,
    max((best_bid_price + best_ask_price) / 2)                         AS high_price,
    min((best_bid_price + best_ask_price) / 2)                         AS low_price,
    last((best_bid_price + best_ask_price) / 2, captured_at)           AS close_price,
    -- Counted here rather than derived later: a continuous aggregate's select
    -- list cannot be altered afterwards, and without this a bar the collector
    -- missed most of is indistinguishable from a whole one.
    count(*)::INTEGER                                                  AS frame_count,
    min(captured_at)                                                   AS first_frame_at,
    max(captured_at)                                                   AS last_frame_at
FROM liquidity_frame
GROUP BY 1, 2
WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS book_bar_hour
WITH (timescaledb.continuous) AS
SELECT
    time_bucket(INTERVAL '1 hour', opened_at)   AS opened_at,
    instrument_symbol,
    first(open_price, opened_at)                AS open_price,
    max(high_price)                             AS high_price,
    min(low_price)                              AS low_price,
    last(close_price, opened_at)                AS close_price,
    sum(frame_count)::INTEGER                   AS frame_count,
    min(first_frame_at)                         AS first_frame_at,
    max(last_frame_at)                          AS last_frame_at
FROM book_bar_minute
GROUP BY 1, 2
WITH NO DATA;

-- Answered live past the watermark. Without this the newest bar is missing until
-- the next refresh, which is the one bar a reader is watching.
ALTER MATERIALIZED VIEW book_bar_minute SET (timescaledb.materialized_only = false);
ALTER MATERIALIZED VIEW book_bar_hour   SET (timescaledb.materialized_only = false);

-- `end_offset` stays ahead of the newest data so the refresh never competes with
-- the collector's in-flight writes for the current bucket.
SELECT add_continuous_aggregate_policy('book_bar_minute',
    start_offset => INTERVAL '3 hours',
    end_offset   => INTERVAL '2 minutes',
    schedule_interval => INTERVAL '1 minute',
    if_not_exists => TRUE
);

SELECT add_continuous_aggregate_policy('book_bar_hour',
    start_offset => INTERVAL '3 days',
    end_offset   => INTERVAL '2 hours',
    schedule_interval => INTERVAL '30 minutes',
    if_not_exists => TRUE
);
