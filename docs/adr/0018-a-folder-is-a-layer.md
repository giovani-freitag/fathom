# 18. A folder is a layer

Date: 2026-08-26

## Status

Accepted. Completes [17](0017-volume-is-an-indicator-not-a-switch-on-the-book.md).

## Context

A layer was scattered. The book's arithmetic sat in `indicators/`, its field and
colour ramp in `painting/`, three of its painters in `painting/painters/`, its
legend in `ui/`, and its panel in `ui/indicators/`. The renderer named each
painter and branched on each flag; the page named the legend; the settings card
tested for the book by id.

Nothing was wrong with any one of those. Together they meant that adding a layer
was an edit in five places, and removing one was archaeology.

## Decision

`src/app/indicators/<layer>/` holds one layer whole. Four files above them are
the only way in: what the build ships, what the host paints, what each
contributes to the drawing, and what each puts in the shell.

The renderer walks a list and asks each member whether it is drawn. Order is a
number the layer declares, not the sequence a method happens to call things in.
The page mounts the marks the drawn layers carry. The card shows the panel the
layer brought, and hides the remove button when the layer says it must stay.

An architecture test enforces it in both directions: nothing outside may reach
past the four files into a layer, and no layer may reach into another.

## Consequences

Adding a layer is a folder and a line in a registry. Deleting one is deleting a
folder — and the test says so, because nothing else could have been holding a
reference into it.

A folder holding a single file is normal here. It is where the second file goes.

Two seams are named in the test rather than hidden by it. The preferences
service reads documents written when the layers were arranged differently: those
names are history, and splitting one document's history across the folders that
happen to exist now would make it harder to read, not easier. The chart dataset
summarises the frames it holds, and the cuts it produces exist only because the
book paints a ramp with them; moving that arithmetic out to satisfy the rule
would be moving code for the rule's sake.
