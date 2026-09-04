# 24. The recording lives in one store

## Status

Accepted.

## Context

Two stores held the book at once. A table of one row per instant, carrying both
depth ladders as arrays and clipped to a couple of per cent around the price;
and an archive of the whole book cut into fixed squares, stacked in levels. The
second was built to replace the first, and they were kept side by side so that
the same minutes could be read out of both and compared cell by cell — which is
how two folding bugs were caught that nothing else would have found.

They stayed side by side long after that was the reason. Every layer that
touched the book grew a way to say which one it meant: a query parameter on the
history route, a field on the socket, a constant naming the store the chart
draws, a map of tails on the gateway, a type with two members threaded through
the client. Five rounds of taking them out each left one of those behind, and a
name with one store behind it does not read as a leftover — it reads as a choice
that is simply not offered yet.

Then it stopped being tidiness. The chart was fixed to read the squares, and the
squares only held what had been captured since they existed. Six days of
recording sat in the older table, real and intact and unreachable: the chart
drew them as blank. Worse, a genuine outage was marked in amber and those days
were not, so a reader could not tell "never recorded" from "recorded and not
read" — which is the one distinction the whole gap ledger exists to make.

## Decision

**Everything already recorded was read into the archive first.** Through the
same path the live capture uses, one instant at a time, so what was written is
what a recording writes. Then verified: every day of every contract has blocks
covering it, and nine windows sampled across the whole range agree cell for cell
with the store they came from — a hundred thousand cells in some of them, zero
held by one store and not the other.

**Only then was the other store dropped.** The order is the decision. An order
book cannot be recovered after the fact, so a store is not retired because its
replacement looks right; it is retired once the replacement holds what it held
and can be shown to.

**Nothing names a store any more.** The parameter, the socket field, the
constant, the map, the type: gone, along with the tail that read one and the
route that folded bars out of it. What is left cannot be asked which store it
means, because there is nothing to answer.

**Coverage is read out of the archive.** What a listing says a contract holds —
where it starts, where it reaches, where the market last was — comes from the
blocks themselves, found in the touch prices they carry rather than in the
edges a fixed grid gave them. It used to come from the other table, which is
why a panel could report eight days while the chart drew two.

**The disk budget prunes the archive's own partitions.** It was pruning the
older table's, and would have found nothing to drop.

**An architecture test holds the line.** It fails on the shapes this actually
came back as, five times over: a source type, a map of tails by name, a constant
naming the drawn store, a store name offered on the wire, a read or a write of
the retired table, a migration that would recreate it.

## Consequences

Six days that drew as blank chart now draw. Nothing was lost in the move and a
gigabyte of duplicate recording went with the table.

The cross-check that caught two folding bugs is gone, because there is nothing
left to check against. What replaces it is narrower and honest about being so:
the codec's own round trip, the pyramid rebuilt from the finest level and
compared against itself, and the fact that the finest level is a recording
rather than a fold of one.

A page that recorded under an older build carries a store nothing reads. The
schema upgrade drops it on the way past rather than leaving a visitor to wonder
what is taking the space.

Bars no longer cross this gateway at all. They were folded out of the retired
table, and the chart has taken them from the venue since
[21](0021-fetch-the-candles-and-record-only-the-book.md) — so the route, its
schema and its two continuous aggregates went with the table they read.
