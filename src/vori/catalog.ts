import type { Payload } from 'payload'

import { getVoriConfig, type VoriConfig } from './config'
import { createVoriClient, paginate, unwrap, type VoriLogger } from './client'
import {
  skipReasonFor,
  voriDepartmentToPayload,
  voriProductToPayload,
  type SkipReason,
  type VoriStoreProduct,
} from './mapping'

const PAGE_SIZE = 100

export type SeedResult = {
  categoriesUpserted: number
  productsCreated: number
  productsUpdated: number
  skipped: Record<SkipReason, number>
}

const emptySkipped = (): Record<SkipReason, number> => ({
  'gift card': 0,
  'manual item': 0,
  'no retail price': 0,
  'variable sale price': 0,
})

/**
 * Mirrors the Vori catalog into Payload.
 *
 * This is a seed, not a sync: it runs when someone sets the demo up or wants
 * to pick up catalog changes, and it is safe to re-run because every product
 * is upserted on `voriStoreProductId`. Ongoing on-hand quantities are the
 * inventory poll's job, not this one's.
 */
export const seedVoriCatalog = async (args: {
  config?: VoriConfig
  logger: VoriLogger
  payload: Payload
}): Promise<SeedResult> => {
  const config = args.config ?? getVoriConfig()
  const { logger, payload } = args

  if (!config.apiKey || !config.storeId) {
    throw new Error('VORI_API_KEY and VORI_STORE_ID must both be set to seed the catalog')
  }

  const client = createVoriClient({ config, logger })
  const result: SeedResult = {
    categoriesUpserted: 0,
    productsCreated: 0,
    productsUpdated: 0,
    skipped: emptySkipped(),
  }

  // ---------------------------------------------------------------------
  // Departments → categories
  //
  // Vori's departments are what makes this look like a grocery store rather
  // than a generic shop, so the storefront browses by them directly.
  // ---------------------------------------------------------------------
  const departmentIdToCategoryId = new Map<string, number | string>()

  for await (const page of paginate(async (cursor) =>
    unwrap(
      await client.GET('/v1/store-departments', {
        params: { query: { limit: PAGE_SIZE, starting_after: cursor, store_id: [config.storeId!] } },
      }),
      { method: 'GET', path: '/v1/store-departments' },
    ),
  )) {
    for (const department of page) {
      // A deactivated department still owns historical products; it just has
      // no place in the storefront's navigation.
      if (department.deactivated_at) continue

      const data = voriDepartmentToPayload(department)
      const existing = await payload.find({
        collection: 'categories',
        limit: 1,
        where: { slug: { equals: data.slug } },
      })

      const category = existing.docs[0]
        ? await payload.update({
            id: existing.docs[0].id,
            collection: 'categories',
            data,
          })
        : await payload.create({ collection: 'categories', data: data as never })

      departmentIdToCategoryId.set(department.id, category.id)
      result.categoriesUpserted += 1
    }
  }

  logger.info(`vori: upserted ${result.categoriesUpserted} categories from Vori departments`)

  // ---------------------------------------------------------------------
  // Store products → products
  // ---------------------------------------------------------------------
  const upsertProduct = async (product: VoriStoreProduct) => {
    const skip = skipReasonFor(product)
    if (skip) {
      result.skipped[skip] += 1
      return
    }

    const data = voriProductToPayload(product, {
      categoryId: departmentIdToCategoryId.get(product.department_id),
    })

    const existing = await payload.find({
      collection: 'products',
      limit: 1,
      where: { voriStoreProductId: { equals: product.id } },
    })

    if (existing.docs[0]) {
      await payload.update({
        id: existing.docs[0].id,
        collection: 'products',
        // The slug is part of a URL someone may already have open; leave a
        // renamed product where it is rather than breaking the link.
        data: { ...data, slug: undefined },
      })
      result.productsUpdated += 1
    } else {
      await payload.create({ collection: 'products', data: data as never })
      result.productsCreated += 1
    }
  }

  const fetchProducts = (ecommerceOnly: boolean) =>
    paginate<VoriStoreProduct>(async (cursor) =>
      unwrap(
        await client.GET('/v1/store-products', {
          params: {
            query: {
              active: true,
              ...(ecommerceOnly ? { ecommerce_enabled: true } : {}),
              include: ['inventory'],
              limit: PAGE_SIZE,
              starting_after: cursor,
              store_id: [config.storeId!],
            },
          },
        }),
        { method: 'GET', path: '/v1/store-products' },
      ),
    )

  let sawAny = false
  for await (const page of fetchProducts(true)) {
    sawAny = true
    for (const product of page) await upsertProduct(product)
  }

  // A store that has never set the e-commerce flag would otherwise produce an
  // empty storefront, which reads as a broken demo rather than as a
  // configuration gap. Fall back to the full active catalog and say so.
  if (!sawAny) {
    logger.warn(
      'vori: no products have ecommerce_enabled set for this store; falling back to the full active catalog',
    )
    for await (const page of fetchProducts(false)) {
      for (const product of page) await upsertProduct(product)
    }
  }

  const skippedTotal = Object.values(result.skipped).reduce((a, b) => a + b, 0)
  logger.info(
    `vori: catalog seed complete — ${result.productsCreated} created, ${result.productsUpdated} updated, ${skippedTotal} skipped`,
  )
  for (const [reason, count] of Object.entries(result.skipped)) {
    if (count > 0) logger.info(`vori:   skipped ${count} (${reason})`)
  }

  return result
}
