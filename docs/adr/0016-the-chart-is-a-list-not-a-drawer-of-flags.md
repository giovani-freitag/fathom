# 16. The chart is a list, not a drawer of flags

Status: accepted

## Context

The depth map, the candles, the executions and the volume profile were booleans
in a settings drawer. An average was a member of a list on the chart, with a
colour, a hide control, its parameters beside it and a way back after removing
it. Both are answers to "what am I looking at", and only one of them was any
good: the flags could not be tuned where they were drawn, could not be silenced
for a moment, and the depth map's three knobs sat in a panel that covered the
thing they were adjusting.

## Decision

One list. Everything a reader puts on the chart is a member of it, added from
one catalogue, tuned in one panel, hidden and removed the same way.

The two halves are not drawn the same way and are not pretended to be. An
indicator is arithmetic over bars returning vertices in data space, bounded to a
few series of a few thousand points. The depth map is a picture of hundreds of
thousands of cells built from the book, painted on a layer of its own precisely
so that dragging the chart is a blit rather than a repaint. Neither fits the
other's contract, and forcing them together would have cost the thing that makes
the chart quick.

So the catalogue holds two kinds. One produces a plan; the other names a layer
the host already knows how to paint. What is on the chart is read out of the
list rather than stored beside it, so there is a single answer and it is the
list.

Taking the book off leaves a plain candle chart. That is not a side effect to be
tolerated — it is a view somebody might want, and it was unreachable before.

## Consequences

A stored document written before this has flags and no layers. It is migrated
once, on the version it was written at rather than on the version it was merged
with: a reader who had turned the profile off meant it, and seeding the defaults
would have handed it back on every load.

The count limit went with the drawer. It had been eight, which was a number
rather than a constraint: bands thin as they are added and the price pane keeps
a floor, so a crowded chart is something a reader can see and act on. What
remains is a bound on a stored document that arrives corrupt, set far above any
chart somebody would build.

Draw order is still the host's. The list decides what is drawn and how it is
tuned, not what sits in front of what — a depth map painted over the candles
would hide them, and no ordering a reader could choose makes that useful.
