# 23. A reader writes an indicator in the page

## Status

Proposed. The shape below is settled; the public surface is not, and is put up
for approval as a cookbook of worked examples rather than as a type listing.

## Context

The ask is for a reader to bring their own reading. Not a marketplace, not a
plugin registry with a review queue — something closer to a userscript manager:
paste a script, it attaches to the chart that is already open, and the effect is
visible immediately in the live picture rather than after a reload.

Three things about this codebase make it cheaper than it sounds.

The contract is one file. `draw-plan.ts` and `price-bar.ts` are the whole of what
an author touches, twenty-five exports between them. There is no API spread
across forty modules to document.

`compute` is called from exactly one place, and it is a pure function. Bars in,
vertices out, no state between calls, nothing held. That is precisely the shape
that crosses a worker boundary without ceremony: typed arrays in, typed arrays
back.

And the comment above that call site already framed the decision without
knowing it:

> Inline and synchronous because these are ours: moving a first-party indicator
> to a worker costs more in copying the bars across than the arithmetic it was
> meant to move off the thread.

For a reading we wrote, a worker does not pay. For code we did not write the
sum inverts: the copy is not buying speed, it is buying isolation from a script
that can loop forever, and a chart that freezes because of a stray `while` is
not a chart anyone will experiment on.

## Decision

**A reader's script runs in a worker.** Terminating one costs the chart a
repaint; a runaway on the render thread costs the reader the page. The worker's
own error reporting is the error reporting — a stack from the real engine,
against the code as written, with no wrapper interpreting it. When a change here
breaks a script, that is what the author sees, and reprocessing is theirs to do.

**The public surface is a barrel with a facade behind it.** One import path, an
object-oriented shape, and names chosen so that reading a script says what it
does without a reference open beside it. Nothing under it is public: what the
barrel does not export cannot be depended on, which is what makes the inside
free to move.

**No compatibility is promised across versions.** Deliberately, and it is what
makes the rest affordable: the contract can be cut and reshaped as the chart
learns what an indicator needs, and the cost of being wrong is a script that
fails loudly on one reader's screen rather than a shape carried for years.

**The types are the documentation.** Declarations emitted from the source and
loaded into the editor, so the surface arrives as completion and hover where the
author is typing, rather than as a page they have to go and find. The docblocks
that carry it are already written.

**TypeScript is transpiled in the page.** Types stripped, not checked — the
checking is what the editor is for. An author who wants plain JavaScript pastes
plain JavaScript and nothing changes for them.

**The editor sits beside the chart, and the chart is the preview.** Not a
sandbox chart, not a run button: the reading recomputes as the author stops
typing and is drawn on the live picture with the live book behind it. That is
the whole point of doing this here rather than in a text file, and it is what
makes a wrong indicator obvious in a second instead of a round trip.

## Consequences

A pasted script is code the reader has not read, running with the page's reach.
A worker isolates the thread and not the network. For a tool someone runs on
their own machine that is an acceptable trade and should be said plainly; the
first time a script is shared between two people it stops being one.

The input shape settles what every future script is written against, which is
why the rung declaration lands first (see [22](0022-an-indicator-declares-the-rungs-it-reads.md)).
There is no compatibility promise to break, but changing the signature a week
after publishing it is still a bad look.

Pine scripts are not converted, and a converter is not planned. The language has
hundreds of built-ins and a series semantics with implicit history, and a
translator covering a third of it produces readings that are subtly wrong rather
than visibly broken — which on a chart about liquidity is the worst outcome
available. What a shared contract does make cheap is translating one by hand,
which is the honest version of the same idea.
