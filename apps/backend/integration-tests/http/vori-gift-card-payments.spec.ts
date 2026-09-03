import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  addShippingMethodToCartWorkflow,
  completeCartWorkflow,
  createCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
} from "@medusajs/medusa/core-flows"

import initialDataSeed from "../../src/migration-scripts/initial-data-seed"
import { catalogFixture, taxRateFixture } from "../../src/modules/vori/lib/fixtures/store-products"
import {
  applyGiftCardToCartWorkflow,
  removeGiftCardFromCartWorkflow,
} from "../../src/workflows/vori/apply-gift-card-to-cart"
import { recordVoriTransactionWorkflow } from "../../src/workflows/vori/record-vori-transaction"
import { seedVoriCatalogWorkflow } from "../../src/workflows/vori/seed-vori-catalog"

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
    id: "5503",
    deactivated_at: null,
    exclude_from_sales_reporting: false,
    name: "Beer & Wine",
    parent_department_id: null,
  },
]

const GIFT_CARD_ID = "01a01879-1111-7000-8000-000000000001"
const BARCODE = "VGC000000000001"

const giftCard = (balance: string, status = "active") => ({
  balance,
  barcodes: [BARCODE],
  created_at: "2026-08-19T05:00:00.000Z",
  deactivated_at: null,
  deactivated_by_api_client_id: null,
  deactivated_by_employee_id: null,
  deactivated_by_user_id: null,
  deactivation_reason: null,
  id: GIFT_CARD_ID,
  last_order_at: null,
  magstripe_account_numbers: [],
  owner_id: null,
  printed_account_numbers: [],
  purchaser_id: null,
  shopper_facing_id: "GC-1234",
  status,
  updated_at: "2026-08-19T05:00:00.000Z",
})

medusaIntegrationTestRunner({
  inApp: true,
  env: {
    VORI_API_KEY: "sk_test_gift_cards",
    VORI_STORE_ID: "12345",
    VORI_SYNC_ENABLED: "false",
    OPEN_FOOD_FACTS_ENABLED: "false",
  },
  testSuite: ({ getContainer }) => {
    let handlers: ((url: URL) => unknown | undefined)[] = []
    let ledgerWrites: { body: any; giftCardId: string }[] = []

    beforeEach(async () => {
      await initialDataSeed({ container: getContainer() })
      handlers = []
      ledgerWrites = []

      jest.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init: any) => {
        const request = new Request(input, init)
        const url = new URL(request.url)

        const ledger = url.pathname.match(/^\/v1\/gift-cards\/([^/]+)\/transactions$/)
        if (ledger && request.method === "POST") {
          const body = await request.json()
          ledgerWrites.push({ body, giftCardId: ledger[1] })
          return new Response(
            JSON.stringify({ ...body, id: `gct_${ledgerWrites.length}` }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }

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

      handlers.push((url) => {
        if (url.pathname === "/v1/store-departments") return { data: DEPARTMENTS, has_more: false }
        if (url.pathname === "/v1/store-products") return { data: catalogFixture, has_more: false }
        if (url.pathname === "/v1/tax-rates") {
          const activeOnly = url.searchParams.get("active") === "true"
          return {
            data: activeOnly ? taxRateFixture.filter((r) => r.active) : taxRateFixture,
            has_more: false,
          }
        }
        return undefined
      })

      await seedVoriCatalogWorkflow(getContainer()).run({ input: {} })
    })

    afterEach(() => jest.restoreAllMocks())

    const serveGiftCard = (balance: string, status = "active") => {
      handlers.unshift((url) => {
        if (url.pathname === "/v1/gift-cards") {
          return url.searchParams.get("barcode") === BARCODE
            ? { data: [giftCard(balance, status)], has_more: false }
            : { data: [], has_more: false }
        }
        if (url.pathname === `/v1/gift-cards/${GIFT_CARD_ID}`) return giftCard(balance, status)
        return undefined
      })
    }

    /**
     * A step's error reaches the caller as a plain object rather than an Error,
     * so `rejects.toThrow` never matches and the message is read off directly.
     */
    const refusal = async (run: () => Promise<unknown>): Promise<string> => {
      try {
        await run()
      } catch (error: any) {
        return String(error?.message ?? error)
      }
      throw new Error("Expected the gift card to be refused, but it was accepted.")
    }

    const cartWith = async (lines: { externalId: string; quantity: number }[]) => {
      const container = getContainer()
      const query = container.resolve("query")

      const { data: regions } = await query.graph({ entity: "region", fields: ["id"] })
      const { data: products } = await query.graph({
        entity: "product",
        fields: ["id", "external_id", "variants.id"],
      })
      const variantFor = (externalId: string) =>
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
          items: lines.map((l) => ({ variant_id: variantFor(l.externalId), quantity: l.quantity })),
        },
      })

      const { data: options } = await query.graph({ entity: "shipping_option", fields: ["id"] })
      await addShippingMethodToCartWorkflow(container).run({
        input: { cart_id: cart.id, options: [{ id: options[0].id }] },
      })

      return cart.id
    }

    const cartTotals = async (cartId: string) => {
      const { data: carts } = await getContainer()
        .resolve("query")
        .graph({
          entity: "cart",
          fields: ["id", "total", "subtotal", "credit_line_total", "payment_collection.amount"],
          filters: { id: cartId },
        })
      return carts[0] as unknown as {
        credit_line_total: number
        subtotal: number
        total: number
      }
    }

    describe("putting a gift card on a basket", () => {
      it("takes the total to zero without touching the subtotal", async () => {
        serveGiftCard("10.00")
        const cartId = await cartWith([{ externalId: "900001", quantity: 2 }])

        const before = await cartTotals(cartId)
        await applyGiftCardToCartWorkflow(getContainer()).run({
          input: { barcode: BARCODE, cartId },
        })
        const after = await cartTotals(cartId)

        // Milk 4.99 x2 = 9.98, and a 10.00 card covers all of it.
        expect(Number(before.total)).toBeCloseTo(9.98, 2)
        expect(Number(after.credit_line_total)).toBeCloseTo(9.98, 2)
        expect(Number(after.total)).toBeCloseTo(0, 2)
        // The subtotal is untouched: a gift card is a tender, not a discount.
        expect(Number(after.subtotal)).toBeCloseTo(Number(before.subtotal), 2)
      })

      it("takes only what is owed when the card is worth more", async () => {
        serveGiftCard("500.00")
        const cartId = await cartWith([{ externalId: "900001", quantity: 2 }])

        const { result } = await applyGiftCardToCartWorkflow(getContainer()).run({
          input: { barcode: BARCODE, cartId },
        })

        expect(result.appliedCents).toBe(998)
      })

      it("pays what it can when the card is short", async () => {
        serveGiftCard("5.00")
        const cartId = await cartWith([{ externalId: "900001", quantity: 2 }])

        await applyGiftCardToCartWorkflow(getContainer()).run({
          input: { barcode: BARCODE, cartId },
        })

        expect(Number((await cartTotals(cartId)).total)).toBeCloseTo(4.98, 2)
      })

      it("restores the total when the card comes back off", async () => {
        serveGiftCard("5.00")
        const cartId = await cartWith([{ externalId: "900001", quantity: 2 }])

        await applyGiftCardToCartWorkflow(getContainer()).run({
          input: { barcode: BARCODE, cartId },
        })
        await removeGiftCardFromCartWorkflow(getContainer()).run({
          input: { cartId, giftCardId: GIFT_CARD_ID },
        })

        expect(Number((await cartTotals(cartId)).total)).toBeCloseTo(9.98, 2)
      })

      it("turns down a card with nothing on it", async () => {
        serveGiftCard("0.00")
        const cartId = await cartWith([{ externalId: "900001", quantity: 2 }])

        expect(
          await refusal(() =>
            applyGiftCardToCartWorkflow(getContainer()).run({
              input: { barcode: BARCODE, cartId },
            }),
          ),
        ).toMatch(/no balance/)
      })

      it("turns down a deactivated card", async () => {
        serveGiftCard("25.00", "deactivated")
        const cartId = await cartWith([{ externalId: "900001", quantity: 2 }])

        expect(
          await refusal(() =>
            applyGiftCardToCartWorkflow(getContainer()).run({
              input: { barcode: BARCODE, cartId },
            }),
          ),
        ).toMatch(/no longer active/)
      })

      it("turns down a barcode that matches nothing", async () => {
        serveGiftCard("25.00")
        const cartId = await cartWith([{ externalId: "900001", quantity: 2 }])

        expect(
          await refusal(() =>
            applyGiftCardToCartWorkflow(getContainer()).run({
              input: { barcode: "VGC999999999999", cartId },
            }),
          ),
        ).toMatch(/No gift card matches/)
      })

      it("will not put the same card on twice", async () => {
        serveGiftCard("2.00")
        const cartId = await cartWith([{ externalId: "900001", quantity: 2 }])

        await applyGiftCardToCartWorkflow(getContainer()).run({
          input: { barcode: BARCODE, cartId },
        })

        expect(
          await refusal(() =>
            applyGiftCardToCartWorkflow(getContainer()).run({
              input: { barcode: BARCODE, cartId },
            }),
          ),
        ).toMatch(/already paying/)
      })
    })

    describe("checking out with a gift card", () => {
      const complete = async (cartId: string, withPayment: boolean) => {
        const container = getContainer()

        if (withPayment) {
          const { result: collection } = await createPaymentCollectionForCartWorkflow(
            container,
          ).run({ input: { cart_id: cartId } })

          await createPaymentSessionsWorkflow(container).run({
            input: {
              payment_collection_id: collection.id,
              provider_id: "pp_system_default",
              context: {},
              data: {},
            },
          })
        }

        const { result } = await completeCartWorkflow(container).run({ input: { id: cartId } })
        return result
      }

      it("places an order with no payment at all when the card covers it", async () => {
        serveGiftCard("50.00")
        const cartId = await cartWith([{ externalId: "900001", quantity: 2 }])
        await applyGiftCardToCartWorkflow(getContainer()).run({
          input: { barcode: BARCODE, cartId },
        })

        const order = await complete(cartId, false)

        expect(order.id).toBeDefined()
      })

      it("records the basket at full price, split across both tenders", async () => {
        serveGiftCard("5.00")
        handlers.unshift((url) =>
          url.pathname === "/v1/transactions" ? { id: "txn", gift_card_sales: [] } : undefined,
        )

        const cartId = await cartWith([{ externalId: "900001", quantity: 2 }])
        await applyGiftCardToCartWorkflow(getContainer()).run({
          input: { barcode: BARCODE, cartId },
        })
        const order = await complete(cartId, true)

        await recordVoriTransactionWorkflow(getContainer()).run({ input: { orderId: order.id } })

        const { data: orders } = await getContainer()
          .resolve("query")
          .graph({ entity: "order", fields: ["id", "metadata"], filters: { id: order.id } })
        const request = (orders[0].metadata as any).vori_request

        // The sale is still 9.98 even though only 4.98 went on a card.
        expect(request.total).toBe("9.98")
        expect(request.payments).toEqual([
          expect.objectContaining({ amount: "4.98", payment_type: "credit" }),
          expect.objectContaining({
            amount: "5.00",
            gift_card_id: GIFT_CARD_ID,
            payment_type: "gift_card",
          }),
        ])

        const paid = request.payments.reduce(
          (sum: number, p: any) => sum + Number(p.amount),
          0,
        )
        expect(paid).toBeCloseTo(Number(request.total), 2)
      })

      it("writes every retry under one key, so the card is spent once", async () => {
        serveGiftCard("5.00")
        handlers.unshift((url) =>
          url.pathname === "/v1/transactions" ? { id: "txn", gift_card_sales: [] } : undefined,
        )

        const cartId = await cartWith([{ externalId: "900001", quantity: 2 }])
        await applyGiftCardToCartWorkflow(getContainer()).run({
          input: { barcode: BARCODE, cartId },
        })
        const order = await complete(cartId, true)

        // The first run mints the transaction ID and stores it, so everything
        // after reads it. Writes before this point are the subscriber's.
        await recordVoriTransactionWorkflow(getContainer()).run({ input: { orderId: order.id } })
        ledgerWrites.length = 0

        await recordVoriTransactionWorkflow(getContainer()).run({ input: { orderId: order.id } })
        await recordVoriTransactionWorkflow(getContainer()).run({ input: { orderId: order.id } })

        expect(ledgerWrites).toHaveLength(2)
        expect(ledgerWrites[0].body).toMatchObject({ amount: "-5.00", type: "order_payment" })
        // One key across both, so Vori returns the first entry rather than
        // spending the card again.
        expect(ledgerWrites[0].body.idempotency_key).toBe(ledgerWrites[1].body.idempotency_key)
      })
    })
  },
})
