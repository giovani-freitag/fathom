# 19. The chart paints itself

Date: 2026-08-26

## Status

Accepted.

## Context

Everything on this chart is drawn by hand: scales, ticks, crosshair, candles,
executions, the profile, the book. That is a fifth of the front end to own and
maintain, and the obvious question is whether a library should own it instead.

Two candidates were taken seriously. A charting library — lightweight-charts is
the only maintained one that would deliver this experience — and a rendering
library, react-konva, which would let the chart be written as components that
react to state like the rest of the application.

## Decision

Neither. The chart keeps its own renderer.

**lightweight-charts** is ruled out by licence, not by capability. It is
Apache-2.0 with an attribution notice, and Apache-2.0 §4(d) makes a NOTICE
travel with every redistribution: adopting it would put its author's name on the
chart of every person who took this one. Its plugin examples, which include the
drawing tools this project still lacks, carry the same terms.

**react-konva** was measured rather than argued about, on a workload sized from
the real chart: about 1,850 objects, every one of which moves on every frame of
a drag. Production build, every performance flag the library offers.

| | one update, drawing included | drag on a 4× slower CPU |
|---|---|---|
| this renderer | 0.4 ms | 59.9 fps |
| react-konva, a node per thing | 6.5 ms | 28.2 fps |

React is not the expensive part: reconciling the elements costs two to three
milliseconds, and the rest is the library drawing a retained scene. The two
configurations that do match — one node drawing everything imperatively, and a
node tree built once and thereafter only translated — are the two that stop
being a scene graph. The second cannot run a live chart, because a refitted
price scale, a second of new book or a retuned indicator each invalidate the
cache it depends on.

## Consequences

The drawing stays imperative, and the seam stays where it is: an indicator
returns a description, a layer paints. That asymmetry is the real cost of this
decision and it is worth revisiting on its own terms — the fix is a description
a layer can return, not a scene graph underneath it.

What the library would have given is bought instead by the same rule that makes
this fast: the chart reads the store directly, and React is not in the frame.
