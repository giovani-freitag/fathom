# 21. Fetch the candles, record only the book

## Status

Accepted.

## Context

ADR 0001 says the book cannot be backfilled and the collector must not stop. It
opens by noting the other half of that: *candles can be fetched for any past day
from any venue*. The implementation only ever acted on the first half. Bars were
built from the recorded book mid and volume from the recorded executions, so the
price a chart drew reached back exactly as far as the recording did and no
further.

On a server that had been recording for months this was invisible. On the
browser-only build it is the whole first impression: the collector is the
reader's own tab, so a chart opened on a week showed a few minutes of candles
pressed into a sliver at the right edge and nothing else. A reader cannot tell
that from a broken chart, and the spans they might have pressed to find out were
disabled for want of coverage.

Deriving the price from the recording was never a requirement. It was the
cheapest thing to do once the frames were already there.

## Decision

**The candles and the volume come from the venue; only the book is recorded.**
A venue publishes both for every past day, and neither needs a collector to have
been running.

**Below a minute, the recording still answers.** No venue publishes a candle
finer than a minute. A chart zoomed in that far is looking at seconds of book
anyway, and the bars derived from it are the only ones that exist at that width.

**The venue is reached from the browser, not through the gateway.** A candle is
public history; routing it through the gateway would mean the browser-only build
could not have one at all, and would put a second network hop between a reader
and something the venue serves them directly.

**A venue that cannot be reached falls back to the recording.** What was recorded
is still there, and drawing that is better than drawing nothing.

**The spans stop answering to coverage.** They were gated on how much had been
recorded, from when the price came out of the recording too. A week is a week
whatever this chart holds of the book, and what it holds of the book is drawn as
the book — which is where the answer belongs.

## Consequences

The chart opens on history. The browser-only build is a usable chart in its
first second rather than after a day of leaving a tab open, and the recording it
is accumulating shows up as the heatmap filling in from the right.

A window is no longer pulled in to the recorded extent, and the viewport reaches
back to a declared horizon rather than to the first recorded frame. The clamp
that narrowed a window to what had been recorded is gone with the reason for it.

Framing the price axis had to learn the difference between a bar on screen and a
bar in hand. Warm-up bars reach back as far as the longest reading needs — days,
at an hourly bar — and they had never contained anything before, because the
archive had no history to give. Framing on them put the candles in a corner of
an axis stretched over a week the window did not cover.

The two sources disagree by less than they might: the recorded bar is the book
mid and the venue's is the traded price, which differ by half a spread — inside
one price bucket on any contract worth charting. The volume was already the
recorded executions rather than the book, so it changes source but not meaning.

A reader behind a network that reaches their gateway but not the venue gets the
recording, as before. That is the fallback working, not a failure.
