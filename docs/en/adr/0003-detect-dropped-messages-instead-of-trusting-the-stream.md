# 3. Detect dropped messages instead of trusting the stream

Status: accepted

## Context

A depth stream can drop a message. If it does and nothing notices, the mirrored
book silently diverges from the real one and every frame written afterwards is
plausible, well-formed, and wrong. That failure is worse than an outage, because
an outage is visible.

## Decision

Every diff carries the identifier of the update immediately before it. Applying
a diff requires that identifier to match the last one applied. A mismatch is
treated as certain corruption: the book is discarded, a fresh snapshot is
fetched, and the interval is recorded as a gap.

## Consequences

The system prefers admitting ignorance to guessing. A brief break becomes a
visible amber band rather than an invisible error.

It also couples the design to venues that publish such a chain. A driver for a
venue that does not will need a weaker check, and should say so rather than
pretend the guarantee still holds.
