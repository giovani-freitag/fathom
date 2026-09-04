# 22. An indicator declares the rungs it reads

## Status

Accepted.

## Context

Every reading on this chart was a function of one thing: the bars of the rung
being drawn. That covered the twenty-odd it shipped with, and it stopped
covering them the moment anyone asked for the oldest reading on any floor.

A pivot set is not computed from the minutes it is drawn over. It is computed
from what yesterday traded through, and held flat across today. So is a level
marking the previous week's high, an opening range, a fifty-day average read on
an hourly chart. In Pine the whole family is written through one call —
`request.security` — and the reason it is one call rather than twenty is that
they all want the same thing: figures from a coarser rung, on a chart drawn at
a finer one.

The chart already had every part of this except the wiring. The venue publishes
candles per rung and the app already fetches them by width; the archive is
asked for bars through a query that names an interval; an indicator already
declares how far back it needs to reach, and the host already merges those
declarations across everything on the chart before it fetches.

What it also had was a reading quietly doing this by hand. The VWAP anchors to
a session, and with nowhere to ask what a session is, it decides:

    const day = Math.floor(bar.openedAtMs / DAY_MS);

That is midnight UTC hard-coded, and it is wrong wherever a venue's day starts
somewhere else. A reading that needs to know when a session turned over should
be able to ask.

The hard part is not the fetching. It is that the obvious implementation is
silently, catastrophically wrong. A daily level drawn from the day being lived
through is a level that changes all afternoon and settles only at midnight —
and a chart of the past painted that way looks extraordinary, because every
level sits exactly where the day was going to end up. Pine has a flag for this
and defaults it to off. It is the single semantic that matters here.

## Decision

**An indicator says which rungs it reads, and the host fetches them.** A new
optional method beside the warm-up declaration, absent on almost every reading,
because an indicator is a function of the bars it is drawn on until it says
otherwise. The host merges the declarations the way it already merges warm-ups —
two copies anchored to the same session are one fetch — and hands the windows
over in the input, as a lookup keyed by the rung asked for.

**The warm-up is counted in bars of the rung asked for.** An average of fifty
daily closes wants fifty days whether it is drawn on minutes or on hours.
Inherited from the drawn rung it would ask for fifty minutes on one chart and
four years on another, and neither is what was meant.

**Only a session that has closed is visible.** One walk, in one place: for each
drawn bar, the newest coarser bar whose close is at or before that bar's open.
At or before, not strictly before — the close is the instant the figures became
knowable, and holding them back a bar draws yesterday's level a minute into
today. Everything that reads a coarser rung goes through it, so the rule cannot
be got right in one reading and wrong in the next.

**A reading is handed the run, not only the newest.** "What did this bar know"
is one bar, and a mean, a range or anything else with a memory needs the run
behind it. Built instead from the sessions that happen to turn over inside the
drawn window, a fifty-period mean on a minute chart has one day of history and
no weeks at all — measured, twenty-seven hourly closes, two daily and one
weekly. So the sessions that had settled come back as a list, with an index per
drawn bar saying where in that list the bar sits. The list is cut at the last
drawn bar's own walk, so nothing still forming is in it and widening the window
cannot change what an earlier bar was told.

**A rung the venue has no candle for is dropped, not raised.** No venue
publishes every width, and the month cannot even be asked for — this is keyed
by a width in milliseconds and a month has no fixed one. A reading that wanted
a rung it cannot have draws nothing and says it has not converged. It does not
take the book, the executions and the gaps down with it.

**The rungs go in the request key.** The key already carries the warm-up for
exactly this reason: asking for the same window with more behind it is a
different request, and without it the fetch an added indicator triggers is
deduplicated against the one that did not need it. A coarser rung is history of
another kind and belongs there for the same reason. It was briefly in the
staleness check as well; that was the same rule held in two places, which this
codebase has already decided against once.

**The series cap went from four to eight.** It was four while every reading here
was a line, a pair, or a line with a band. A pivot set is seven lines that only
mean anything together, and a plan over budget is rejected whole — so at four
the reading could not ship at all, and drawing three of seven is not a smaller
version of it.

## Consequences

The multi-timeframe family is now a matter of writing the arithmetic. A
previous-day high, an opening range, a higher-timeframe average: all of them are
a declaration and a `compute`.

The VWAP's hard-coded midnight is now replaceable, and should be replaced.

An indicator can ask for a rung and be handed nothing. Every reading that uses
one has to draw blank and say so rather than assume, which is a case authors
will forget — the alternative was pretending an empty window is a real one,
which fails silently instead of visibly.

The merge that takes the deepest warm-up across copies of a rung is not covered
by a test, because the one reading that declares a rung declares a constant
depth, and the collector reads the shipped catalogue rather than an injected
one. It is two lines and obviously right, and it will be exercised the first
time a second such reading lands.
