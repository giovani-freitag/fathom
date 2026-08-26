# 17. Volume is an indicator, not a switch on the book

Date: 2026-08-26

## Status

Accepted. Refines [16](0016-the-chart-is-a-list-not-a-drawer-of-flags.md).

## Context

Everything read off the recording was folded onto the book: the executions that
crossed it, where in the price they landed, and how much of them there was. The
first two are the book seen another way. The third is not.

A bar already carries what traded in it. The bars are fetched for the candles,
from the same endpoint, whether or not the book is on the chart. Chaining the
volume to the book meant a chart of candles alone had no volume — and a chart of
candles and volume is the ordinary case a reader opens with.

It also cost more than it looked. The book is drawn from a recording that cannot
be recovered after the fact; the volume is not. Tying them made the cheap reading
inherit the expensive one's requirement.

## Decision

Volume is a member of the catalogue, added and removed like an average. It is in
the set a chart opens with, beside the book and the candles.

Its colours are a reading rather than an identity: green because the bar rose. A
plan may say so, and the host then neither recolours it nor offers a colour to
pick, because a swatch that changes nothing is a control that lies.

## Consequences

A chart with no book still has volume, which is what a reader expects.

The book's card is smaller and says only what the book is: how it is cut, what
crossed it, where that landed, and what feeds it.

Stored preferences carry: a reader who had the volume switched on inside the book
gets it back as an entry of its own, tuned the way they had tuned it. The switch
is spent in the same read.

Volume is now repeatable — two copies, one total and one split, are addable. That
follows from the catalogue rather than being designed for.
