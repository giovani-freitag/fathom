# 6. Give the colour ramp two cuts, not one

Status: accepted

## Context

Resting size spans orders of magnitude, so the ramp from size to colour must be
normalised against something. The first implementation saturated at a high
percentile of the visible window and mapped everything below it across the ramp.

The result was a field of texture. Measured over 194,882 buckets, the median
bucket landed 37% up the ramp — bright enough to read as data — and the top
decile was brighter still. A wall had nothing to stand out against.

## Decision

Cut the ramp at both ends. Everything below a lower percentile is painted as
empty; everything above an upper percentile is saturated; the ramp spends itself
on the band between. Both cuts are exposed to the reader.

## Consequences

The background churn of quotes placed and pulled by the second stops competing
with resting size that matters.

The cost is real and deliberate: below the floor, a thin level and an empty one
are indistinguishable. The reader loses the ability to tell "little here" from
"nothing here", which is why the cut is a control rather than a constant.

Both cuts are percentiles of the visible window, so the same colour means
different sizes in different windows. Comparing two windows by eye is therefore
unsound; the legend names both ends for that reason.
