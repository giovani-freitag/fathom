# 25. A reader brings the venue as well as the indicator

Status: accepted

## Context

An indicator is something a reader writes. A venue is not: the four contracts in
the picker are the four the collector was configured for, and the only way to
chart a fifth is to edit the environment and restart. That is a limit the
architecture imposes rather than one anybody chose — an addon is meant to be how
a reader adds a capability, and an indicator is one kind of addon, not the only
kind.

The data shapes were already ready for this. `DepthUpdate`, `DepthLadder`,
`ExecutedTrade` and `TopOfBook` have said "in venue-neutral terms" since they
were written. What was Binance's was the parsing, the URLs, the candle tuple
indices, and one field: `previousFinalUpdateId` is that venue's `pu`, a back
reference no other venue publishes under that name and several publish not at
all.

But a venue is not an indicator, and the difference is the whole design. An
indicator is a pure function from bars to vertices, called on every draw; the
worst it does is draw something wrong, on a frame that is replaced sixty times a
second. A connector runs inside the collector — **the half that must not stop** —
and what it records wrong cannot be recorded again. ADR 1 is the reason this
project exists; a connector is the first thing a reader can install that can
violate it.

## Decision

**A connector describes and reads. The engine performs and measures.**

Every connector method is pure and synchronous, and every argument and return is
plain data. A connector holds no socket, no promise and no timer. The host owns
the connection, the backoff, the paging, the mirror and the clock.

This is not a style preference; it is the answer to the failure that killed
every other shape considered. `CollectorSupervisor.reconcileNow` awaits each
recording it tears down. A connector that owned its socket would own a `close()`,
and a `close()` that never settles wedges the reconcile pass **for every contract
on the machine, permanently** — one bad connector stopping four good recordings.
No deadline fixes it; a synchronous contract makes it impossible.

**Every capability is declared on both sides, and every field is `T | null`.**

The connector declares what it offers in a `declaration` — a value, not a call.
There are no optional properties: an author must type `null` to say no, and
typing it is the moment they read what the engine does instead. Default-yes is a
connector that lies into an archive that cannot be rewritten. Default-no is a
chart quietly drawing less than it could, for ever, with nobody told why.

The indicator declares what it needs through `SourceRequest.needs`. This is
ADR 22's sentence — *"an indicator says which rungs it reads"* — with facts in
place of rungs, and resolved per settings, so `volume` asks for the taker split
only when the reader picked its two-tone mode. Five shipped readings gain one
line each. Without both halves the engine cannot adapt; it can only draw nothing.

**Three rules settle every conflict between what was declared and what arrives.**

1. *The declaration bounds what the engine asks for; the events bound what it
   claims; the weaker wins.* Declare a sided tape, then send prints with no side,
   and that bar records unsided volume. A declaration can never talk the engine
   into recording something stronger than what arrived.
2. *A declaration may only make the engine stricter, never looser.* Every figure
   is clamped and then held to `min(declared, observed)`. The field a stalling
   connector would want to widen — how long silence is tolerated — is the one
   that decides whether its stall is ever noticed.
3. *Every claim is paired with a measurement, or it is not a claim.* Internal
   consistency is checked at registration; what the venue actually does is proved
   by the engine against the traffic, without the connector's cooperation.

**A sequenced book is a grade, not a yes or no.** ADR 3 requires every diff to
carry the identifier of the one before it, and closes by saying a driver for a
venue without that chain *"will need a weaker check, and should say so rather
than pretend the guarantee still holds."* This is that sentence made good:
`linked` is today's check, `ranged` and `stepped` are the weaker ones real venues
support, and `unsequenced` is the admission — which costs a floored deep-repair
interval and a chart that says the history was never verified.

## Consequences

**The taker split comes from the bars, not from the tape.** Five of the eighteen
shipped readings compute over `input.bars.bars`, and outside Binance not one
candle endpoint publishes a taker split — not Bybit, OKX, Kraken, Coinbase,
KuCoin or Deribit. So a sided tape grants the fact only where the bars are folded
from that tape. Anything else shows cumulative delta correct over the collector's
uptime and blank before it, with the seam moving on every restart.

**The rung ladder stops being global.** ADR 21 says the ladder is the rungs the
candle API publishes, which was one list while there was one API. It becomes a
property of the connector, and a rung a venue does not serve is dropped rather
than raised — the rule ADR 22 already applies to the sessions an indicator asks
for, one level up.

**Two holes are left open, and neither has a defence.**

*Under-claiming is unfalsifiable.* A connector with a linked chain that declares
itself unsequenced can never be contradicted: the evidence for the claim is an
absence. Every falsifiability argument here runs one direction. The incentive is
thin — under-claiming buys the author nothing but less code, and costs them a
dimmer chart — but a lazy author gets a poorer chart than the venue could give,
and nothing tells them so.

*A connector wrong in the same way on both of its code paths, from its first
byte, on a symbol with no history.* The cross-check compares the REST path
against the socket path, which is the common shape of that bug and catches
nothing when both are scaled identically. The only real defence is a second
price source, and a reader is writing this connector precisely because Fathom has
none for that venue. What is left is a fingerprint on the recording, which makes
the stretch findable and deletable afterwards. That is a confession, not a
defence.

**Installing a connector is a heavier decision than installing an indicator, and
the interface has to say so.** The import flow already lists every file, its size
and its hash before fetching a byte, and says the code runs in the page. For a
connector that warning is not enough: an indicator that misbehaves costs a
repaint, and a connector that misbehaves costs a recording that cannot be made
again.

## What was built, and what was not

Written after the fact, because an ADR that describes an intention as though it
were a state of affairs is the kind of document somebody trusts and should not.

**Built and in use.** `VenueDeclaration` and `VenueConnector` with every field
required and every capability `T | null`. The registry, refusing a connector that
declares one thing and reads another. `VenueGateway`, which performs every plan
under one timeout, one size limit, HTTPS only and no cookies. The Binance
connector, which is now the only file in the tree that names that venue. The
collector's feed, the chart's candles and the contract picker all read through a
connector. `SourceRequest.needs` on five shipped readings, and the palette that
puts a layer out of reach with the reason on the row. A reader writes a connector
in the same editor as a reading, and which of the two it is comes from what the
file exports.

**Not built.** The two conflict rules about what arrives: events are not yet
clamped against the declaration, and no figure is held to `min(declared,
observed)`. The book grade is declared and not yet acted on — the mirror still
requires the back reference Binance publishes, so a `ranged`, `stepped` or
`unsequenced` venue is declared honestly and cannot yet be recorded. A connector
can only describe a GET, which is the reason the KuCoin example declares no book:
that venue hands out its socket through a POST for a short-lived URL, and a
connector that describes requests rather than making them cannot ask for one.
And a connector a reader installs lives in their browser, so the server's
collector cannot see it: a venue brought in this way gives the chart a listing
and a past, not a recording.

Each of those is a smaller decision than the contract itself, and none of them
changes it. They are named here so that nobody reads the section above as an
inventory.

The design was settled by four independent proposals — one maximising what a
connector may decline, one minimising the surface, one mirroring the indicator
surface, one starting from the damage a bad connector does — each attacked twice,
by real venue APIs and by a hostile-connector scenario. Every proposal was judged
fatally holed; this is what survived answering them.
