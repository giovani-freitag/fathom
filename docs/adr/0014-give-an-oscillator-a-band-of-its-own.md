# 14. Give an oscillator a band of its own

Status: accepted

## Context

The chart had one drawable region and one vertical scale: price. That is all the
first indicator needed, because a moving average is a price and belongs over the
thing it describes.

It is not all the second one needs. A relative-strength reading is bounded to
nought and a hundred. Plotted against an axis whose range is a few hundred
dollars either side of the last trade, every value it can produce lands in the
same pixel — a flat line along the bottom of the screen. The same is true of a
convergence reading, which is signed and centred on nothing in particular, and of
a true range, which is a distance rather than a level.

Widening the price axis to fit them is worse than useless: it would compress the
price into a band a few pixels tall to make room for a number that is not a
price.

## Decision

A plan declares which scale it is drawn against. `price` puts it over the chart.
Anything else is given a band of its own below the price, sized as a share of the
surface, with the price keeping a floor however many are added.

Each band resolves its own range from the plan. A declared range is kept whatever
the window reached, because for a bounded reading the bounds *are* the reading —
rescaling to what it happened to reach this window makes forty look like an
extreme. A signed reading is centred on nought so a rise and a fall of the same
size look the same size. Everything else takes the extremes of its own data, its
thresholds included, with head-room so a peak is not clipped.

The band's two labels, and the value of every threshold drawn in it, are written
in the axis gutter by the layer that owns the gutter. Drawn inside the band
instead, the line being described runs straight through the text naming it.

`plotHeight` became `pricePaneHeight`, and a second figure, `paneStackHeight`,
now names where every band ends and the time axis begins. The rename was the
point: thirteen readers had to be reconsidered one at a time, and the split
between them is not mechanical. Depth, candles, executions and the volume profile
belong to price. Gaps, the time grid and the crosshair belong to time and cross
every band. The gesture controller was among them, and it had been dividing a
drag by a height that no longer existed.

## Consequences

Containment is now two clips rather than one. The outer keeps every layer out of
the axis gutters; the inner keeps everything that reads as a price inside the
pane that has a price axis. Without the second, a candle at the edge of the band
draws down through the oscillator below it and reads as part of its line — which
is what the first usability pass found, before it was a rule.

The elements placed over the canvas need the same geometry the canvas was drawn
with. They recompute it from the same pure function rather than reading it back
out of a paint: two readers of one function cannot disagree, where a value
published from inside a frame arrives a frame late and loops.

Bands are a fixed share and cannot be dragged. Nobody has asked yet, and a
resize handle is a gesture that has to be taken from the ones already on the
surface.
