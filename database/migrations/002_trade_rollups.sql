-- Zoomed-out views ask for weeks of executions at once. Grouping the raw 1-second
-- clusters on every such request means scanning tens of millions of rows, so the
-- rollups below pre-compute the two coarser time grids the viewer actually asks for.
-- Price granularity is preserved at every level; only time is rolled up, which lets
-- a query pick the coarsest grid finer than its requested resolution.

CREATE MATERIALIZED VIEW IF NOT EXISTS trade_cluster_minute
WITH (timescaledb.continuous) AS
SELECT
    time_bucket(INTERVAL '1 minute', executed_at) AS executed_at,
    instrument_symbol,
    price_bucket_size,
    price_bucket_index,
    SUM(buy_quantity)::REAL                       AS buy_quantity,
    SUM(sell_quantity)::REAL                      AS sell_quantity,
    SUM(trade_count)::INTEGER                     AS trade_count,
    MAX(largest_trade_quantity)::REAL             AS largest_trade_quantity
FROM trade_cluster
GROUP BY 1, 2, 3, 4
WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS trade_cluster_hour
WITH (timescaledb.continuous) AS
SELECT
    time_bucket(INTERVAL '1 hour', executed_at) AS executed_at,
    instrument_symbol,
    price_bucket_size,
    price_bucket_index,
    SUM(buy_quantity)::REAL                     AS buy_quantity,
    SUM(sell_quantity)::REAL                    AS sell_quantity,
    SUM(trade_count)::INTEGER                   AS trade_count,
    MAX(largest_trade_quantity)::REAL           AS largest_trade_quantity
FROM trade_cluster_minute
GROUP BY 1, 2, 3, 4
WITH NO DATA;

-- `end_offset` stays ahead of the newest data so the refresh never competes with
-- the collector's in-flight writes for the current bucket.
SELECT add_continuous_aggregate_policy('trade_cluster_minute',
    start_offset => INTERVAL '3 hours',
    end_offset   => INTERVAL '2 minutes',
    schedule_interval => INTERVAL '1 minute',
    if_not_exists => TRUE
);

SELECT add_continuous_aggregate_policy('trade_cluster_hour',
    start_offset => INTERVAL '3 days',
    end_offset   => INTERVAL '2 hours',
    schedule_interval => INTERVAL '30 minutes',
    if_not_exists => TRUE
);
