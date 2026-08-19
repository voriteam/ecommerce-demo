#!/bin/sh
# Bring the database on the mounted volume up to the schema this image
# expects, then hand over to the server.
#
# Schema push is disabled in production (see payload.config.ts), so this is
# the only thing that creates or alters tables. It is idempotent: Payload
# records which migrations have run and skips them on the next boot, so a
# redeploy that changes nothing about the schema is a no-op here.
set -e

echo "Migrating ${DATABASE_URI:-<DATABASE_URI unset>}"
pnpm migrate

echo "Starting server"
exec "$@"
