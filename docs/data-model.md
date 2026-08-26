# Data model

The same shapes are stored twice: as tables in TimescaleDB when a server records,
and as object stores in IndexedDB when a page records for itself. The stores are
named after the tables on purpose — a reader who knows one knows the other.

## One row per instant, not per level

`liquidity_frame` holds **one row per time bucket**, with the whole depth ladder
in arrays.

Modelling a row per price level would produce around forty million rows a day at
this resolution, which no single-node database serves well. This is 86,400 rows a
day instead.

```sql
CREATE TABLE liquidity_frame (
    captured_at             TIMESTAMPTZ,
    instrument_symbol       TEXT,
    price_bucket_size       DOUBLE PRECISION,
    best_bid_price          DOUBLE PRECISION,
    best_ask_price          DOUBLE PRECISION,
    bid_lowest_bucket_index INTEGER,
    bid_quantities          REAL[],
    ask_lowest_bucket_index INTEGER,
    ask_quantities          REAL[]
);
```

The price of `bid_quantities[i]` (1-based, as PostgreSQL indexes arrays) is
`(bid_lowest_bucket_index + i - 1) * price_bucket_size`.

### Why two arrays and not one

Each side carries its own offset and array. Two reasons:

1. **The spread's bucket.** With ten-unit bands, a best bid at 79,001.4 and a
   best ask at 79,001.6 fall in the same band. In a single array the two would
   sum into a phantom row that does not exist in the book.
2. **Neither side stores the other's empty half.** Each array covers only the
   extent its own side occupies, so two arrays cost what one dense array covering
   everything would — and say more.

## Pre-aggregated executions

`trade_cluster` holds aggressions already summed onto a grid of second and price
band:

```sql
CREATE TABLE trade_cluster (
    executed_at            TIMESTAMPTZ,
    instrument_symbol      TEXT,
    price_bucket_size      DOUBLE PRECISION,
    price_bucket_index     INTEGER,
    buy_quantity           REAL,
    sell_quantity          REAL,
    trade_count            INTEGER,
    largest_trade_quantity REAL
);
```

Every field rolls to a coarser grid without loss: quantities and counts sum,
`largest_trade_quantity` takes a maximum. That is what keeps a forty-unit print
visible after aggregating by hour rather than dissolved into an average.

The continuous aggregates `trade_cluster_minute` and `trade_cluster_hour`
materialise the two widest zooms. Price granularity is kept at every level; only
time is aggregated.

## Gaps

```sql
CREATE TABLE recording_gap (
    gap_started_at    TIMESTAMPTZ,
    gap_ended_at      TIMESTAMPTZ,
    instrument_symbol TEXT,
    gap_reason        TEXT
);
```

Without this table the renderer joins the two sides of a dropped connection with
a straight line and invents liquidity that was never there — the worst kind of
error in a chart used to decide something. With it, the stretch becomes a dashed
amber band.

A gap is opened when the book becomes unavailable, when a batch of writes is
discarded, when the recording clock does not fire on time, and at startup,
measured from the last frame the previous run stored.

Gaps reach a chart while it is watching, not only on a reload: the tail reports
one the moment it appears in the stretch a reader has just been sent.

## What is being recorded

Two things a reader chooses from the interface are stored rather than configured.

`instrument_registry` carries the grid each contract records on, and an
`is_enabled` flag: the row exists because something has been recorded for that
contract, and the flag says whether it still is.

```sql
CREATE TABLE instrument_registry (
    instrument_symbol TEXT PRIMARY KEY,
    price_bucket_size DOUBLE PRECISION,
    frame_interval_ms INTEGER,
    registered_at     TIMESTAMPTZ,
    is_enabled        BOOLEAN
);
```

`recording_budget` is one row holding the disk ceiling, keyed by a constant so
there can only ever be one.

Both live in the database rather than in a configuration file because they are
decisions made while looking at the chart, not while deploying. The supervisor
re-reads them on an interval and closes the difference — no restart, and no other
contract disturbed.

In a page the same two choices live in one `recording_control` record, for the
same reason turned inside out: a Web Worker cannot read local storage, and the
collector inside one has to see them.

## Idempotency

Unique indexes on `(instrument_symbol, captured_at)` and
`(instrument_symbol, executed_at, price_bucket_index)`, with
`ON CONFLICT DO NOTHING`. A restart that replays the current second, or a batch
whose failure arrived after the commit, converges instead of duplicating a
column. In the browser the compound key of the object store does the same job.

## Compression

After two days chunks convert to columnar storage, segmented by instrument and
ordered by time.

Executions compress several times better than depth: their columns are narrow
integers and floats that repeat, where a depth row carries two arrays whose
contents genuinely differ from one second to the next. Depth is the larger of the
two by an order of magnitude, so it is the one that decides how long a disk
budget lasts.

What a frame costs is set by how wide the recorded band is, not by how busy the
contract is — the array covers the band whether or not there is size resting in
it. Widening the band is therefore the one setting that changes the storage bill
proportionally.

## The binary wire format

A thousand columns of depth is a few hundred thousand quantities. As JSON that is
tens of megabytes of decimal text, and parsing costs more than drawing. The
`/api/heatmap` route answers in binary, and so does a window of frames pushed
over the live socket.

A 32-byte header, then one record per frame — 40 bytes of header and two
`float32` arrays — all little-endian:

| offset | type | field |
| --- | --- | --- |
| 0 | `u32` | magic `FTHM` |
| 4 | `u16` | format version |
| 8 | `f64` | `priceBucketSize` |
| 16 | `f64` | base instant |
| 24 | `u32` | frame count |
| 28 | `u32` | sampling interval |

Each frame's stride is a multiple of four, so the decoder creates its
`Float32Array`s as **views** over the received buffer, without copying.
`@fastify/compress` compresses the response — around 4× in practice, because the
recorded band is much wider than the dense part of the book.

`application/octet-stream` is marked incompressible in `mime-db`; the gateway has
to list it explicitly, or the largest response the API serves is the one that
travels raw.

A worker needs none of this. `postMessage` clones a typed array as a typed array,
so the same message that a socket encodes travels whole.
