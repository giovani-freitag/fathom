# 10. Separate what the data draws from what the cursor draws

Status: accepted

## Context

The depth field has had a good answer since the beginning: the window is
rasterised once into an offscreen image in data space, and every pan is one
`drawImage` with a source rectangle. Measured over a day of BTCUSDT — 2,168
columns — that layer costs 0.02ms a frame.

The vector overlay had no answer at all. Gaps, grid, volume profile, candles,
executions and axes were redrawn from scratch on every frame, including on a
pointer move, where the only thing that changed was the crosshair. The same
measurement put one frame at 3.9ms, of which 3.0ms was the execution bubbles
alone: 4,791 arcs, for a plot 1,740 pixels wide. At a sixth of the CPU — a
mid-range phone — that frame took 27ms against a budget of 16.7.

The overlay is also the surface that is meant to grow. Indicators and, later,
packages written by someone else all draw there.

## Decision

Three canvases rather than two. The depth field keeps its blit. A second layer
holds everything drawn from the data and is kept between frames, repainted only
when a declared key changes. A third holds what is drawn from the cursor —
crosshair, touch line, and the axes, which hide labels underneath the cursor's
tag and so are cursor-coupled whether or not they look it.

The key names every input the data layers read: the dataset revision, the
viewport, the layout, which layers are switched on, the theme, and the language.
A field missing from it is a stale layer; a field in it that nothing reads is a
repaint that changes no pixels. It is the contract a third-party painter will
have to declare, written down early while there are only nine painters to keep
honest.

Executions are merged before they are drawn. Prints landing within three pixels
of each other become one bubble carrying their combined size, and prints outside
the price band are dropped rather than handed to the canvas to clip. The merge
is not only cheaper: a hundred overlapping bubbles at a tenth of a pixel apart
encoded nothing, where one bubble sized by the total says what actually traded.

## Consequences

Moving the cursor went from 3.9ms to 0.4ms, and from 5,045 vector operations to
37. Panning, which does change the viewport and so does repaint the data layer,
went from 3.9ms to 1.7ms on the merge alone. On the throttled phone the two are
1.8ms and 9.0ms, both inside the frame budget that the old cursor path missed by
ten milliseconds.

An indicator now costs its price when something changes rather than sixty times
a second, which is what makes the addon surface affordable to open.

Resizing a canvas clears it, so the held layer is invalidated there explicitly.
That is the one place the cache can be lost silently, and it is the one place a
test would not have caught it.
