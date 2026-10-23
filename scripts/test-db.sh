#!/usr/bin/env bash
# Make sure a disposable Postgres and Redis are reachable for the integration tests.
# Uses the compose services (started on their own if the stack is down); the suite
# creates and migrates its own *_test database and never touches `social`.
#
# Host ports follow SOCIAL_PG_PORT (5452) and SOCIAL_REDIS_PORT (6389). When something
# already answers on both, nothing is started.
set -euo pipefail
cd "$(dirname "$0")/.."
pg_port="${SOCIAL_PG_PORT:-5452}"
redis_port="${SOCIAL_REDIS_PORT:-6389}"

listening() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

if listening "$pg_port" && listening "$redis_port"; then
  exit 0
fi
scripts/gen-local-env.sh >/dev/null # creates .env, or adds keys an older one lacks
docker compose --env-file deploy/compose/.env -f deploy/compose/compose.yaml up -d --wait postgres redis >/dev/null
