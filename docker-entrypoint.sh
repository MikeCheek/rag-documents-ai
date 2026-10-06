#!/bin/sh
# Brings the database schema up to date, then starts the app (with its
# background worker, see instrumentation.ts).
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL is not set." >&2
  exit 1
fi

# The database may still be starting: retry the migrations for a while.
tries=0
until node scripts/migrate.mjs; do
  tries=$((tries + 1))
  if [ "$tries" -ge 15 ]; then
    echo "Couldn't migrate the database, giving up." >&2
    exit 1
  fi
  echo "Database not ready, retrying in 2s..." >&2
  sleep 2
done

exec node_modules/.bin/next start -H 0.0.0.0 -p "${PORT:-3880}"
