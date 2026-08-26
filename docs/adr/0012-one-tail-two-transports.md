# 12. One tail, two transports

Status: accepted

Supersedes the arrangement where each registration discovered new history its own way.

## Context

The product has two halves that were meant to behave alike. A collector reads a
snapshot over REST, follows the venue's socket, and writes what it sees — that
much was already shared, because both write through the same archive port and
neither knows which engine is underneath.

What happened next was not shared. On a server the gateway swept the database
every five hundred milliseconds looking for rows it had not seen. In a page the
chart swept its own store on the same interval. Neither side was event-driven,
and the port between the chart and its feed described a stream that neither
implementation actually was.

The cost was not only conceptual. The server's sweep read frames **and**
executions; the page's read only frames, and never sent the text messages the
chart understood. Aggressor bubbles in the demo were frozen until the window was
refetched, and a stretch that went unrecorded while a reader was watching only
appeared after a reload. Two messages had been declared for exactly those cases
and never sent by anyone.

## Decision

One tail, in shared code, with no clock of its own. It holds a reader's cursors
and answers a single question — what has been recorded that this reader has not
seen — and it emits one message union that every transport carries.

Whoever owns a tail decides when it advances. The gateway advances one when the
database says a contract grew; the worker advances one when its own write lands.
Both keep a slow interval behind that, because a trigger that is missed must
cost latency and never data. That is also why the notification carries the
contract that changed and never the rows: a cursor cannot be made wrong by a
message that was dropped, and a payload could be.

The message type is the same on both wires. A socket writes a window of frames
as bytes, because it is two typed arrays per column that JSON would spell out in
digits, and everything else as text; a worker hands the whole thing over by
structured clone. Neither end has a type of its own, so a message the gateway
learns to send is one the page already understands.

The server's notification is the database's, not a second connection. The
archive is already the dependency both processes share; a socket between them
would be one more thing to keep alive, reconnect, and reason about when there
are two gateways.

## Consequences

Executions now reach a demo as they are recorded, and so do gaps. Both were
already implemented on one side; they were unreachable from the other because
the two sides discovered history differently.

A second backend implements the archive and the reader, and then chooses: serve
the shared tail behind a socket, or let the client run it. The chart sees a feed
that delivers messages and cannot tell which it is talking to.

The tail swallows a failed read on purpose, which is what lets a transient
archive keep a reader connected — and is also what hid a broken read behind
working frames while this was being built. The adapters are tested directly for
that reason: a silent catch is only safe when what it wraps is proven elsewhere.
