#!/usr/bin/env bash
#
# Everything between a fresh clone and a running store.
#
# Idempotent: run it again after pulling, or whenever you want to be sure the
# database matches the code.
set -euo pipefail

cd "$(dirname "$0")/.."

step() { printf "\n\033[1m==> %s\033[0m\n" "$1"; }

step "Starting Postgres and Redis"
docker compose up -d --wait

step "Preparing environment files"
if [ ! -f apps/backend/.env ]; then
  cp apps/backend/.env.template apps/backend/.env
  # Has to be 32 bytes of hex, and has to be stable across restarts.
  MFA_KEY=$(openssl rand -hex 32)
  perl -pi -e "s|^AUTH_MFA_ENCRYPTION_KEY=.*$|AUTH_MFA_ENCRYPTION_KEY=${MFA_KEY}|" apps/backend/.env
  echo "Created apps/backend/.env — add VORI_API_KEY and VORI_STORE_ID to fill the shelves."
else
  echo "apps/backend/.env already exists, leaving it alone."
fi

if [ -d apps/storefront ] && [ ! -f apps/storefront/.env.local ]; then
  cp apps/storefront/.env.template apps/storefront/.env.local
  echo "Created apps/storefront/.env.local"
fi

step "Installing dependencies"
pnpm install --frozen-lockfile

step "Running migrations and seeding the store"
pnpm --filter @vori-demo/backend exec medusa db:migrate

step "Creating the local admin user"
pnpm --filter @vori-demo/backend exec medusa user -e admin@example.com -p supersecret \
  || echo "Admin user already exists, leaving it alone."

step "Pointing the storefront at the backend"
pnpm --filter @vori-demo/backend exec medusa exec ./src/scripts/link-storefront.ts

if grep -qE '^VORI_API_KEY=.+' apps/backend/.env && grep -qE '^VORI_STORE_ID=.+' apps/backend/.env; then
  step "Filling the shelves from Vori"
  pnpm --filter @vori-demo/backend exec medusa exec ./src/scripts/seed-vori-catalog.ts
else
  step "Skipping the catalog"
  echo "VORI_API_KEY and VORI_STORE_ID are not both set in apps/backend/.env."
  echo "Set them and run 'pnpm seed:catalog' to fill the shelves."
fi

cat <<'DONE'

Ready. Start it with:

  pnpm dev

  Storefront  http://localhost:8000
  Admin       http://localhost:9000/app   admin@example.com / supersecret

DONE
