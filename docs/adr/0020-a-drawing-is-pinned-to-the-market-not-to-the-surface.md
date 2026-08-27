# 20. A drawing is pinned to the market, not to the surface

## Status

Accepted.

## Context

A reader marking up a chart is drawing about the market: a level price keeps
respecting, the slope two highs make. What they are not drawing about is the
window they happen to be looking through.

The chart already carries two kinds of layer. An indicator reads the recording
and produces a plan; the cursor reads the pointer and is redrawn every frame. A
mark is neither. Nothing computes it — a reader put it there — and it has to
outlive not only the frame but the session, the pan, the zoom, and the reload.

The obvious implementation is the wrong one. Marks stored in surface pixels are
one pan away from meaning nothing, and a level recorded at `y = 240` is a level
about the browser window rather than about the price.

There is a second problem, in the pointer rather in the storage. The surface
already spends every press on the viewport: a drag pans, a wheel zooms, a pinch
scales. Arming a drawing tool and then pressing means two things want the same
gesture, and the one that must not win is the pan — a chart that slides out from
under the line being placed is unusable.

## Decision

**A mark is anchored in time and price.** One anchor for a level, two for a
segment. Everything else — where it lands on the surface, whether it is even on
screen — is derived per frame from the projector the rest of the chart uses.

**Marks are drawn with the data, not with the cursor.** They go on the overlay
layer, which is held between frames and repainted only when its key changes; a
mark added, moved, recoloured or selected is part of that key. A mark still
being dragged out is on the same layer, dashed, because a drag already moves the
viewport key every frame and costs the same repaint either way.

**A press over the plot is offered before it is spent.** The gesture controller
takes an optional claimant and offers it every press over the plot. A claimant
that takes one gets the whole gesture — move and release — and the pointer never
reaches the pan, the pinch, or the drag book. A claimant that declines hears
about it too, which is what lets pressing bare chart mean *done with that one*.

**The controls live along the bottom.** A phone is held by its lower half, and a
rail beside the chart is a regrip away. The tool row is always present, the
resting pointer is shown as a tool rather than as nothing, and the properties of
whatever is selected float above that row instead of pushing the chart smaller.

**A mark belongs to a contract.** It is drawn about `BTCUSDT`, shown on no other
chart, and a stored mark naming a kind this build cannot draw is dropped on the
way in rather than carried for ever.

## Consequences

Panning and zooming are free: nothing about a mark is recomputed except its two
projected ends, and those come from arithmetic the frame was doing anyway.

A mark survives a reload because it is stored the way it is drawn — as instants
and prices, in the one preferences record.

The claimant seam is the whole extension point. A new tool is a kind in one
table, a case in the painter's shape arithmetic, and two dictionary entries; it
is not a branch in the gesture controller, which knows only that *something*
took the press. The zone was added that way, after the fact, which is the check
the seam had to pass.

Grabbing is sized for a fingertip rather than a cursor, and a zone counts as
grabbed anywhere inside it: hunting a one-pixel outline with a thumb is not
something anybody should have to do. A second finger arriving while one is
drawing is ignored rather than read as a pinch, because it is a hand resting on
the glass.

The cost is that the overlay repaints while a mark is dragged. That was measured
against the alternative — a fourth canvas for marks alone — and rejected: a drag
already invalidates the overlay through the viewport, so the extra canvas would
buy nothing and cost a composite on every frame for the whole session.
