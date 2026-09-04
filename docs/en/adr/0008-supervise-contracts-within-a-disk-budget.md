# 8. Supervise contracts from one process, within a disk budget

Status: accepted

Supersedes the one-process-per-contract arrangement and the idea of a free-disk alarm.

## Context

Recording a second contract used to mean a second service unit with its own
environment file. That put the decision of what to follow in the deployment,
where it is made once and never revisited, when it is really a decision made
while looking at the chart.

Unbounded growth had no answer at all. The obvious one — warn when the disk gets
low — tells a reader something is wrong at the moment it is too late to act
without losing something.

## Decision

One supervisor process holds a collector per enabled contract, reads the enabled
set and the disk budget from the database every fifteen seconds, and closes the
difference. The browser demo already keeps a window rather than a history; the
server now does the same thing, with the ceiling in bytes rather than frames.

The supervisor reconciles rather than reacts to events. A missed change costs one
interval; a missed event would cost a contract that silently stopped recording.

## Consequences

Four contracts run in 107 MB, which is what one used to take: the cost was
almost entirely the runtime, not the recording. Turning one off does not touch
the others, and turning it back on resumes within an interval.

Granularity differs between the two engines because the engines force it. The
browser drops frames, one key range at a time. The server drops whole daily
partitions, because deleting rows from a compressed chunk decompresses the batch
to rewrite it and returns no disk at all — the opposite of what a reader asking
for less disk wants. Ten gigabytes is roughly nine months of three contracts,
released a day at a time.

Dropped time is not recorded as a gap in either engine. A gap means the recording
failed; this is history that was recorded and released, and the coverage the
chart reports moving forward is the honest signal.

The budget has a floor of one gigabyte. A ceiling below what is already stored
would drop every partition the moment it was set, and a control that can erase
the archive with one click is not a control.

Two things this cost. A collector no longer owns the archive it writes to —
several share one, so opening and closing moved to whoever built it, and a
runtime that closed it would stop every other contract mid-write. And the
environment variable naming a contract is now only a seed for a fresh database,
which is a second source of truth for as long as it stays.
