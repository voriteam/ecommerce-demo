# Vori Market

A demo grocery store built on the
[Vori grocer-facing API](https://help.vori.com/api/introduction). The catalog, the
shelf quantities and the sales all belong to a real Vori store: products are seeded from it, stock is
polled from it, and completed checkouts are recorded back into it as transactions.

It is a showcase, not a production system, and it never touches Vori production infrastructure beyond
the API calls it makes with the key you give it.

## Running it

You need Node 20.19+ or 22.12+ (24 is fine, 25 is not), pnpm, and Docker **running** — start Docker
Desktop, or `colima start`, before the next step.

```bash
pnpm install
pnpm setup
pnpm dev
```

| | |
| --- | --- |
| Storefront | http://localhost:8000 |
| Admin | http://localhost:9000/app — `admin@example.com` / `supersecret` |
| API | http://localhost:9000 |

`pnpm setup` starts the containers, creates the environment files, runs migrations, bootstraps an
empty US store, creates the admin user and points the storefront at the backend. It is idempotent,
so run it again whenever you want to be sure the database matches the code.

## The containers

`docker-compose.yml` provides the two services the store needs. `pnpm setup` starts them for you, so
you only need these commands when you want to drive them directly.

```bash
docker compose up -d --wait   # start, and block until both are healthy
docker compose ps             # what is running, and whether it is healthy
docker compose logs -f        # follow both
docker compose stop           # stop, keeping the data
docker compose down -v        # stop and delete the data
```

| | | |
| --- | --- | --- |
| Postgres 17 | `localhost:5433` | `medusa` / `medusa`, database `medusa` |
| Redis 7 | `localhost:6380` | backs the event bus, cache, workflow engine and locks |

Both ports are deliberately off the defaults so this never fights with a Postgres or Redis you
already run locally. If something else has claimed them, change the left-hand side of the `ports`
entries in `docker-compose.yml` and the matching `DATABASE_URL` and `REDIS_URL` in
`apps/backend/.env`.

Data lives in named volumes, so `docker compose stop` and a later `up` keeps your catalog and orders.
To start over from nothing:

```bash
docker compose down -v
pnpm setup
```

Connecting with a database client, or running a query by hand:

```bash
docker compose exec postgres psql -U medusa -d medusa
```

Two things that go wrong, and what they look like:

- **`Cannot connect to the Docker daemon`** from `pnpm setup` — Docker itself is not running. Start
  it and run `pnpm setup` again.
- **`bind: address already in use`** on 5433 or 6380 — something else holds the port. `lsof -i :5433`
  will say what, or change the port as above.

## Filling the shelves

Out of the box the store is empty. Put a store's key and ID in `apps/backend/.env`:

```bash
VORI_API_KEY=sk_live_...
VORI_STORE_ID=...
```

Then:

```bash
pnpm seed:catalog
```

Departments become product categories and store products become products, each carrying its Vori
identifiers. Opening stock comes from the same response, so the shelves have believable quantities
immediately.

Products the demo cannot sell are left out and counted in the summary: gift cards, manual items,
variable-sale-price items and anything with no retail price. Each of those needs something a website
cannot supply — a price typed in at the register, a card balance chosen at the till, an item that
only exists as a cashier button.

Re-running the seed is safe. Products are matched on their Vori identifier, so a second run refreshes
names, prices and stock rather than duplicating the shelves, and it never moves a product's URL.

## Product photography

The Vori API carries no images, so the catalog is illustrated from
[Open Food Facts](https://world.openfoodfacts.org) instead, matched on the barcode that scans at the
register. Roughly half a real grocery catalog gets a photo; the rest is sold without one.

Nothing is downloaded. What is stored against a product is a URL on `images.openfoodfacts.org`, so
this store never hosts anyone else's photography. Their images are contributed by the public under
[CC BY-SA](https://creativecommons.org/licenses/by-sa/3.0/) — credit them if you put this in front of
an audience.

Lookups happen during `pnpm seed:catalog`, batched a hundred barcodes to a request, and a product
that already has a photo is not looked up again. Set `OPEN_FOOD_FACTS_ENABLED=false` in
`apps/backend/.env` to seed without it — useful offline, or when re-seeding repeatedly.

## Watching stock move

A scheduled job polls Vori every two minutes and writes what changed onto the matching inventory
levels. Change a count in Vori and it shows up on the storefront.

Two minutes is a long time to stand in front of an audience, so you can also run it now:

```bash
pnpm sync:inventory
```

or `POST /admin/vori/sync` from the admin session. `GET /admin/vori/sync` shows where the last run
got to.

Vori is the only writer of stock here, so a late poll shows a slightly stale number and never a wrong
one. Set `VORI_SYNC_CRON` to something tighter for a live demo.

A few behaviours are worth knowing about, because each of them is a decision rather than an accident:

- A **fractional count** rounds down. The site never offers more than the store can put in a bag.
- An **oversold** product — Vori reports a negative, because sales outran the last count — reads as
  out of stock, and logs a warning.
- A product Vori has **never counted** is left alone rather than emptied. Unknown is not zero.
- Placing an order reserves stock in Medusa on top of whatever Vori last reported, so an item
  promised to an online shopper is not offered twice before it is collected.

## Recording a sale

Completing a checkout records a transaction against the store: the line items, a card tender and the
payment reference. **Writes are off by default.** Out of the box the store builds the whole request
and stores it on the order without sending it, so the demo is safe to point at any store.

To actually write, in `apps/backend/.env`:

```bash
VORI_WRITE_ENABLED=true
```

Open an order in the admin and its metadata shows exactly what was built and what happened to it:

| `vori_sync_status` | |
| --- | --- |
| `recorded` | Vori accepted it |
| `skipped` | writing is off; the request is on the order, nothing was sent |
| `conflict` | Vori already holds this transaction with different contents — settled, not transient |
| `failed` | rejected, or a request we should not have built |

Anything transient — a timeout, a 429, a 5xx — retries on its own for a few minutes. The transaction
ID is minted and stored on the order before the first send, so every attempt lands on the same record
rather than creating a second sale. To push one order again by hand:

```bash
pnpm record:order order_01ABC...
```

Every order is treated as a pickup order with free shipping. That keeps the arithmetic honest: Vori
re-adds every line and rejects a transaction whose lines do not sum to what was charged, and the
order write refuses to send one that does not reconcile rather than letting a shopper's card
statement disagree with the grocer's books.

## Tax

Tax rates come from the store's own configuration, so beer rings up taxed and groceries do not.

The rates are read from `/v1/tax-rates` at seed time and mirrored as Medusa tax rates, then attached
to the products that carry them. Products embed their own rates too, but only in a compact form that
leaves out whether a rate is still switched on — so the rate list is what decides, and a rate a
grocer has retired stays configured on the product without being charged.

Rounding is the fiddly part. Medusa keeps tax unrounded per line, and Vori rounds at the line and
re-adds from there, so the line figures are rounded before they are sent and the transaction totals
are summed from those rather than recomputed. When the amount charged and the line totals still
disagree, the order write refuses to record and says so — and if the gap is small enough to be the
two systems rounding differently, it says that too.

One kind of rate cannot be carried across. Vori can charge a fixed amount per unit sold, while a
Medusa tax line is only ever a percentage of the taxable amount, so per-unit rates are reported by
the seed and not charged:

```
vori: 2 active tax rates charge a fixed amount per unit, which Medusa cannot express,
      so they will not be charged at checkout: Bottle Excise, Bag Fee
```

If your store uses those, the sale is recorded without them and the total is short by that much.

## Taking payment

Checkout works without Stripe, using Medusa's built-in manual provider. To use Stripe in test mode,
add a test key to `apps/backend/.env` and its publishable pair to `apps/storefront/.env.local`:

```bash
# apps/backend/.env
STRIPE_API_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# apps/storefront/.env.local
NEXT_PUBLIC_STRIPE_KEY=pk_test_...
```

Enable Stripe on the United States region under Settings > Regions in the admin, and forward webhooks
while you work:

```bash
stripe listen --forward-to localhost:9000/hooks/payment/stripe_stripe
```

The Stripe payment intent ID is carried through to the Vori tender, so a sale in the grocer's books
points back at the charge in Stripe.

## Layout

```
apps/backend/src/modules/vori/     the Vori integration
  lib/                             the API contract: client, money, mapping, errors. No Medusa in it.
  models/vori-sync-state.ts        where inventory sync got to
  service.ts                       everything that talks to Vori
apps/backend/src/workflows/vori/   seed the catalog, sync inventory, record an order
apps/backend/src/jobs/             the inventory poll
apps/backend/src/subscribers/      order.placed
apps/storefront/                   the Next.js storefront
```

`lib/generated/schema.d.ts` is generated from Vori's published OpenAPI description, so a field the
API adds, removes or retypes breaks the build rather than failing silently at runtime:

```bash
VORI_OPENAPI_SPEC=path/to/openapi.json pnpm generate:client
```

## Tests

```bash
pnpm test
```

The unit suite covers the money arithmetic, the catalog mapping and the transaction shaping with no
database and no network. The integration suite boots a real application against a throwaway database
and stubs Vori, and covers the parts most likely to break quietly: the seed's skip rules and its
idempotency, and the whole inventory watermark protocol including what happens when a run dies half
way through.

## Deploying

Nothing here assumes local-only, but nothing is deployed yet either.
[Medusa Cloud](https://docs.medusajs.com/cloud) deploys from a GitHub repository and provisions
Postgres, Redis and the storefront; Fly works too with a Postgres attached. Either way the store seed
and catalog seed run the same way they do here.
