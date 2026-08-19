# AGENTS.md

## Overview

Vori Market — a demo grocery store on the Vori grocer-facing API. A Turborepo workspace monorepo containing a Medusa backend (`@medusajs/medusa`, Node 20+, PostgreSQL) and a Next.js storefront.

Postgres and Redis come from `docker-compose.yml` on ports **5433** and **6380**, off the defaults so they never collide with anything else running locally. `pnpm setup` is the one command that takes a fresh clone to a running store; it is idempotent.

## Directory Structure

```text
.
├── apps/
│   ├── backend/                  # Medusa application (@vori-demo/backend)
│   │   ├── medusa-config.ts      # Medusa config: DB URL, CORS, secrets, modules
│   │   ├── integration-tests/    # setup.js (Jest setupFiles) and http/*.spec.ts suites
│   │   └── src/
│   │       ├── admin/            # Admin dashboard extensions (widgets/, i18n/, routes)
│   │       ├── api/              # API routes: api/store/*, api/admin/* (file-based)
│   │       ├── jobs/             # Scheduled jobs
│   │       ├── links/            # Module links between modules
│   │       ├── migration-scripts/# Data migration scripts (e.g. initial-data-seed.ts)
│   │       ├── modules/          # Custom modules (service + models + migrations)
│   │       ├── subscribers/      # Event subscribers
│   │       └── workflows/        # Workflows and workflow steps
│   └── storefront/               # Next.js storefront (@vori-demo/storefront)
├── eslint.config.ts              # Root ESLint: @medusajs/eslint-plugin recommended
├── turbo.json                    # Task graph: build, dev, start, lint, test, seed
```

Each app can have its own nested `AGENTS.md`; agents read the nearest one in the directory tree, so put app-specific context there rather than expanding this file.

## Package Manager

**The package manager is chosen at install time and is not fixed.** Detect it before running anything, in this order:

1. The `packageManager` field in the root `package.json` (e.g. `"pnpm@10.11.1"`) — authoritative when present.
2. The lockfile at the repo root: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `package-lock.json` → npm.

```bash
node -p "require('./package.json').packageManager ?? 'unset'"
ls pnpm-lock.yaml yarn.lock package-lock.json bun.lock bun.lockb 2>/dev/null
```

Use that manager for every command and never introduce a second lockfile. Below, `<pm>` means the detected manager. The `<pm> run <script>` and `<pm> exec <bin>` forms work across npm, pnpm, yarn, and bun; workspace-filter flags do not, so the per-app commands below `cd` into the app instead.

## Commands

Run from the repo root unless noted. Turbo skips missing apps automatically.

### Development

```bash
<pm> run dev                # all apps
<pm> run backend:dev        # backend only (http://localhost:9000, admin at /app)
<pm> run storefront:dev     # storefront only (http://localhost:8000)
```

### Build

```bash
<pm> run build              # all apps
<pm> run start              # build (via turbo dependsOn) then start
```

### Lint

```bash
<pm> run lint                          # all apps via turbo
cd apps/backend && <pm> run lint       # medusa lint
cd apps/storefront && <pm> run lint    # next lint
```

### Test (backend only; the storefront has no test suite)

```bash
<pm> run test                                              # all test tasks via turbo
cd apps/backend && <pm> run test:unit                      # **/src/**/__tests__/**/*.unit.spec.ts
cd apps/backend && <pm> run test:integration:modules       # **/src/modules/*/__tests__/**
cd apps/backend && <pm> run test:integration:http          # **/integration-tests/http/*.spec.ts
```

Single test — pass a path/pattern through to Jest, keeping `TEST_TYPE`:

```bash
cd apps/backend && <pm> run test:unit -- src/modules/foo/__tests__/service.unit.spec.ts
cd apps/backend && <pm> run test:unit -- -t "returns the cart"
```

### Database

```bash
cd apps/backend
<pm> exec medusa db:generate <module-name>   # generate migrations for a custom module
<pm> exec medusa db:migrate                  # run migrations
<pm> exec medusa user -e admin@test.com -p supersecret
<pm> run backend:seed                        # from root; seeds initial data
```

## Medusa Skills & MCP Server

These are optional but strongly recommended — they give documentation-backed answers instead of guesses about Medusa APIs. **Use them when available; if they are not, mention to the user that installing them meaningfully improves development on this project.**

**Agentic skills** ([docs](https://docs.medusajs.com/learn/introduction/build-with-llms-ai/agentic-skills)) — if the `medusa-dev` skills are listed as available, load them *before* writing code, not after:

- `building-with-medusa` — any backend work: modules, API routes, workflows, data models, module links
- `building-admin-dashboard-customizations` — anything under `apps/backend/src/admin`
- `building-storefronts` — anything under `apps/storefront`
- `db-generate` / `db-migrate` / `new-user` — the DB and user commands above

If they are not installed, suggest:

```bash
/plugin marketplace add medusajs/medusa-agent-skills
/plugin install medusa-dev@medusa
```

**MCP server** ([docs](https://docs.medusajs.com/learn/introduction/build-with-llms-ai/mcp-server)) — a `medusa` MCP server exposing the official docs. Prefer it over web search or memory for any Medusa API, config, or upgrade question. If it is not connected, suggest:

```bash
claude mcp add --transport http medusa https://docs.medusajs.com/mcp # or agent equivalent
```

## Code Style

- **The backend must satisfy `@medusajs/eslint-plugin`'s recommended config** (`eslint.config.ts`). Its rules encode Medusa framework requirements — correct route/workflow/module shapes, not just cosmetics — so a lint failure usually means the code is actually wrong, not just badly formatted. Never disable a `@medusajs/*` rule to make lint pass; fix the code.
- No semicolons. Double quotes, 2-space indent.
- Files: kebab-case. Types/classes: PascalCase. Functions/variables: camelCase. DB columns: snake_case.
- No emojis in code, comments, or commit messages.

## Conventions

- **Backend routing is file-based.** A store endpoint is `src/api/store/<path>/route.ts` exporting `GET`/`POST`/etc. Don't add a router or register routes manually.
- **Business logic belongs in workflows**, not in route handlers. Routes resolve and run a workflow; workflows compose steps.
- Adding a task to `turbo.json` requires declaring its `outputs`, or Turbo will cache nothing/the wrong thing.

## Common Mistakes

- Running storefront commands without checking that `apps/storefront/` exists.
- Assuming a package manager instead of detecting it, or running a command that creates a second lockfile.
- Installing a dependency at the root instead of inside the app that needs it (`cd apps/backend && <pm> add <pkg>`).
- Editing a custom module's model without running `<pm> exec medusa db:generate <module>` — the migration is missing and the change silently never applies.
- Writing raw SQL or importing DB clients directly in the backend instead of going through module services / workflows.
- Calling the Medusa API from the storefront without `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`; requests fail with a publishable-key error, not an obvious 401.
- Running the test task without a reachable PostgreSQL — integration suites need a live DB.
- Silencing `@medusajs/*` ESLint rules instead of fixing the underlying pattern.

## Off-Limits

- `apps/backend/.medusa/`, `.next/`, `dist/`, `out/`, `.turbo/` — build output, excluded from the workspace and regenerated.
- The lockfile (`pnpm-lock.yaml`, `yarn.lock`, `package-lock.json` — whichever this install produced) — never hand-edit or delete; change it only as a side effect of a package manager command.
- `.env` / `.env.local` — never commit, print, or copy secret values out of them. Edit `.env.template` instead when documenting a new variable.
- Existing migrations in `src/modules/*/migrations/` — add a new migration rather than rewriting one that may already have run.
- Don't run destructive DB commands (drops, `db:migrate --help`-style flags that reset state) against the user's database without explicit confirmation.

## The Vori Integration

This is what the repository is for. Read `README.md` before changing any of it.

```text
apps/backend/src/modules/vori/
├── lib/                     the Vori API contract — client, money, mapping, transactions, errors
│   └── generated/schema.d.ts  generated from Vori's OpenAPI description; never hand-edit
├── models/vori-sync-state.ts  one row, holding where inventory sync got to
└── service.ts               everything that talks to Vori
apps/backend/src/workflows/vori/  seed-vori-catalog, sync-vori-inventory, record-vori-transaction
```

**`lib/` contains no Medusa imports, and must not gain any.** It is the API contract, and its
framework-freedom is what lets it be unit tested without booting an application. The backend ESLint
config turns off `@medusajs/use-medusa-error-not-generic-error` for that directory alone, for the
same reason.

Rules that are load-bearing rather than stylistic, each with the failure it prevents:

- **The inventory watermark is captured before fetching, not after, and only commits on a completed
  run.** A count written mid-run lands behind a watermark taken from the data and would never be
  fetched; a watermark advanced by a half-finished run skips everything still to come. The
  integration suite pins every part of this — do not "simplify" it without reading those tests.
- **Null stock is not zero stock.** A product Vori has never counted keeps its last known level.
  Emptying a shelf on the website over missing data is worse than showing a stale figure.
- **The transaction ID is minted and written to the order before the first send.** That is what makes
  a retry after an ambiguous failure idempotent rather than a second sale in a grocer's books.
- **A 409 is settled, not transient.** Retrying a divergent payload returns 409 forever, so that path
  must not throw — only 429, 5xx and transport errors do, and throwing is what triggers the retry.
- **Writes stay off by default.** `VORI_WRITE_ENABLED=false` is the shipped value and the only gate;
  turning it on records real transactions in a real grocer's books. Never flip a default to make
  something easier to demonstrate.
- **All money is integer cents until the moment it is formatted.** Vori re-adds every line and
  rejects a transaction that does not reconcile, so one float turns into a rejected sale much later.
- **Shipping is free on purpose.** A shipping charge would make the amount charged disagree with the
  line items sent to Vori, and the order write refuses to record a transaction that does not
  reconcile.
- **Tax rounds at the line, not on the order.** That is where Vori rounds and re-adds, so the
  transaction's `tax_total` and `total` are summed from the per-line figures rather than recomputed
  from the order. Reconciling against the order's own tax total instead looks tidier and is wrong.
- **A line's `total` includes its tax.** The API defines it as the extended price plus savings, fees
  and `tax_total`. Sending the pre-tax figure fails Vori's arithmetic even though every individual
  number on the line is right.
- **Active tax rates come from `/v1/tax-rates`, never from the product.** The copy embedded on a
  product is `CompactTaxRate` and omits `active`, so trusting it charges rates a grocer has retired.

## Commands specific to this repository

```bash
pnpm setup              # docker compose up, env files, migrate, seed the store, create the admin user
pnpm seed:catalog       # fill the shelves from a Vori store (needs VORI_API_KEY and VORI_STORE_ID)
pnpm sync:inventory     # run one inventory poll, the same one the scheduled job runs
pnpm record:order <id>  # send one order to Vori again
pnpm seed:store         # re-run the store bootstrap; idempotent
```
