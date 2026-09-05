# 26. A reader's tags live in their own browser

Status: accepted

## Context

ADR 25 lets a reader bring a venue. A venue is worth bringing so that something
on it can be watched, and watching a hundred pairs across three venues is a
question of which handful matters — so the pairs a reader keeps became a feature
of their own: favourites, and groups they name themselves.

Where those groups live is the decision. Fathom already writes two kinds of
thing down. The recording goes in Postgres, because it is the thing that cannot
be made again and several processes read it. Preferences go in the browser,
because they are one person's and nobody else has to agree with them.

A group of kept pairs looks like it could be either. It is small, structured,
and a reader would be annoyed to lose it.

## Decision

**A tag is a preference, not a recording. It goes in the browser, beside the
layers on the chart and the marks drawn on it.**

Three things settle it.

*There is no reader.* Fathom has no accounts and no sessions. A tag in Postgres
would be everyone's tag — one favourites for whoever opens the page, with the
last person to press a row deciding what the next one sees. Giving tags a table
means first giving the product a notion of who is asking, which is a far larger
decision than where to keep twenty symbols.

*Nothing but the interface reads them.* The collector records the contracts the
control table names; the chart draws what it is pointed at. A tag changes
neither. It decides what a picker shows, and the picker is in the page.

*Losing one costs a minute.* The rule that put the recording in Postgres is that
order book history cannot be backfilled. A tag can: the reader marks four pairs
again. The two are not the same kind of loss and should not get the same
machinery.

**A pair carries tags; it does not live in a list.** The two shapes cost the
same to store and differ in what they can say. BTCUSDT is somebody's majors and
their morning watch on the same morning, and a list makes them keep it twice and
remember both — so a row shows every tag it carries, and the picker is the one
place that can say so.

**A pair is a venue and a symbol, never a symbol alone.** BTCUSDT on two venues
is two recordings with two different pasts, and a tag holding only the symbol
opens whichever the chart finds first.

**A tag is given a colour from the rotation the chart hands its own layers, and
a reader may name any other.** The rotation is what a new tag gets, because it
is already the set that reads on both grounds and the one the chart uses to say
which of two things is which. It is not a limit: there is no cap on how many
tags a reader makes and there are five colours, so the picker offers those five
and then the whole spectrum. A colour from the rotation is stored as the token
and follows the reader between themes; one they named is stored as they named
it, and checked on the way back in, because it is written into a style.

**The first tag is named by the interface, not by storage.** It is stored with
an empty label and rendered as "Favourites" or "Favoritos". A name written into
storage in one language stays in that language after the reader changes it.

## Consequences

**Tags do not follow a reader between machines**, and clearing site data takes
them. Both are true of every preference this build keeps, and neither is worth
inventing accounts for.

**What a reader kept as lists is read as the tags they became.** The two shapes
differ by a colour and a word, so the older key is still read on the way in and
a stored group with no colour is handed one nothing else is using. Reading only
the new key would open the chart with nothing kept.

**A connector a reader installs is kept the same way**, as the source they gave
rather than as what it evaluated to — a function cannot be written to storage,
and re-reading the text on every load is also the only way to show them what
they installed before it runs again. One that no longer builds is left out
rather than allowed to fail later.

**The panel has to say which pairs are actually recorded.** A tag is what a
reader means to watch, which is not the set the collector is capturing; a row
that silently does nothing when pressed is worse than one that says there is no
recording behind it yet.

**Storage is a file the reader can edit.** Everything read back is checked —
a tag whose pairs are not pairs takes the picker down on the first render that
walks it, and the source of a connector is about to be evaluated.
