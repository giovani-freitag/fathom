#!/usr/bin/env bash
# Applies every migration in order. Each one is idempotent, so re-running is safe.
set -euo pipefail
for migration in database/migrations/*.sql; do
    echo "applying $(basename "$migration")"
    docker compose exec -T timescaledb psql -v ON_ERROR_STOP=1 -U fathom -d fathom < "$migration" > /dev/null
done
echo "migrations applied"
