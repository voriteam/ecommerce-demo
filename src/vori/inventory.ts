import type { Payload } from 'payload'

import { createVoriClient, paginate, unwrap, type VoriLogger } from './client'
import { getVoriConfig, type VoriConfig } from './config'
import { inventoryFromVori, type VoriStoreProductInventory } from './mapping'
import { assertServerOnly } from './serverOnly'

assertServerOnly('src/vori/inventory.ts')

const PAGE_SIZE = 100

/**
 * How far behind the clock each run's watermark is set.
 *
 * A quantity is stamped when Vori writes it and becomes readable a moment
 * later, so consecutive windows are made to overlap slightly: a count written
 * while the previous run was in flight is picked up rather than stepped over.
 * Re-reading a product costs nothing because the write is an upsert of a
 * current value. Missing one leaves the shelf wrong until something else
 * moves it.
 */
const WATERMARK_BUFFER_MS = 5 * 60 * 1000

export type SyncResult = {
  productsUpdated: number
  recordsSeen: number
  /** Null on a full pass, which is what the very first run does. */
  watermark: null | string
}

/**
 * Mirrors on-hand quantities from Vori into this storefront.
 *
 * Vori is the only writer of stock here. The ecommerce plugin validates
 * against `inventory` at checkout but never decrements it, so there is no
 * second source of truth to reconcile and the poll interval is a freshness
 * setting rather than a correctness one.
 *
 * The protocol is the one the API's own sync guide documents:
 *
 *   - the first run has no watermark and pulls the whole catalog;
 *   - every later run asks only for what moved, filtered on `updated_at`;
 *   - the next watermark is captured *before* fetching, not from the highest
 *     `updated_at` seen, because a quantity written mid-run can land behind
 *     that value and would then never be fetched;
 *   - each page is written as it arrives, and the cursor is saved with it,
 *     but the watermark only moves once the whole window is in. Records come
 *     back in `id` order, which says nothing about when each was counted, so
 *     a run that stopped halfway holds an arbitrary slice of the catalog —
 *     advancing the watermark there would skip everything still to come.
 */
export const syncVoriInventory = async (args: {
  config?: VoriConfig
  logger: VoriLogger
  payload: Payload
}): Promise<SyncResult> => {
  const config = args.config ?? getVoriConfig()
  const { logger, payload } = args

  if (!config.apiKey || !config.storeId) {
    throw new Error('VORI_API_KEY and VORI_STORE_ID must both be set to sync inventory')
  }

  const client = createVoriClient({ config, logger })
  const state = await payload.findGlobal({ slug: 'voriSync' })

  const watermark = state?.watermark || null
  // A resumed run keeps the watermark the interrupted one chose, for the same
  // reason it was captured early in the first place.
  const nextWatermark =
    state?.nextWatermark || new Date(Date.now() - WATERMARK_BUFFER_MS).toISOString()
  const startingCursor = state?.cursor || undefined

  logger.info(
    `vori: inventory sync starting from ${watermark ?? 'the beginning (full pass)'}${
      startingCursor ? `, resuming after ${startingCursor}` : ''
    }`,
  )

  let recordsSeen = 0
  let productsUpdated = 0

  try {
    for await (const page of paginate<VoriStoreProductInventory>(
      async (cursor) =>
        unwrap(
          await client.GET('/v1/store-product-inventory', {
            params: {
              query: {
                limit: PAGE_SIZE,
                starting_after: cursor,
                store_id: [config.storeId!],
                ...(watermark ? { 'updated_at[gte]': watermark } : {}),
              },
            },
          }),
          { method: 'GET', path: '/v1/store-product-inventory' },
        ),
      startingCursor,
    )) {
      recordsSeen += page.length
      productsUpdated += await writePage({ logger, page, payload })

      // Saved after the page is written, and recording the cursor rather than
      // the clock: this window is not finished yet.
      await payload.updateGlobal({
        slug: 'voriSync',
        data: {
          cursor: page[page.length - 1]!.id,
          nextWatermark,
          watermark,
        },
      })
    }

    // The whole window is in, so the watermark can move and the cursor is
    // no longer needed.
    await payload.updateGlobal({
      slug: 'voriSync',
      data: {
        cursor: null,
        lastError: null,
        lastRunAt: new Date().toISOString(),
        lastRunProductsUpdated: productsUpdated,
        lastRunRecordsSeen: recordsSeen,
        nextWatermark: null,
        watermark: nextWatermark,
      },
    })

    logger.info(
      `vori: inventory sync complete — ${recordsSeen} records seen, ${productsUpdated} products updated`,
    )

    return { productsUpdated, recordsSeen, watermark }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    // The watermark is deliberately left where it was: the next run retries
    // the same window rather than skipping over it.
    await payload.updateGlobal({
      slug: 'voriSync',
      data: { lastError: message, lastRunAt: new Date().toISOString() },
    })

    logger.error(`vori: inventory sync failed — ${message}`)
    throw error
  }
}

/** Writes one page of inventory records, returning how many products moved. */
const writePage = async (args: {
  logger: VoriLogger
  page: VoriStoreProductInventory[]
  payload: Payload
}): Promise<number> => {
  const { logger, page, payload } = args

  const byVoriId = new Map(page.map((record) => [record.id, record]))

  // One query per page rather than per record: a page is 100 products and the
  // storefront may not carry most of them.
  const products = await payload.find({
    collection: 'products',
    limit: page.length,
    pagination: false,
    select: { inventory: true, voriStoreProductId: true },
    where: { voriStoreProductId: { in: [...byVoriId.keys()] } },
  })

  let updated = 0

  for (const product of products.docs) {
    const record = product.voriStoreProductId ? byVoriId.get(product.voriStoreProductId) : undefined
    if (!record) continue

    const inventory = inventoryFromVori(record.current)

    // Never counted is not the same as none in stock; leave the last known
    // figure alone rather than emptying the shelf on the website.
    if (inventory === null) continue
    if (inventory === product.inventory) continue

    if (Number(record.current) < 0) {
      logger.warn(
        `vori: store product ${record.id} is oversold in Vori (${record.current}); showing it as out of stock`,
      )
    }

    await payload.update({
      id: product.id,
      collection: 'products',
      data: { inventory, voriInventorySyncedAt: new Date().toISOString() },
    })

    updated += 1
  }

  return updated
}
