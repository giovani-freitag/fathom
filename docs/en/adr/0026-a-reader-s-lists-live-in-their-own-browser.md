# 26. A reader's lists live in their own browser

Status: accepted

## Context

ADR 25 lets a reader bring a venue. A venue is worth bringing so that something
on it can be watched, and watching a hundred pairs across three venues is a
question of which handful matters — so the pairs a reader keeps became a feature
of their own: favourites, and lists they name themselves.

Where those lists live is the decision. Fathom already writes two kinds of thing
down. The recording goes in Postgres, because it is the thing that cannot be
made again and several processes read it. Preferences go in the browser, because
they are one person's and nobody else has to agree with them.

A watch list looks like it could be either. It is small, structured, and a
reader would be annoyed to lose it.

## Decision

**A list is a preference, not a recording. It goes in the browser, beside the
layers on the chart and the marks drawn on it.**

Three things settle it.

*There is no reader.* Fathom has no accounts and no sessions. A list in Postgres
would be everyone's list — one favourites for whoever opens the page, with the
last person to press the star deciding what the next one sees. Giving lists a
table means first giving the product a notion of who is asking, which is a far
larger decision than where to keep twenty symbols.

*Nothing but the interface reads them.* The collector records the contracts the
control table names; the chart draws what it is pointed at. A list changes
neither. It decides what a picker shows, and the picker is in the page.

*Losing one costs a minute.* The rule that put the recording in Postgres is that
order book history cannot be backfilled. A list can: the reader stars four pairs
again. The two are not the same kind of loss and should not get the same
machinery.

**A pair is a venue and a symbol, never a symbol alone.** BTCUSDT on two venues
is two recordings with two different pasts, and a list holding only the symbol
opens whichever the chart finds first.

**The first list is named by the interface, not by storage.** It is stored with
an empty name and rendered as "Favourites" or "Favoritos". A name written into
storage in one language stays in that language after the reader changes it.

## Consequences

**Lists do not follow a reader between machines**, and clearing site data takes
them. Both are true of every preference this build keeps, and neither is worth
inventing accounts for.

**A connector a reader installs is kept the same way**, as the source they gave
rather than as what it evaluated to — a function cannot be written to storage,
and re-reading the text on every load is also the only way to show them what
they installed before it runs again. One that no longer builds is left out
rather than allowed to fail later.

**The panel has to say which pairs are actually recorded.** A list is what a
reader means to watch, which is not the set the collector is capturing; a row
that silently does nothing when pressed is worse than one that says there is no
recording behind it yet.

**Storage is a file the reader can edit.** Everything read back is checked —
a list whose pairs are not pairs takes the picker down on the first render that
walks it, and the source of a connector is about to be evaluated.
