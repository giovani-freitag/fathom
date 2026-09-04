# 11. Log one JSON object per event, and replace a collector that stops

Status: accepted

## Context

A contract stopped recording and stayed stopped for six hours. The gap ledger
accounted for every second of it — 23,790 seconds under `collector was not
running` — while the other three contracts recorded normally throughout. It came
back only because the process itself was restarted.

The supervisor reconciles every fifteen seconds by comparing the enabled set
against a map of runtimes. The map records that a runtime was *built*, never
that it is still capturing, so one that dies is indistinguishable from one that
works. Nothing ever asked.

Why it died is not known, and that is the second half of the problem. Six of the
seven lines a runtime can write carried no contract: `Market data stream lost`,
`Order book desynchronized`, `Order book synchronized with 2023 resting levels`.
With one collector that was readable. With four sharing one file it is not
possible to tell which one lost its stream.

## Decision

The log port carries fields, and a log can bind them: the supervisor hands each
runtime `log.child({ instrumentSymbol })`, so every line that runtime writes
says which contract wrote it without a single call site passing it along.

On a server those fields are serialised by pino, which the gateway already logs
through, into one JSON object per line — searchable with `jq` rather than with a
regular expression over prose. Files roll daily and fourteen are kept. In a page
the same port folds the fields into the sentence, because the only sink there is
a line of text on screen.

The supervisor asks each runtime when it last captured a frame. Past a timeout
it is stopped, dropped from the map, and rebuilt on the same pass. Liveness is
the *capture* clock, not the write: frames queued behind an archive that will
not answer are a degraded runtime, and restarting it would discard the queue
without fixing anything.

## Consequences

A collector that stops is replaced within two minutes instead of surviving until
someone notices. The failure that prompted this would have cost two minutes
rather than six hours.

`pino` was already in the tree as a dependency of Fastify; it is now direct,
because depending on someone else's transitive dependency is a decision they can
reverse. It is confined to the Node adapter by the same rule that confines `pg`
and `ws`, so the page keeps implementing the port by posting to its host.

`pino-roll` ships no types. The ambient declaration for it is hand-written and
covers only the options this project passes and has verified — its documented
`extension` option is ignored by the version in use, so it is not declared.
Files are therefore named `collector.<date>.<roll>.log` and hold JSON, which is
what pino writes by default anyway.

The stall timeout is a guess bounded by the slowest thing a healthy runtime
does, which is resynchronising a book after a dropped stream. If a legitimate
resynchronisation ever takes longer, this will restart a collector that was
about to recover — the cost of that is one gap of a few seconds, against six
hours of silence.
