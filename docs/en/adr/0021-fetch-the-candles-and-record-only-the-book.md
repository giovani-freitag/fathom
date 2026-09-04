# 21. Fetch the candles, record only the book

## Status

Accepted. Completes ADR 0001, which acted on half of its own first sentence.

## Context

ADR 0001 opens: *candles can be fetched for any past day from any venue; the
order book cannot.* It then arranged the whole system around the second half.
The first half was never acted on — bars were built from the recorded book mid,
so the price a chart drew reached back exactly as far as the recording did.

## Decision

**Candles and volume come from the venue's candle API. The book comes from the
recording.** Different questions, different sources, no overlap.

**The bar ladder is the rungs that API publishes.** It started at a second, from
when bars came out of the recorded book; a minute is the finest candle there is,
so a minute is where it starts.

**One source per question, with no fallback between them.** A bar that came from
the venue on a good day and from the recording on a bad one would be a bar whose
meaning depended on the network.

## Consequences

The chart opens on history. The browser-only build is a usable chart in its
first second rather than after a day of leaving a tab open, and the recording it
is accumulating fills the heatmap in from the right.

Nothing about the view answers to the recording any more: the spans are all
offered, the viewport reaches back to a declared horizon rather than the first
recorded frame, and a window is no longer narrowed to what was captured.

A quarter of an hour now holds fifteen candles where it held nine hundred. That
is the price of a candle that means the same thing on every chart that draws
one, and the second-by-second reading it replaces is the heatmap underneath.

Framing the price axis had to learn the difference between a bar on screen and a
bar in hand: warm-up bars reach back days at an hourly rung, and had never
contained anything before because the archive had no history to give.
