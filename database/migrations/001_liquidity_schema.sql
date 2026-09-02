CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Aggressive executions, pre-aggregated by the collector onto the same time and
-- price grid as the frames. Raw prints reach ~100/s on a liquid perpetual, which
-- is far below the resolution any zoom level of the heatmap can resolve.
--
-- Every column rolls up to a coarser grid without loss: the quantities and the
-- count sum, and `largest_trade_quantity` maxes, so a single large print stays
-- visible after aggregation instead of dissolving into its neighbours.
CREATE TABLE IF NOT EXISTS trade_cluster (
    executed_at            TIMESTAMPTZ      NOT NULL,
    instrument_symbol      TEXT             NOT NULL,
    price_bucket_size      DOUBLE PRECISION NOT NULL,
    price_bucket_index     INTEGER          NOT NULL,
    buy_quantity           REAL             NOT NULL,
    sell_quantity          REAL             NOT NULL,
    trade_count            INTEGER          NOT NULL,
    largest_trade_quantity REAL             NOT NULL
);

-- Periods with no recording, written explicitly. Order book history cannot be
-- backfilled from any public venue, so an unrecorded window must be stored as a
-- fact; otherwise the renderer draws a straight line across a connectivity drop
-- and invents liquidity that never rested there.
CREATE TABLE IF NOT EXISTS recording_gap (
    gap_started_at    TIMESTAMPTZ NOT NULL,
    gap_ended_at      TIMESTAMPTZ NOT NULL,
    instrument_symbol TEXT        NOT NULL,
    gap_reason        TEXT        NOT NULL,
    CONSTRAINT recording_gap_ends_after_it_starts CHECK (gap_ended_at >= gap_started_at)
);

SELECT create_hypertable(
    'trade_cluster', by_range('executed_at', INTERVAL '1 day'),
    if_not_exists => TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS trade_cluster_identity_idx
    ON trade_cluster (instrument_symbol, executed_at DESC, price_bucket_index);

CREATE INDEX IF NOT EXISTS recording_gap_symbol_time_idx
    ON recording_gap (instrument_symbol, gap_started_at DESC);

ALTER TABLE trade_cluster SET (
    timescaledb.enable_columnstore = true,
    timescaledb.segmentby          = 'instrument_symbol',
    timescaledb.orderby            = 'executed_at DESC'
);

-- Two days of row storage keeps the write path and any recent-history query on
-- uncompressed chunks; everything older converts to columnar, which measures
-- around four times smaller on the depth arrays. The larger win is not the size:
-- in columnar form each column is stored apart, so a query that names only the
-- price columns never fetches the arrays at all.
CALL add_columnstore_policy('trade_cluster', after => INTERVAL '2 days', if_not_exists => TRUE);

-- Which contracts a collector has ever recorded, and on what grid. Deriving this
-- from the frames themselves would mean a DISTINCT scan over the whole hypertable
-- on every viewer load; the collector knows the answer at startup for free.
CREATE TABLE IF NOT EXISTS instrument_registry (
    instrument_symbol TEXT PRIMARY KEY,
    price_bucket_size DOUBLE PRECISION NOT NULL,
    frame_interval_ms INTEGER          NOT NULL,
    registered_at     TIMESTAMPTZ      NOT NULL DEFAULT now()
);
