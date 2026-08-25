# 1. Record continuously, because book history cannot be backfilled

Status: accepted

## Context

Candles can be fetched for any past day from any venue. The order book cannot.
No exchange sells yesterday's resting depth, and no archive reconstructs it.
An hour in which nothing was recording is an hour that never existed.

## Decision

The collector is the part of the system that must not stop. Everything else —
the gateway, the chart, the schema — is arranged so that it never has to.

Concretely: the collector is its own process with no dependency on the gateway;
a database outage buffers writes rather than dropping them; and every stretch
that could not be recorded is written to a ledger so the chart can draw the
hole instead of a smooth line across it.

## Consequences

Uptime beats every other property, including storage efficiency and query
speed. A change that risks the write path to save bytes is a bad trade.

Storage is bounded by what is recorded, not by what is kept: retention that
deletes old depth destroys the only copy. The band recorded today can never be
widened retroactively, which makes recording width a decision with a clock on
it in a way that compression never is.
