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

**A reader's script runs in the page, on the main thread.** A worker was the
plan, and terminating one would have made a runaway loop cost a repaint instead
of the tab. It is not what was built: a reading is a pure function from bars to
vertices, called once per draw, and moving it across a thread boundary would put
a message round trip inside the paint the reader is watching. So a reading runs
where the shipped indicators run, and reaches a global if it goes looking — the
guide says so plainly rather than implying a sandbox that is not there. The
engine's own error reporting is the error reporting: a stack from the real
engine, against the code as written, with no wrapper interpreting it.

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

## What the surface settled on, and what it cost

1. **A class implementing `Indicator`** — rather than `extends`. `implements`
   needs no base class to import, so an addon and a shipped reading are the same
   shape rather than one being a subclass of the other's machinery. The editor
   completes from the first keystroke either way, off the `.d.ts` the barrel is
   generated into.

2. **A fluent plot builder that returns the plan object.** Not a translation:
   `tests/unit/shared/plot-builder.test.ts` asserts the built draft equals the
   hand-written one. Anything the builder does not cover is reachable by writing
   the object, in the same file, with no round trip.

3. **The arithmetic as functions, not as methods on `bars`.** Reversed from the
   recommendation. A collection type would have to be constructed on both sides
   of a worker boundary, and it is the surface most likely to grow without limit;
   plain functions over a plain array cost an import and nothing else.

4. **One `resolveSources`, returning what it reads by name.** Warm-up and coarser
   sessions were the same question — what must be in hand before this can run —
   and merging them cost nothing. Sessions arrive already held back to what each
   drawn bar could know, which is the piece that matters most.

5. **One barrel, `fathom`.** Nothing outside it is public and nothing inside it
   is promised across versions. A script that stops running after an upgrade
   reports the engine's own error and is reprocessed.

### Still open

- **The book, the executions and the gaps.** An addon still reaches only the
  bars and the sessions — the one dataset this project alone has is not on the
  surface. The design exists; nothing is built.
- **Where it runs.** Inline, on the main thread, like the shipped readings. A
  runaway loop in a reader's script takes the tab with it; a worker would not,
  and would cost a two-phase `computePlans`.
- **More than one at a time.** The editor holds one draft. The registry takes
  any number.
