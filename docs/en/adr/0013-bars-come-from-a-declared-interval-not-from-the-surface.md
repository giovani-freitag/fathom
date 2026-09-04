# 13. Bars come from a declared interval, not from the surface

Status: accepted

## Context

The chart drew candles by folding the frames it already held. Those frames are
sampled to fit the surface: the loader asks for a column per plot pixel, so the
sampling interval reduces to the viewport's span divided by the browser's width,
and the fold then averages several probes into each column.

Both halves of that make a bar a property of the window it is drawn in. Measured
against the live gateway on one viewport, a phone-width request binned at 77
seconds and a desktop-width one at 16 — nearly five times apart, for the same
declared timeframe. An average over such bars would disagree between two screens
showing the same thing, which makes every indicator built on them meaningless.

It also cost accuracy in a way nobody would notice: averaging four probes into a
column destroys the extremes, so a bar's high and low were attenuated towards
its mean.

## Decision

Bars leave the frame path entirely. They come from a second, narrow-projection
port over the archive, on a closed ladder of intervals chosen from the viewport's
span alone. Nothing about the surface reaches that decision.

Above a minute the archive holds them pre-grouped, as continuous aggregates
shaped like the execution rollups that were already there. Below a minute a scan
that names only the two price columns answers directly — and measured
head-to-head, that scan is *faster* than a dedicated aggregate on a columnar
chunk, because there the columns are stored apart and the scan never fetches the
depth arrays. A sub-minute aggregate would have bought nothing and cost a second
thing that can be stale.

Every bar carries what built it: the frames a whole bucket of its width holds,
the frames that landed, and whether the bucket can still grow. Three states
rather than two, because a short frame count otherwise conflates a bucket the
collector missed with one that has simply not finished — and the newest bar,
which is the one a reader watches, is unfinished for almost all of its own
width. A bucket with no frames is omitted rather than zero-filled.

The query snaps its range outward to bucket edges. Without that a bar changes
shape depending on where the reader happened to have panned to, which makes the
same bar two different bars.

Indicators are pure functions from bars to vertices in data space. The host owns
the only function from a value to a pixel, so a pan re-projects a held plan
rather than re-running the indicator, and the data layers are painted inside a
clip that no painter can reach past.

## Consequences

A bar is now the same on every device, and it carries true extremes rather than
attenuated ones. Reading five hundred of them costs single-digit milliseconds
against the hundred and forty the equivalent depth window takes, and the minute
aggregate is under a third of a percent of the frames it summarises, refreshed
for about a sixth of a percent of one core.

The continuous aggregate is the point of no return in this design: its select
list cannot be altered afterwards, so the frame count and the coverage instants
had to be right before it was created. They were verified against the raw frames
first, on a range that included a real recording gap.

Bars of the mid will not agree digit-for-digit with a platform that bars traded
prices. That is stated in the interface rather than left for a reader to discover
by comparing two screens.

A stalled refresh degrades rather than breaks: the real-time union scans the
unmaterialised tail, which measured 32ms with the whole three-hour policy window
outstanding across four contracts — six percent of the live tail's own interval.

## What was deliberately not built

A sandbox for third-party indicators. The seam exists — an indicator already
cannot reach a drawing context, and the containment is enforced by a clip rather
than by trust — but there is no third-party code to run. Building the boundary
now would mean designing an opaque-origin protocol against an imagined API, and
the first real addon request is what should specify it.

Indicators that read the book rather than the bars. Wall persistence, cumulative
imbalance, absorption at a level — the reasons to write an addon here rather than
elsewhere — are not expressible over open-high-low-close lanes. Shipping raw
ladders across a boundary is fifty times the payload of a bar table and hands
away the one asset that cannot be recorded again. The scalar contract ships as
version one, explicitly, and the first three real requests are the specification
for what the host should compute instead.
