# 4. Keep the depth ladder as one array per row

Status: accepted

## Context

The obvious time-series shape for depth is one row per (instant, price level).
It is the shape the storage engine's compression is designed for: neighbouring
rows differ slightly, so delta and XOR encodings do their best work.

## Decision

Store each side of the book as a single array column, with the absolute index of
its first bucket, and reject the narrow layout.

## Consequences

This was measured rather than assumed, on the same 9,648 frames:

| layout | bytes per frame |
| --- | --- |
| array column | 202 |
| narrow, ordered by time then bucket | 840 |
| narrow, segmented per bucket, ordered by time | 239 |
| narrow, segmented per bucket, quantised integers | 242 |

The narrow layout reaches a 39x compression ratio and is still worse in absolute
bytes, because every row repeats a timestamp, a symbol and a bucket index that
the array gets for free. Compression ratio is the wrong metric; bytes per frame
is the right one.

The cost is that the storage engine has no specialised codec for array types, so
the depth columns compress about 4x while the scalar columns beside them compress
by orders of magnitude — 9,648 timestamps fit in 760 bytes.
