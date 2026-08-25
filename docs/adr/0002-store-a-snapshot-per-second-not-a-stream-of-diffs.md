# 2. Store a snapshot per second, not the stream of diffs

Status: accepted

## Context

The venue publishes incremental depth updates roughly ten times a second. Each
one is a delta: a price level whose size changed. Persisting them verbatim is
the smallest possible write.

But a heat map asks the opposite question. To draw one column it needs, for a
given second and every price band, how much was resting there — a state, not a
change. Answering that from deltas means replaying every delta since the
beginning of the recording.

## Decision

Keep the book in memory, applying diffs as they arrive, and photograph the whole
ladder once per second into one row.

## Consequences

Reads are cheap and bounded: drawing any window is a range scan, never a replay.
The row count is the number of seconds recorded, not the number of updates.

Writes are larger than they strictly need to be. A wall that has not moved for
an hour is stored 3,600 times. Measured, this is what makes the depth arrays
99% of the compressed footprint.

The in-memory book becomes state that a restart loses, which is why a restart
opens a gap until the book is resynchronised.
