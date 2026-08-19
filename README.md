# Vori API demo storefront

A grocery e-commerce site built on the [Payload ecommerce
template](https://github.com/payloadcms/payload/tree/main/templates/ecommerce),
wired to the Vori grocer-facing API in both directions:

- **Reads** — a scheduled poll of `GET /v1/store-product-inventory` mirrors
  on-hand quantities onto the storefront, so a count entered on the store floor
  changes what the site says is in stock a minute or two later.
- **Writes** — every completed order is recorded via `POST /v1/transactions`,
  landing in Vori reporting next to in-store sales.

Vori is the only writer of stock: the ecommerce plugin validates against
`inventory` at checkout but never decrements it, so there is nothing to
reconcile and the poll interval is a freshness setting, not a correctness one.

Demo and sales artifact, not a production system.

## Setup

Node 24, pnpm 10.

```bash
pnpm install
cp .env.example .env      # fill in the values below
pnpm dev                  # http://localhost:3000
```

Create the first admin user at `/admin`, then seed the catalog:

```bash
pnpm seed:catalog         # Vori departments + products -> this storefront
pnpm sync:inventory       # run the inventory poll once, by hand
```

| Variable | What it does |
| --- | --- |
| `PAYLOAD_SECRET` | Signs Payload sessions. Any long random string. |
| `DATABASE_URI` | `file:./ecommerce-demo.db` locally, `file:/data/ecommerce-demo.db` on Fly. |
| `NEXT_PUBLIC_SERVER_URL` | Public origin of the site. |
| `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe **test mode**. This demo never takes a real payment. |
| `STRIPE_WEBHOOKS_SIGNING_SECRET` | From `pnpm stripe-webhooks`. |
| `VORI_API_KEY` | `sk_live_…` from [app.vori.com/retail/api-keys](https://app.vori.com/retail/api-keys). Needs read on products, write on transactions. |
| `VORI_STORE_ID` | Store to read the catalog from and record sales against. |
| `VORI_SYNC_CRON` | Poll interval. Defaults `*/2 * * * *`. |
| `VORI_WRITE_ENABLED` | Defaults **`false`**. |
| `VORI_DRY_RUN` | Defaults **`true`**. |

**The two write switches default to off.** With either in its default position,
orders are still fully built and the exact request body is stored on the order,
so you can see precisely what *would* be sent before enabling anything.

`VORI_API_KEY` is server-only — no `NEXT_PUBLIC_` prefix, so Next never inlines
it client-side, and `src/vori/serverOnly.ts` throws if a module carrying it is
ever evaluated in a browser.

## Demo script

1. Browse the store — real departments, barcodes, prices, per-pound items.
2. Note the stock figure on a product page.
3. Change that product's count in Vori.
4. Force a poll: `POST /api/vori/sync-inventory` (admin session required), or
   just wait for the cron.
5. Refresh. The number follows.
6. Check out with Stripe's test card `4242 4242 4242 4242`.
7. Open the order in the admin: the sidebar shows its Vori status, and the
   payload panel shows the exact JSON sent and what came back.
8. Find the sale in Vori — attributed to the store's virtual e-commerce lane, so
   filtering by lane separates web orders from in-store ones.
9. Re-run the job for that order: the API returns the transaction already
   recorded rather than creating a second one, because the UUIDv7 idempotency
   key is minted once at order creation and reused on every attempt.

## Deploying to Fly.io

Fly rather than serverless because the inventory poll runs in-process on a cron
and the poll interval *is* the demo — hence `auto_stop_machines = 'off'` and one
machine, since two would share one SQLite file and both poll.

```bash
fly launch --no-deploy
fly volumes create data --size 1 --region sjc
fly secrets set PAYLOAD_SECRET="$(openssl rand -hex 32)" \
  STRIPE_SECRET_KEY=sk_test_… NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_… \
  STRIPE_WEBHOOKS_SIGNING_SECRET=whsec_… \
  VORI_API_KEY=sk_live_… VORI_STORE_ID=…
fly deploy
fly ssh console -C "pnpm seed:catalog"
```

The container migrates the database on the volume before starting the server.
Schema push is off in production, so migrations are the only thing that touches
the schema.

## Not included

- **Tax.** Transactions are submitted with `tax_total: "0.00"`. Vori enforces
  that payments reconcile with line totals, and Stripe charges exactly the sum
  of the product prices, so taxing one side and not the other would make every
  transaction irreconcilable. The store's real tax rates are still carried onto
  each product. Charging tax means changing what Stripe collects.
- **Refunds**, shipping, promotions and loyalty, multiple stores.

## License

MIT. Portions derive from the Payload ecommerce template, also MIT.

## Working on it

```bash
pnpm test            # unit + integration, against a real SQLite file
pnpm lint
pnpm build
```

The Vori API types in `src/vori/generated/schema.d.ts` are **generated**, not
written — a field the API adds or retypes breaks the build rather than surfacing
later as a rejected transaction. To regenerate against a newer spec:

```bash
VORI_OPENAPI_SPEC=/path/to/openapi.json pnpm generate:client
```

`src/vori/client.ts` adds only what a spec cannot express: bearer auth, the
documented `Retry-After` backoff, cursor pagination, and a request log.

Two things worth knowing before changing anything: the template is pinned to the
`v3.88.0` tag (its `main` targets an unreleased Payload and does not typecheck
against the published packages), and the storefront renders dynamically
everywhere, because a prerendered product page would serve stock frozen at build
time.
