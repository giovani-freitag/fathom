# 5. Read a window with one scan, not a probe per column

Status: accepted

Supersedes the lateral-probe query used until this decision.

## Context

A chart column is narrower than the recording for any window wider than a few
minutes, so a read has to reduce many frames to one per column. The first
implementation asked for exactly that: a generated series of column starts, and
for each one a lateral subquery taking the first frame inside it.

On row-oriented storage each probe is an index seek costing 0.018 ms. It looked
optimal.

## Decision

Select the range once and keep the first frame of each bucket with `DISTINCT ON`
over a time bucket, then fold the result in the application.

## Consequences

The probe shape is pathological against columnar storage, where answering one
row means decompressing the batch of a thousand it belongs to. Measured on the
same one-hour window:

| storage | lateral probes | one scan |
| --- | --- | --- |
| row chunk | 141 ms | 120 ms |
| columnar chunk | 7,350 ms | 147 ms |

Because chunks convert to columnar on an age policy, the pathological case was
invisible until history crossed that age — every window tested early fell in
recent data. Read performance now has to be measured on both storage kinds, not
only on the one the last few hours happen to use.
