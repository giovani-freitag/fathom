#!/bin/sh
# Brings the whole of Fathom up inside one container.
#
# Three things have to run and they have to start in order: the database, the
# migrations against it, then the two processes that read and write it. A
# compose file is the usual way to say that, and needing one is exactly what
# this image exists to avoid — somebody trying the project should type one
# command and get a chart.
#
# Everything here is for that reader. A deployment that outlives a laptop wants
# the database in its own container, its own backups and its own upgrade
# schedule, which is what the compose file is still for.

set -e

: "${POSTGRES_USER:=fathom}"
: "${POSTGRES_PASSWORD:=fathom}"
: "${POSTGRES_DB:=fathom}"
export POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB
export DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}"

# The base image's own entrypoint, backgrounded: it knows how to initialise a
# data directory, load the extension and apply the settings, and none of that
# is worth reimplementing here.
/usr/local/bin/docker-entrypoint.sh postgres &
POSTGRES_PID=$!

# Stopping the container has to stop the database cleanly. Without this the
# shell takes the signal and Postgres is killed as the container is torn down,
# which costs a recovery pass on the next start.
stop() {
    kill -TERM "${COLLECTOR_PID:-0}" 2>/dev/null || true
    kill -TERM "${GATEWAY_PID:-0}" 2>/dev/null || true
    kill -TERM "$POSTGRES_PID" 2>/dev/null || true
    wait "$POSTGRES_PID" 2>/dev/null || true
    exit 0
}
trap stop TERM INT

printf 'waiting for the database\n'
until pg_isready -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q 2>/dev/null; do
    if ! kill -0 "$POSTGRES_PID" 2>/dev/null; then
        printf 'the database stopped before it was ready\n' >&2
        exit 1
    fi
    sleep 1
done

node /app/scripts/migrate.mjs

# The collector writes the recording and the gateway serves it. The gateway is
# in front because it is the one a reader is waiting on, and a container whose
# foreground process is the web server stops when the web server does.
node /app/dist/workers/collector.js &
COLLECTOR_PID=$!
node /app/dist/server/main.js &
GATEWAY_PID=$!

printf 'Fathom is on http://localhost:%s\n' "${PORT:-8787}"

# Whichever falls over first ends the container, rather than leaving a chart
# with nothing recording behind it or a recording nobody can read.
wait -n "$COLLECTOR_PID" "$GATEWAY_PID"
stop
