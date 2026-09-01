# Data model

The recording is stored twice over: as tables in TimescaleDB when a server
records, and as object stores in IndexedDB when a page records for itself. Those
stores are named after the tables on purpose — a reader who knows one knows the
other.

Both archives exist on both sides. A page records the band and the squares, the
same grid and the same six levels a server writes, so a demo shows a wall
standing where the market has not been exactly as the server does.

What differs is only how the planes are kept. A server has brotli; a page has
gzip through `CompressionStream`, and a browser with neither keeps the bytes as
they are. Measured on a page recording one contract for a minute and a half,
nine and a half megabytes of plane stored as thirty-seven kilobytes — the planes
are mostly empty, and empty compresses.

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

## The whole book, as fixed squares

`liquidity_frame` follows the price: it holds a band around it and nothing else,
because a row per price across the whole book would be mostly zeroes. A wall
resting a long way from the market is therefore invisible in it, and a wall a
long way from the market is exactly what a reader zooms out to find.

`whole_book` holds the whole book instead, cut into fixed squares of 512
instants by 512 prices anchored to an absolute grid, each square its own brotli
stream. Sizes are logarithmic — one byte per cell, two per cent to the step — so
the whole book costs a fraction of what the band costs stored plainly. Measured
over the same 22 hours: 233 MB for the band in `liquidity_frame`, 19 MB for the
whole book at the finest level.

```sql
CREATE TABLE whole_book.liquidity_block (   -- one row per level per 512 instants
    instrument_symbol  TEXT,
    detail_level       SMALLINT,
    started_at         TIMESTAMPTZ,
    ended_at           TIMESTAMPTZ,
    column_interval_ms INTEGER,
    price_bucket_size  DOUBLE PRECISION,
    column_count       SMALLINT,
    step_ratio         REAL,
    smallest_quantity  REAL,
    best_bid_prices    REAL[],                -- the touch, per instant
    best_ask_prices    REAL[]
);

CREATE TABLE whole_book.liquidity_chunk (   -- one row per square of that block
    instrument_symbol   TEXT,
    detail_level        SMALLINT,
    started_at          TIMESTAMPTZ,
    lowest_bucket_index INTEGER,
    column_count        SMALLINT,
    low_plane           BYTEA,                -- brotli, one byte per cell
    high_plane          BYTEA
);
```

### Six levels, folding time only

Level 0 is the recording, one column a second. Each level above it folds four
columns of the one below into one, keeping the largest size at each price — so
level 5 is a column every seventeen minutes, and a window of a day is read from
a few hundred columns instead of eighty-six thousand. Measured against the same
window read off the finest level, a day fell from 2.6 seconds to a quarter of
one, and nine hours from 2.3 seconds to a fifth.

The fold takes **time only, never price**. The chart's two axes zoom
independently, so a reader who has zoomed out in time still wants the price rows
they had; folding both made the rows four times thicker at every step out, which
looked like the picture had broken.

### Both axes narrow the read

A square is addressed by price as well as by time, so a read for a band of
prices touches only the squares that band crosses. That is what `liquidity_frame`
cannot do — it reads its stored rows whatever was asked for, and the band is
applied to the answer.

### A block is written whole

Every level is written out as it fills, so a reader zooming out is never
answered with an empty coarse level. A block is written whole from what the
writer holds in memory, which means two writers in one block would each replace
the other's work — and a block of the coarsest level covers six days, so a
backfill and the live recording are always in the same one. Both lay the stored
block under what they hold before writing. Reading it costs up to a fifth of a
second, so each first checks the transaction stamp the store left on its own
last write: unchanged means nobody else has been in the block, which in a
recording nobody is sharing is always.

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

The same table answers a second question with the price bands dropped rather
than kept: how much traded in a stretch of time, which is what a bar means by
volume. That read is a scan of its own alongside the one that builds the bar
from the book, because the two sides are stored apart and rolled up apart — the
book has nothing below a minute but the raw frames, while the executions were
already summed to the second when they were written. Joining them would tie each
to whichever grid the other needed.

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

`gap_reason` is what broke it, and a cause that explains something replaces one
that does not. The clock ticks once a second and the book goes unusable the
instant it breaks, so the recorder almost always *notices* before it is *told
why*: first-writer-wins stamped `order book unavailable` over every socket
close, silence timeout and reconnect, and that placeholder became the most
common reason in the ledger while explaining none of them. It is now only what
survives when nothing else ever said why.

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
