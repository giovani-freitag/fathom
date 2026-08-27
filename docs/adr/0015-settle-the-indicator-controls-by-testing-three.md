# 15. Settle the indicator controls by testing three of them

Status: accepted

## Context

Where indicator controls live is not a question the code answers. Three shapes
were all defensible: a section in the settings drawer, rows on the chart beside
what they describe, or a keyboard palette. Each is a different bet about who is
reading, and arguing about them produces an opinion rather than an answer.

## Decision

All three were built behind a query parameter and put through the same scripted
session — add an average and retune it, add a bounded oscillator, retune it,
remove the first one, add two copies of one indicator and tell them apart, read
what each says under the pointer. Each was run blind, against the interface only,
with no access to the source.

The chart-side rows won, and the manner of winning mattered more than the score.
The drawer's own worst finding was that nothing on the chart is labelled, so you
cannot tell one line from another without reopening a panel that covers the
chart while you tune. The keyboard palette scored level with the rows, and the
single improvement it asked for was to make the legend rows interactive — which
is the other design. Two of the three converged on the third.

So the rows ship, and the palette's one genuine advantage ships with them: the
same catalogue opens on the chord a reader already reaches for, and the button
says so.

## Consequences

The sessions found defects that no amount of reading the diff would have. The
price layers were not clipped to the price pane, so candles drew through the
oscillators beneath them. Two copies of one indicator were drawn in the same
colour with identical labels, which made the ordinary case — a fast average and a
slow one — impossible to read. The row's controls appeared only on hover, so
nothing said they were there and no finger could reach them. Removal was one
click with no way back.

One was subtler than any of those and is worth keeping in mind: the first click
on a legend control was silently swallowed. The cause was the row itself. Leaving
the canvas emptied the readings, the row narrowed, and the control moved out from
under the hand between press and release. Reading the newest bar at rest fixed
it, and is the better behaviour anyway.

The two losing variants were deleted rather than kept behind a flag. The evidence
is here; the code carries only what won.
