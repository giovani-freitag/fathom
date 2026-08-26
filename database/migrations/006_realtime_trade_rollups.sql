-- Answered live past the watermark, the way the bar rollups already are.
-- Without this the volume of the newest couple of minutes is missing while the
-- candle beside it is drawn, so a bar appears to have traded nothing.
ALTER MATERIALIZED VIEW trade_cluster_minute SET (timescaledb.materialized_only = false);
ALTER MATERIALIZED VIEW trade_cluster_hour   SET (timescaledb.materialized_only = false);
