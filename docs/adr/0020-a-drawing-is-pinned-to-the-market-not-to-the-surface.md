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
mark added, moved, restyled or selected is part of that key. A mark still
being dragged out is on the same layer, dashed, because a drag already moves the
viewport key every frame and costs the same repaint either way.

**A press over the plot is offered before it is spent.** The gesture controller
takes an optional claimant and offers it every press over the plot. A claimant
that takes one gets the whole gesture — move and release — and the pointer never
reaches the pan, the pinch, or the drag book. A claimant that declines hears
about it too, which is what lets pressing bare chart mean *done with that one*.

**The controls live along the bottom, in a bar below the chart.** A phone is held
by its lower half, and a rail beside the chart is a regrip away. The resting
pointer is shown as a tool rather than as nothing, and stepping back and forward
sits at the end of the same row: undoing is part of drawing, and a row of its
own for two glyphs was a second place to look.

They floated first, as an island over the chart, on the reasoning that drawing
is done in bursts and a full-width row costs the chart its height for as long as
the page is open. That was measured against the wrong cost. What the island
floated over was the volume pane, which is where the bottom of the chart does
its reading, and a control that covers the thing it is about has taken more than
it gave. The bar is the same shell the wide layout puts on top, so the two
cannot drift apart. What still floats is only what opens for a moment.

**Selecting a mark opens what can be changed about it.** Not a control that then
opens it — the reader has already said what they want to work on by pressing it,
and a second press to say so again is one they should not have to make. What
opens is the same set of choices in both layouts, placed where each has room:
down the left on a wide screen, above the island on a narrow one. It closes with
the selection.

**A mark's look is stored, and what it does not say is filled in when it is
read.** Colour, weight and line sit beside the anchors, and a mark that names
none of them — one left before either existed, or one naming a weight this build
has never heard of — is drawn at the default rather than refused. Resolving on
read instead of migrating on write means the vocabulary can grow again without
touching what a reader already drew.

**A mark can be named, and the name is drawn on the mark.** A mark says where; a
name says why, and why is the half a reader cannot reconstruct a week later from
a line on a screen. The name is stored the way the look is — beside the anchors,
resolved on read, so a mark drawn before names existed is drawn without one —
and it is written along a segment rather than level over it, turned back the
right way up where the line runs leftward. Typing it is one step back rather
than one per letter: a reader who undoes a name means the name, not its last
character.

**A press has to travel before it moves anything, and the pointer says what it
is over.** Both hang off the same claimant seam. A click that twitches two
pixels is a selection, not a drag, so selecting a mark cannot shift it; and a
mark under a resting pointer shows as grabbable, because a one-pixel line gives
a reader no other way to know they are on it than to press and find out — which
pans the chart when they were not.

**A mark is dragged by its ends as well as by its middle, and not every mark is
kept.** The grips the painter draws for the selected mark are grabbable, so
reshaping needs no mode; and the kinds table gained a measurement, which is
drawn, read, and dropped on the next press rather than stored. Transience is one
predicate over the kind, not a second vocabulary beside the first.

**A tap is a separate offer from a press.** A press over the plot must stay free
to pan, so what it landed on cannot be spent when it goes down. The controller
therefore reports a press that was declined and then went nowhere, and the
claimant answers that with what a reader meant by it: opening the settings of
whatever reading was drawn under it. The hit test that finds one resolves each
plan's projection the same three ways the painter does — the price axis, a strip
along the floor, a band of its own — because a test that placed a line anywhere
else would answer about one nobody can see.

**A mark belongs to a contract.** It is drawn about `BTCUSDT`, shown on no other
chart, and a stored mark naming a kind this build cannot draw is dropped on the
way in rather than carried for ever.

## Consequences

Panning and zooming are free: nothing about a mark is recomputed except its two
projected ends, and those come from arithmetic the frame was doing anyway.

A mark survives a reload because it is stored the way it is drawn — as instants
and prices, in the one preferences record.

The claimant seam is the whole extension point. A new tool is a kind in one
table, a case in the painter's shape arithmetic, a line in the hit test saying
how it is grabbed, and two dictionary entries; it is not a branch in the gesture
controller, which knows only that *something* took the press. The zone was added
that way after the fact, then the measurement, then the retracement — which is
the check the seam had to keep passing.

Grabbing is sized for a fingertip rather than a cursor, and a zone counts as
grabbed anywhere inside it: hunting a one-pixel outline with a thumb is not
something anybody should have to do. A second finger arriving while one is
drawing is ignored rather than read as a pinch, because it is a hand resting on
the glass.

The cost is that the overlay repaints while a mark is dragged. That was measured
against the alternative — a fourth canvas for marks alone — and rejected: a drag
already invalidates the overlay through the viewport, so the extra canvas would
buy nothing and cost a composite on every frame for the whole session.
