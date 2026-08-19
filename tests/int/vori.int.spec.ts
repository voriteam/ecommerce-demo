import type { Payload } from 'payload'

import { getPayload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Order } from '@/payload-types'

import config from '@/payload.config'
import { eachPricedProduct, weightPricedProduct } from '@/vori/fixtures/storeProducts'
import { syncVoriInventory } from '@/vori/inventory'
import { voriProductToPayload } from '@/vori/mapping'
import { recordVoriTransaction } from '@/vori/recordTransaction'
import { type CreateTransactionRequest } from '@/vori/transactions'

/**
 * Both halves of the integration, against a stubbed API and a real database.
 *
 * These cover the behaviour the API's contract actually depends on — the
 * watermark protocol, idempotency, and totals that reconcile — rather than
 * every branch.
 */

const baseConfig = {
  apiKey: 'sk_live_test',
  baseUrl: 'https://api.vori.test',
  storeId: '12345',
  syncCron: '*/2 * * * *',
  syncEnabled: true,
}
const reads = { ...baseConfig, dryRun: true, writeEnabled: false }
const writes = { ...baseConfig, dryRun: false, writeEnabled: true }
const dryRun = { ...baseConfig, dryRun: true, writeEnabled: true }

const silent = { error: () => {}, info: () => {}, warn: () => {} }

let payload: Payload
let productIds: Record<string, number>
const requests: URL[] = []
const sent: CreateTransactionRequest[] = []

/** Serves inventory pages, recording what was asked for. */
const stubInventory = (
  pages: { current: null | string; id: string }[][],
  options: { failOnPage?: number } = {},
) => {
  let call = 0

  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    requests.push(url)

    const index = call++
    if (options.failOnPage === index) {
      return new Response(JSON.stringify({ error_code: 'internal_error' }), { status: 500 })
    }

    const page = pages[index] ?? []
    return Response.json({
      data: page.map((record) => ({
        id: record.id,
        barcode: '000',
        current: record.current,
        store_department_id: '5501',
        store_id: '12345',
        updated_at: '2026-08-18T22:00:00.000Z',
      })),
      has_more: index < pages.length - 1,
    })
  })
}

const stubTransactions = (response: { body?: unknown; status: number }) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input as RequestInfo, init)
    sent.push((await request.clone().json()) as CreateTransactionRequest)
    return Response.json(response.body ?? { id: 'txn_1' }, { status: response.status })
  })

/** An order as the Stripe adapter creates it once payment succeeds. */
const createOrder = async (items: { productId: number; quantity: number }[], amount: number) => {
  const transaction = await payload.create({
    collection: 'transactions',
    data: {
      amount,
      currency: 'USD',
      customerEmail: 'shopper@example.com',
      paymentMethod: 'stripe',
      status: 'succeeded',
      stripe: { paymentIntentID: 'pi_3Abc123' },
    },
  })

  return (await payload.create({
    collection: 'orders',
    data: {
      amount,
      currency: 'USD',
      customerEmail: 'shopper@example.com',
      items: items.map((item) => ({ product: item.productId, quantity: item.quantity })),
      status: 'processing',
      transactions: [transaction.id],
    },
  })) as Order

}

const inventoryOf = async (voriId: string) => {
  const found = await payload.find({
    collection: 'products',
    limit: 1,
    where: { voriStoreProductId: { equals: voriId } },
  })
  return found.docs[0]?.inventory
}

beforeAll(async () => {
  payload = await getPayload({ config: await config })
})

beforeEach(async () => {
  requests.length = 0
  sent.length = 0
  vi.restoreAllMocks()

  await payload.updateGlobal({
    slug: 'voriSync',
    data: { cursor: null, lastError: null, nextWatermark: null, watermark: null },
  })

  productIds = {}
  for (const fixture of [eachPricedProduct, weightPricedProduct]) {
    const existing = await payload.find({
      collection: 'products',
      limit: 1,
      where: { voriStoreProductId: { equals: fixture.id } },
    })
    const data = { ...voriProductToPayload(fixture), inventory: 5 }
    const doc = existing.docs[0]
      ? await payload.update({ id: existing.docs[0].id, collection: 'products', data })
      : await payload.create({ collection: 'products', data: data as never })
    productIds[fixture.id] = doc.id
  }
})

afterAll(() => {
  vi.restoreAllMocks()
})

describe('inventory sync', () => {
  it('pulls everything on the first run, then only what moved', async () => {
    stubInventory([[{ id: eachPricedProduct.id, current: '24' }]])
    await syncVoriInventory({ config: reads, logger: silent, payload })

    // First run: no lower bound, so the whole catalog.
    expect(requests[0]!.searchParams.has('updated_at[gte]')).toBe(false)
    expect(await inventoryOf(eachPricedProduct.id)).toBe(24)

    const state = await payload.findGlobal({ slug: 'voriSync' })
    expect(state.watermark).toBeTruthy()
    expect(state.cursor).toBeFalsy()
    // Set behind the clock, so a count written mid-run is not stepped over.
    expect(new Date(state.watermark!).getTime()).toBeLessThan(Date.now())

    requests.length = 0
    vi.restoreAllMocks()
    stubInventory([[{ id: eachPricedProduct.id, current: '19' }]])
    await syncVoriInventory({ config: reads, logger: silent, payload })

    expect(requests[0]!.searchParams.get('updated_at[gte]')).toBe(state.watermark)
    expect(await inventoryOf(eachPricedProduct.id)).toBe(19)
  })

  it('pages until has_more is false, flooring fractional counts', async () => {
    stubInventory([
      [{ id: eachPricedProduct.id, current: '24' }],
      [{ id: weightPricedProduct.id, current: '112.4' }],
    ])

    const result = await syncVoriInventory({ config: reads, logger: silent, payload })

    expect(result.recordsSeen).toBe(2)
    expect(requests[1]!.searchParams.get('starting_after')).toBe(eachPricedProduct.id)
    // Never offer more than the shelf can actually hold.
    expect(await inventoryOf(weightPricedProduct.id)).toBe(112)
  })

  it('leaves the watermark alone when a run fails part-way', async () => {
    stubInventory(
      [
        [{ id: eachPricedProduct.id, current: '24' }],
        [{ id: weightPricedProduct.id, current: '9' }],
      ],
      { failOnPage: 1 },
    )

    await expect(syncVoriInventory({ config: reads, logger: silent, payload })).rejects.toThrow()

    const state = await payload.findGlobal({ slug: 'voriSync' })

    // Records come back in id order, which says nothing about when each was
    // counted. A half-written window must not move the watermark, or the
    // products still to come would be skipped until something else moved them.
    expect(state.watermark).toBeFalsy()
    expect(state.cursor).toBe(eachPricedProduct.id)
    expect(await inventoryOf(eachPricedProduct.id)).toBe(24)
  })

  it('treats oversold as out of stock, and never-counted as unknown', async () => {
    stubInventory([[{ id: eachPricedProduct.id, current: '-3' }]])
    await syncVoriInventory({ config: reads, logger: silent, payload })
    expect(await inventoryOf(eachPricedProduct.id)).toBe(0)

    vi.restoreAllMocks()
    stubInventory([[{ id: weightPricedProduct.id, current: null }]])
    await syncVoriInventory({ config: reads, logger: silent, payload })
    // Never counted is not the same as none in stock.
    expect(await inventoryOf(weightPricedProduct.id)).toBe(5)
  })
})

describe('recording an order', () => {
  it('sends totals that reconcile, keyed by a UUIDv7 minted at creation', async () => {
    stubTransactions({ status: 201 })

    // 2 x $4.99 = $9.98
    const order = await createOrder([{ productId: productIds['900001']!, quantity: 2 }], 998)
    expect(order.voriTransactionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )

    const result = await recordVoriTransaction({
      config: writes,
      logger: silent,
      orderId: order.id,
      payload,
    })
    expect(result.status).toBe('recorded')

    const body = sent[0]!
    expect(body.id).toBe(order.voriTransactionId)
    expect(body.external_id).toBe(String(order.id))
    expect(body.store_id).toBe('12345')
    expect(body.total).toBe('9.98')
    expect(body.line_items).toEqual([
      {
        quantity: '2',
        retail_price: '4.99',
        store_product_id: '900001',
        tax_total: '0.00',
        taxable_amount: '0.00',
        total: '9.98',
      },
    ])
    // The API rejects a transaction whose payments do not add up to its total.
    expect(body.payments).toEqual([
      { amount: '9.98', external_transaction_id: 'stripe:pi_3Abc123', payment_type: 'credit' },
    ])
  })

  it('sends a per-pound product as quantity 1 plus an explicit weight', async () => {
    stubTransactions({ status: 201 })

    // 3 lb of bananas at $0.69/lb = $2.07
    const order = await createOrder([{ productId: productIds['900002']!, quantity: 3 }], 207)
    await recordVoriTransaction({ config: writes, logger: silent, orderId: order.id, payload })

    expect(sent[0]!.line_items[0]).toEqual({
      quantity: '1',
      retail_price: '0.69',
      store_product_id: '900002',
      tax_total: '0.00',
      taxable_amount: '0.00',
      total: '2.07',
      weight: '3',
    })
  })

  it('reuses the key on a retry and never sends an order twice', async () => {
    stubTransactions({ status: 201 })
    const order = await createOrder([{ productId: productIds['900001']!, quantity: 1 }], 499)

    await recordVoriTransaction({ config: writes, logger: silent, orderId: order.id, payload })
    // Already recorded, so nothing goes out.
    await recordVoriTransaction({ config: writes, logger: silent, orderId: order.id, payload })
    expect(sent).toHaveLength(1)

    // Forced retry reuses the key, which is what makes a replay safe.
    await payload.update({ id: order.id, collection: 'orders', data: { voriSyncStatus: 'pending' } })
    await recordVoriTransaction({ config: writes, logger: silent, orderId: order.id, payload })
    expect(sent).toHaveLength(2)
    expect(sent[0]!.id).toBe(sent[1]!.id)
  })

  it('retries a 500, but treats 409 and 400 as final', async () => {
    stubTransactions({ status: 500 })
    const a = await createOrder([{ productId: productIds['900001']!, quantity: 1 }], 499)
    expect(
      (await recordVoriTransaction({ config: writes, logger: silent, orderId: a.id, payload }))
        .retryable,
    ).toBe(true)

    // A 409 means this ID was reused across two different orders. The docs are
    // explicit that retrying the same divergent payload returns 409 forever.
    vi.restoreAllMocks()
    stubTransactions({ body: { error_code: 'conflicting_property_values' }, status: 409 })
    const b = await createOrder([{ productId: productIds['900001']!, quantity: 1 }], 499)
    const conflict = await recordVoriTransaction({
      config: writes,
      logger: silent,
      orderId: b.id,
      payload,
    })
    expect(conflict).toMatchObject({ retryable: false, status: 'conflict' })

    vi.restoreAllMocks()
    stubTransactions({ body: { error_code: 'validation_error' }, status: 400 })
    const c = await createOrder([{ productId: productIds['900001']!, quantity: 1 }], 499)
    expect(
      await recordVoriTransaction({ config: writes, logger: silent, orderId: c.id, payload }),
    ).toMatchObject({ retryable: false, status: 'failed' })
  })

  it('builds and stores the payload without sending it when writes are off', async () => {
    const fetchSpy = stubTransactions({ status: 201 })

    const order = await createOrder([{ productId: productIds['900001']!, quantity: 2 }], 998)
    const result = await recordVoriTransaction({
      config: dryRun,
      logger: silent,
      orderId: order.id,
      payload,
    })

    expect(result).toMatchObject({ detail: 'VORI_DRY_RUN is true', status: 'skipped' })
    expect(fetchSpy).not.toHaveBeenCalled()

    // Still fully formed, so it can be reviewed before writes are switched on.
    const saved = await payload.findByID({ id: order.id, collection: 'orders' })
    expect((saved.voriRequestBody as unknown as CreateTransactionRequest).total).toBe('9.98')
  })

  it('refuses to record a transaction that does not reconcile with what was charged', async () => {
    const fetchSpy = stubTransactions({ status: 201 })

    // Stripe charged $5.00 but the line items come to $9.98.
    const order = await createOrder([{ productId: productIds['900001']!, quantity: 2 }], 500)
    const result = await recordVoriTransaction({
      config: writes,
      logger: silent,
      orderId: order.id,
      payload,
    })

    expect(result).toMatchObject({ retryable: false, status: 'failed' })
    expect(result.detail).toContain('does not reconcile')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
