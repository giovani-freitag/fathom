# 7. Register the same collector in the browser

Status: accepted

## Context

The repository's front door is a chart nobody can see without provisioning
PostgreSQL first. A visitor who wants to know what a liquidity heat map looks
like has to install a database to find out.

The obvious answer is a hosted demo, and the obvious way to build one is to
write a smaller version of the collector that runs in a page. That is the
answer to avoid: two implementations of order book reconstruction drift, and
the one nobody runs in production is the one that quietly stops being right.

## Decision

Treat the collector as a unit of execution with a message contract rather than
as Node code. The server registers it as a process; the browser registers the
same class as a Web Worker. Neither owns the collector; both configure it.

Three things had to become dependencies for that to be true, and each one was a
platform detail the collector had no business knowing:

- **The socket.** `MarketDataSocket` is four callbacks. `ws` is now named in one
  file of the whole repository, which is what keeps it out of a page's bundle.
- **The archive.** `LiquidityArchive` is where recorded frames go — PostgreSQL
  on a server, IndexedDB in a page. It lives in its own file, apart from the
  PostgreSQL implementation, because a project that imports that implementation
  imports `@types/pg`, which references `@types/node`, and every Node global
  silently starts typechecking in a browser build.
- **The log.** A process writes to its own streams; a Worker has none and posts
  to the page.

Timers were the fourth: `unref` exists only in Node, so it is reached through a
feature-detecting helper rather than called directly.

## Consequences

`OrderBookService`, `OrderBookState`, `BinanceDepthFeedService`,
`buildLiquidityFrame`, `TradeClusterAccumulator`, `ArchiveWriteBuffer` and
`LiquidityRecorderService` run unmodified in both registrations, and so does
every part of the chart. The demo and the product cannot disagree about what a
frame is, because there is only one implementation of it.

The demo keeps a window rather than a history: the newest frames up to a share
of the device's quota, oldest dropped first. Measured at 1,300 bytes a frame,
that is days on a desktop and hours on a phone. Dropped time is **not** recorded
as a gap — a gap means the recording failed, and this was recorded and released.
The coverage the chart reports moving forward is the honest signal.

Two failures are specific to this registration and are handled rather than
hidden. A hidden tab has its timers slowed to about one wake a minute, so the
seconds it misses become gaps and the page says why. A browser that refuses
storage gets a page explaining that, instead of an empty canvas that reads as a
broken build.

The demo can still lose everything: browsers evict storage under pressure, and
`navigator.storage.persist()` is a request, not a guarantee. That is acceptable
precisely because the chart never claims coverage it does not have.
