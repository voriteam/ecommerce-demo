import { medusaIntegrationTestRunner } from "@medusajs/test-utils"

import initialDataSeed from "../../src/migration-scripts/initial-data-seed"
import {
  addShippingMethodToCartWorkflow,
  completeCartWorkflow,
  createCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
} from "@medusajs/medusa/core-flows"

import { seedVoriCatalogWorkflow } from "../../src/workflows/vori/seed-vori-catalog"
import { recordVoriTransactionWorkflow } from "../../src/workflows/vori/record-vori-transaction"
import { syncVoriInventoryWorkflow } from "../../src/workflows/vori/sync-vori-inventory"
import { catalogFixture, taxRateFixture } from "../../src/modules/vori/lib/fixtures/store-products"
import { VORI_MODULE } from "../../src/modules/vori"
import type VoriModuleService from "../../src/modules/vori/service"

jest.setTimeout(120_000)

const DEPARTMENTS = [
  {
    id: "5501",
    deactivated_at: null,
    exclude_from_sales_reporting: false,
    name: "Dairy",
    parent_department_id: null,
  },
  {
    id: "5502",
    deactivated_at: null,
    exclude_from_sales_reporting: false,
    name: "Produce",
    parent_department_id: null,
  },
  {
    id: "5503",
    deactivated_at: null,
    exclude_from_sales_reporting: false,
    name: "Beer & Wine",
    parent_department_id: null,
  },
  // Deactivated, so it must not become a category.
  {
    id: "5504",
    deactivated_at: "2026-02-01T00:00:00.000Z",
    exclude_from_sales_reporting: false,
    name: "Closed Aisle",
    parent_department_id: null,
  },
]

type InventoryRecord = {
  barcode: string
  current: null | string
  id: string
  store_department_id: string
  store_id: string
  updated_at: string
}

const inventoryFor = (
  current: Record<string, null | string>,
  updatedAt: string,
): InventoryRecord[] =>
  Object.entries(current).map(([id, value]) => ({
    barcode: "0",
    current: value,
    id,
    store_department_id: "5501",
    store_id: "12345",
    updated_at: updatedAt,
  }))

medusaIntegrationTestRunner({
  testSuite: ({ getContainer }) => {
    /** Every Vori request the suite saw, so it can assert on the query string. */
    let requests: string[] = []
    /** Handlers, tried in order; the first to return a body wins. */
    let handlers: ((url: URL) => unknown | undefined)[] = []

    beforeEach(async () => {
      // The test runner applies schema migrations but not migration *scripts*,
      // so the store this demo needs has to be bootstrapped here. It is
      // idempotent, which is what makes it safe to call before every test.
      await initialDataSeed({ container: getContainer() })

      requests = []
      handlers = []

      jest.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
        const request = new Request(input)
        const url = new URL(request.url)
        requests.push(url.pathname + url.search)

        for (const handler of handlers) {
          const body = handler(url)
          if (body !== undefined) {
            return new Response(JSON.stringify(body), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          }
        }

        return new Response(JSON.stringify({ error_code: "not_stubbed" }), { status: 500 })
      })
    })

    afterEach(() => jest.restoreAllMocks())

    const serveCatalog = (departments: typeof DEPARTMENTS = DEPARTMENTS) => {
      handlers.push((url) => {
        if (url.pathname === "/v1/store-departments") return { data: departments, has_more: false }
        if (url.pathname === "/v1/store-products") return { data: catalogFixture, has_more: false }
        if (url.pathname === "/v1/tax-rates") {
          // The endpoint filters on `active`, and the seed asks for live rates.
          const activeOnly = url.searchParams.get("active") === "true"
          return {
            data: activeOnly ? taxRateFixture.filter((r) => r.active) : taxRateFixture,
            has_more: false,
          }
        }
        return undefined
      })
    }

    /** Serves one page per call, so paging and cursors are exercised for real. */
    const serveInventoryPages = (pages: InventoryRecord[][]) => {
      handlers.push((url) => {
        if (url.pathname !== "/v1/store-product-inventory") return undefined

        const after = url.searchParams.get("starting_after")
        const index = after ? pages.findIndex((page) => page.at(-1)?.id === after) + 1 : 0
        const page = pages[index] ?? []

        return { data: page, has_more: index < pages.length - 1 }
      })
    }

    const syncState = async () => {
      const vori = getContainer().resolve(VORI_MODULE) as VoriModuleService
      return vori.getSyncState()
    }

    const stockedQuantities = async (): Promise<Record<string, number>> => {
      const query = getContainer().resolve("query")
      const { data: variants } = await query.graph({
        entity: "variant",
        fields: ["sku", "inventory_items.inventory_item_id"],
      })
      const { data: levels } = await query.graph({
        entity: "inventory_level",
        fields: ["inventory_item_id", "stocked_quantity"],
      })

      const byItem = new Map(
        levels.map((l: any) => [l.inventory_item_id, Number(l.stocked_quantity)]),
      )
      const out: Record<string, number> = {}
      for (const variant of variants as any[]) {
        const itemId = variant.inventory_items?.[0]?.inventory_item_id
        if (variant.sku && itemId && byItem.has(itemId)) out[variant.sku] = byItem.get(itemId)!
      }
      return out
    }

    describe("seeding the catalog from Vori", () => {
      it("sells what a website can sell, and nothing that needs a register", async () => {
        serveCatalog()

        const { result } = await seedVoriCatalogWorkflow(getContainer()).run({ input: {} })

        expect(result.productsCreated).toBe(5)
        expect(result.categories).toBe(3)
        expect(result.skipped).toEqual({
          "gift card": 1,
          "manual item": 1,
          "no retail price": 1,
          "variable sale price": 1,
        })
      })

      it("floors fractional counts, empties an oversold shelf, and leaves an uncounted one alone", async () => {
        serveCatalog()
        await seedVoriCatalogWorkflow(getContainer()).run({ input: {} })

        const quantities = await stockedQuantities()

        expect(quantities["VORI-900001"]).toBe(24)
        expect(quantities["VORI-900002"]).toBe(112) // 112.4 on the shelf
        expect(quantities["VORI-900004"]).toBe(0) // -3 in Vori
        // Never counted is not the same as none in stock, so no level exists.
        expect(quantities["VORI-900005"]).toBeUndefined()
      })

      it("survives departments that share a name, which a real grocer's list does", async () => {
        // Medusa handles are unique store-wide, so two departments called
        // "Formula" collide on `formula` and the whole seed fails on the
        // insert unless the handles are resolved first.
        serveCatalog([
          ...DEPARTMENTS,
          {
            id: "7702",
            deactivated_at: null,
            exclude_from_sales_reporting: false,
            name: "Dairy",
            parent_department_id: null,
          },
          {
            id: "9903",
            deactivated_at: null,
            exclude_from_sales_reporting: false,
            name: "Dairy",
            parent_department_id: null,
          },
        ])

        const { result } = await seedVoriCatalogWorkflow(getContainer()).run({ input: {} })

        expect(result.categories).toBe(5)

        const query = getContainer().resolve("query")
        const { data: categories } = await query.graph({
          entity: "product_category",
          fields: ["handle", "metadata"],
        })
        const dairy = categories
          .filter((c: any) => c.name !== undefined || true)
          .filter((c: any) =>
            ["5501", "7702", "9903"].includes(c.metadata?.vori_store_department_id),
          )
          .map((c: any) => c.handle)
          .sort()

        expect(dairy).toEqual(["dairy", "dairy-7702", "dairy-9903"])
      })

      it("is safe to run twice, and does not move a product's URL when it does", async () => {
        serveCatalog()
        await seedVoriCatalogWorkflow(getContainer()).run({ input: {} })

        const query = getContainer().resolve("query")
        const before = await query.graph({ entity: "product", fields: ["external_id", "handle"] })

        const { result } = await seedVoriCatalogWorkflow(getContainer()).run({ input: {} })
        const after = await query.graph({ entity: "product", fields: ["external_id", "handle"] })

        expect(result.productsCreated).toBe(0)
        expect(result.productsUpdated).toBe(5)
        expect(after.data).toHaveLength(before.data.length)
        expect(after.data.map((p: any) => p.handle).sort()).toEqual(
          before.data.map((p: any) => p.handle).sort(),
        )
      })
    })

    describe("keeping the catalog in step with the store", () => {
      it("picks up a product the grocer has just added", async () => {
        serveCatalog()
        const first = await seedVoriCatalogWorkflow(getContainer()).run({ input: {} })
        expect(first.result.productsCreated).toBe(5)

        handlers = []
        const added = { ...catalogFixture[0], id: "900777", name: "New Arrival Oat Milk" }
        handlers.push((url) => {
          if (url.pathname === "/v1/store-departments")
            return { data: DEPARTMENTS, has_more: false }
          if (url.pathname === "/v1/store-products")
            return { data: [...catalogFixture, added], has_more: false }
          if (url.pathname === "/v1/tax-rates")
            return { data: taxRateFixture.filter((r) => r.active), has_more: false }
          return undefined
        })

        const { result } = await seedVoriCatalogWorkflow(getContainer()).run({ input: {} })

        expect(result.productsCreated).toBe(1)
        expect(result.productsDeactivated).toBe(0)

        const query = getContainer().resolve("query")
        const { data: products } = await query.graph({
          entity: "product",
          fields: ["external_id", "status", "title"],
        })
        expect(products.find((p: any) => p.external_id === "900777")).toMatchObject({
          status: "published",
          title: "New Arrival Oat Milk",
        })
      })

      it("takes down a product the grocer stops selling online", async () => {
        serveCatalog()
        await seedVoriCatalogWorkflow(getContainer()).run({ input: {} })

        handlers = []
        // The beer loses its ecommerce flag, so the catalog fetch stops
        // returning it - which is how a grocer withdraws something.
        const withoutBeer = catalogFixture.filter((p) => p.id !== "900003")
        handlers.push((url) => {
          if (url.pathname === "/v1/store-departments")
            return { data: DEPARTMENTS, has_more: false }
          if (url.pathname === "/v1/store-products") return { data: withoutBeer, has_more: false }
          if (url.pathname === "/v1/tax-rates")
            return { data: taxRateFixture.filter((r) => r.active), has_more: false }
          return undefined
        })

        const { result } = await seedVoriCatalogWorkflow(getContainer()).run({ input: {} })

        expect(result.productsDeactivated).toBe(1)

        const query = getContainer().resolve("query")
        const { data: products } = await query.graph({
          entity: "product",
          fields: ["external_id", "status"],
        })
        // Unpublished, not deleted: its orders and its URL survive.
        expect(products.find((p: any) => p.external_id === "900003")).toMatchObject({
          status: "draft",
        })
        expect(products.filter((p: any) => p.status === "published")).toHaveLength(4)
      })

      it("puts a product back on sale when it returns", async () => {
        serveCatalog()
        await seedVoriCatalogWorkflow(getContainer()).run({ input: {} })

        handlers = []
        const withoutBeer = catalogFixture.filter((p) => p.id !== "900003")
        handlers.push((url) => {
          if (url.pathname === "/v1/store-departments")
            return { data: DEPARTMENTS, has_more: false }
          if (url.pathname === "/v1/store-products") return { data: withoutBeer, has_more: false }
          if (url.pathname === "/v1/tax-rates")
            return { data: taxRateFixture.filter((r) => r.active), has_more: false }
          return undefined
        })
        await seedVoriCatalogWorkflow(getContainer()).run({ input: {} })

        handlers = []
        serveCatalog()
        const { result } = await seedVoriCatalogWorkflow(getContainer()).run({ input: {} })

        expect(result.productsDeactivated).toBe(0)

        const query = getContainer().resolve("query")
        const { data: products } = await query.graph({
          entity: "product",
          fields: ["external_id", "status"],
        })
        expect(products.find((p: any) => p.external_id === "900003")).toMatchObject({
          status: "published",
        })
      })

      it("takes nothing down when the catalog comes back empty", async () => {
        serveCatalog()
        await seedVoriCatalogWorkflow(getContainer()).run({ input: {} })

        handlers = []
        // An empty response is far likelier to be a bad day at the API than a
        // grocer withdrawing their whole catalog, and acting on it would empty
        // the storefront.
        handlers.push((url) => {
          if (url.pathname === "/v1/store-departments")
            return { data: DEPARTMENTS, has_more: false }
          if (url.pathname === "/v1/store-products") return { data: [], has_more: false }
          if (url.pathname === "/v1/tax-rates")
            return { data: taxRateFixture.filter((r) => r.active), has_more: false }
          return undefined
        })

        const { result } = await seedVoriCatalogWorkflow(getContainer()).run({ input: {} })

        expect(result.productsDeactivated).toBe(0)

        const query = getContainer().resolve("query")
        const { data: products } = await query.graph({
          entity: "product",
          fields: ["status"],
        })
        expect(products.filter((p: any) => p.status === "published")).toHaveLength(5)
      })
    })

    describe("tax", () => {
      it("mirrors the live rates and leaves the switched-off one alone", async () => {
        serveCatalog()

        const { result } = await seedVoriCatalogWorkflow(getContainer()).run({ input: {} })

        const query = getContainer().resolve("query")
        const { data: rates } = await query.graph({
          entity: "tax_rate",
          fields: ["code", "rate", "name", "metadata"],
        })
        const fromVori = rates.filter((r: any) => r.metadata?.vori_tax_rate_id)

        // Only the active percentage rate: the inactive one and the per-unit
        // amount are both left out.
        expect(fromVori).toHaveLength(1)
        expect(fromVori[0]).toMatchObject({ code: "VORI-77", rate: 8.25 })
        expect(result.taxRatesUnrepresentable).toEqual(["Bottle Excise"])
      })

      it("attaches the rate to the taxable product and to nothing else", async () => {
        serveCatalog()

        const { result } = await seedVoriCatalogWorkflow(getContainer()).run({ input: {} })

        expect(result.productsTaxed).toBe(1)

        const query = getContainer().resolve("query")
        const { data: rules } = await query.graph({
          entity: "tax_rate_rule",
          fields: ["reference", "reference_id"],
        })
        const { data: products } = await query.graph({
          entity: "product",
          fields: ["id", "external_id"],
        })
        const beer = products.find((p: any) => p.external_id === "900003")!

        expect(rules).toHaveLength(1)
        expect(rules[0]).toMatchObject({ reference: "product", reference_id: beer.id })
      })

      it("charges that tax on a real cart, and leaves groceries untaxed", async () => {
        serveCatalog()
        await seedVoriCatalogWorkflow(getContainer()).run({ input: {} })

        const container = getContainer()
        const query = container.resolve("query")
        const cartModule = container.resolve("cart")

        const { data: regions } = await query.graph({ entity: "region", fields: ["id"] })
        const { data: products } = await query.graph({
          entity: "product",
          fields: ["external_id", "variants.id"],
        })
        const variantFor = (externalId: string): string =>
          products.find((p: any) => p.external_id === externalId)!.variants[0].id

        const { result: cart } = await createCartWorkflow(container).run({
          input: {
            region_id: regions[0].id,
            currency_code: "usd",
            email: "shopper@example.com",
            shipping_address: {
              first_name: "Ada",
              last_name: "Lovelace",
              address_1: "1 Market St",
              city: "San Francisco",
              country_code: "us",
              postal_code: "94105",
            },
            items: [
              { variant_id: variantFor("900003"), quantity: 1 }, // beer, taxed
              { variant_id: variantFor("900001"), quantity: 2 }, // milk, not
            ],
          },
        })

        const refreshed = await cartModule.retrieveCart(cart.id, {
          relations: ["items", "items.tax_lines"],
        })
        const byPrice = new Map(
          (refreshed.items ?? []).map((i: any) => [Number(i.unit_price), Number(i.tax_total ?? 0)]),
        )

        // 12.49 at 8.25% is 1.03; the milk is a grocery and is not taxed.
        expect(byPrice.get(12.49)).toBeCloseTo(1.03, 2)
        expect(byPrice.get(4.99)).toBe(0)
      })
    })

    describe("recording a taxed sale", () => {
      /** Rings up a basket and returns the order it produced. */
      const checkout = async (lines: { externalId: string; quantity: number }[]) => {
        const container = getContainer()
        const query = container.resolve("query")

        const { data: regions } = await query.graph({ entity: "region", fields: ["id"] })
        const { data: products } = await query.graph({
          entity: "product",
          fields: ["external_id", "variants.id"],
        })
        const { data: options } = await query.graph({
          entity: "shipping_option",
          fields: ["id", "name"],
        })

        const variantFor = (externalId: string): string =>
          products.find((p: any) => p.external_id === externalId)!.variants[0].id

        const { result: cart } = await createCartWorkflow(container).run({
          input: {
            region_id: regions[0].id,
            currency_code: "usd",
            email: "shopper@example.com",
            shipping_address: {
              first_name: "Ada",
              last_name: "Lovelace",
              address_1: "1 Market St",
              city: "San Francisco",
              country_code: "us",
              postal_code: "94105",
            },
            items: lines.map((l) => ({
              variant_id: variantFor(l.externalId),
              quantity: l.quantity,
            })),
          },
        })

        await addShippingMethodToCartWorkflow(container).run({
          input: { cart_id: cart.id, options: [{ id: options[0].id }] },
        })

        const { result: collection } = await createPaymentCollectionForCartWorkflow(container).run({
          input: { cart_id: cart.id },
        })

        await createPaymentSessionsWorkflow(container).run({
          input: {
            payment_collection_id: collection.id,
            provider_id: "pp_system_default",
            context: {},
            data: {},
          },
        })

        const { result: completed } = await completeCartWorkflow(container).run({
          input: { id: cart.id },
        })

        return completed
      }

      beforeEach(async () => {
        serveCatalog()
        await seedVoriCatalogWorkflow(getContainer()).run({ input: {} })
        handlers = []
      })

      it("sends Vori a transaction whose tax and totals reconcile", async () => {
        handlers.push((url) => {
          if (url.pathname === "/v1/transactions") return { recorded: true }
          return undefined
        })

        // Beer at 12.49 taxed 8.25%, milk at 4.99 x2 untaxed.
        const order = await checkout([
          { externalId: "900003", quantity: 1 },
          { externalId: "900001", quantity: 2 },
        ])

        await recordVoriTransactionWorkflow(getContainer()).run({
          input: { orderId: order.id },
        })

        const query = getContainer().resolve("query")
        const { data: orders } = await query.graph({
          entity: "order",
          fields: ["id", "metadata", "total"],
          filters: { id: order.id },
        })
        const request = (orders[0].metadata as any).vori_request

        const lineTotals = request.line_items.map((l: any) => Number(l.total))
        const lineTaxes = request.line_items.map((l: any) => Number(l.tax_total))

        // Every rule the API enforces on its own side.
        expect(Number(request.tax_total)).toBeCloseTo(
          lineTaxes.reduce((a: number, b: number) => a + b, 0),
          2,
        )
        expect(Number(request.total)).toBeCloseTo(
          lineTotals.reduce((a: number, b: number) => a + b, 0),
          2,
        )
        expect(Number(request.payments[0].amount)).toBeCloseTo(Number(request.total), 2)
        // And against what the shopper was actually charged.
        expect(Number(request.total)).toBeCloseTo(Number(orders[0].total), 2)

        const beerLine = request.line_items.find((l: any) => l.store_product_id === "900003")
        const milkLine = request.line_items.find((l: any) => l.store_product_id === "900001")

        expect(beerLine).toMatchObject({
          retail_price: "12.49",
          tax_total: "1.03",
          taxable_amount: "12.49",
          total: "13.52",
        })
        // A grocery: taxed nothing, and nothing reported as taxable.
        expect(milkLine).toMatchObject({
          retail_price: "4.99",
          tax_total: "0.00",
          taxable_amount: "0.00",
          total: "9.98",
        })
      })
    })

    describe("the inventory watermark", () => {
      beforeEach(async () => {
        serveCatalog()
        await seedVoriCatalogWorkflow(getContainer()).run({ input: {} })
        handlers = []
      })

      it("pulls everything on the first run and only what moved after that", async () => {
        serveInventoryPages([inventoryFor({ "900001": "10" }, "2026-08-19T00:00:00.000Z")])

        await syncVoriInventoryWorkflow(getContainer()).run({ input: {} })

        // A full pass asks for no window at all.
        expect(requests.at(-1)).not.toContain("updated_at")
        const first = await syncState()
        expect(first.watermark).toBeTruthy()
        expect(first.cursor).toBeNull()

        requests = []
        handlers = []
        serveInventoryPages([inventoryFor({ "900001": "4" }, "2026-08-19T01:00:00.000Z")])

        await syncVoriInventoryWorkflow(getContainer()).run({ input: {} })

        // The second run asks only for what changed since the first finished.
        expect(requests.at(-1)).toContain(`updated_at[gte]=${encodeURIComponent(first.watermark!)}`)
        expect((await stockedQuantities())["VORI-900001"]).toBe(4)
      })

      it("sets the window before fetching, so a count written mid-run is not stepped over", async () => {
        const before = Date.now()
        serveInventoryPages([inventoryFor({ "900001": "10" }, "2026-08-19T00:00:00.000Z")])

        await syncVoriInventoryWorkflow(getContainer()).run({ input: {} })

        // Deliberately behind the clock: quantities become readable a moment
        // after they are stamped, so consecutive windows have to overlap.
        const watermark = Date.parse((await syncState()).watermark!)
        expect(watermark).toBeLessThan(before)
        expect(before - watermark).toBeGreaterThanOrEqual(5 * 60 * 1000 - 1000)
      })

      it("walks every page, carrying the cursor", async () => {
        serveInventoryPages([
          inventoryFor({ "900001": "1" }, "2026-08-19T00:00:00.000Z"),
          inventoryFor({ "900002": "2" }, "2026-08-19T00:00:00.000Z"),
          inventoryFor({ "900003": "3" }, "2026-08-19T00:00:00.000Z"),
        ])

        const { result } = await syncVoriInventoryWorkflow(getContainer()).run({ input: {} })

        expect(result.recordsSeen).toBe(3)
        expect(requests.filter((r) => r.includes("starting_after=900001"))).toHaveLength(1)
        expect(requests.filter((r) => r.includes("starting_after=900002"))).toHaveLength(1)
        expect(await stockedQuantities()).toMatchObject({
          "VORI-900001": 1,
          "VORI-900002": 2,
          "VORI-900003": 3,
        })
      })

      it("holds the window open when a run fails part way through", async () => {
        // Records come back in ID order, which says nothing about when each was
        // counted. Advancing the watermark on a half-finished run would skip
        // everything still to come.
        handlers.push((url) => {
          if (url.pathname !== "/v1/store-product-inventory") return undefined
          if (url.searchParams.get("starting_after") === "900001") return undefined // 500
          return {
            data: inventoryFor({ "900001": "9" }, "2026-08-19T00:00:00.000Z"),
            has_more: true,
          }
        })

        await expect(
          syncVoriInventoryWorkflow(getContainer()).run({ input: {} }),
        ).rejects.toBeTruthy()

        const state = await syncState()
        expect(state.watermark).toBeNull()
        expect(state.cursor).toBe("900001")
        expect(state.next_watermark).toBeTruthy()
        expect(state.last_error).toContain("500")
        // The page that did arrive was still written.
        expect((await stockedQuantities())["VORI-900001"]).toBe(9)
      })

      it("resumes after the cursor, keeping the window the failed run chose", async () => {
        handlers.push((url) => {
          if (url.pathname !== "/v1/store-product-inventory") return undefined
          if (url.searchParams.get("starting_after") === "900001") return undefined
          return {
            data: inventoryFor({ "900001": "9" }, "2026-08-19T00:00:00.000Z"),
            has_more: true,
          }
        })
        await expect(
          syncVoriInventoryWorkflow(getContainer()).run({ input: {} }),
        ).rejects.toBeTruthy()

        const claimed = (await syncState()).next_watermark
        requests = []
        handlers = []
        serveInventoryPages([inventoryFor({ "900002": "5" }, "2026-08-19T00:00:00.000Z")])

        await syncVoriInventoryWorkflow(getContainer()).run({ input: {} })

        expect(requests[0]).toContain("starting_after=900001")
        // The interrupted run's window is committed, not a fresh one.
        expect((await syncState()).watermark).toBe(claimed)
        expect((await syncState()).cursor).toBeNull()
      })
    })
  },
})
