import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import {
  createProductsWorkflow,
  updateProductsWorkflow,
  updateProductVariantsWorkflow,
} from "@medusajs/medusa/core-flows"

import { voriProductToMedusa, type VoriStoreProduct } from "../../../modules/vori/lib/mapping"
import type { CategoryIdsByDepartment } from "./upsert-vori-categories"
import type { PhotographyByProduct } from "./fetch-product-images"
import type { StoreContext } from "./resolve-store-context"

export type UpsertProductsInput = {
  categoryIds: CategoryIdsByDepartment
  photography: PhotographyByProduct
  products: VoriStoreProduct[]
  store: StoreContext
}

export type UpsertProductsResult = {
  created: number
  updated: number
}

/**
 * How many products to hand to one workflow run.
 *
 * A real grocery catalog is thousands of products, and each one carries a
 * variant, a price and an inventory item. One workflow run for the whole
 * catalog is a single enormous transaction; one run per product is thousands
 * of round trips. Chunking is neither.
 */
const CHUNK = 100

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Creates or refreshes one Medusa product per Vori store product.
 *
 * `external_id` carries the Vori identifier and is what tells a create from an
 * update, so re-running the seed is safe and idempotent.
 *
 * A refresh sets `handle` as well, which is only safe because the handle is
 * the Vori ID: it cannot change for a product that already exists, so no link
 * ever moves. It is set rather than skipped so that a catalog seeded before
 * the handle became the ID migrates on the next run.
 */
export const upsertVoriProductsStep = createStep(
  "upsert-vori-products",
  async (input: UpsertProductsInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

    const { categoryIds, photography, products, store } = input

    const { data: existing } = await query.graph({
      entity: "product",
      fields: ["id", "external_id", "images.url", "thumbnail", "variants.id"],
      filters: { external_id: products.map((p) => p.id) },
    })

    const existingByExternalId = new Map(
      existing.filter((p) => p.external_id).map((p) => [p.external_id as string, p]),
    )

    const shaped = products.map((product) => ({
      medusa: voriProductToMedusa(product, {
        categoryIds: [categoryIds[product.department_id ?? ""]].filter(Boolean) as string[],
        photography: photography[product.id],
        salesChannelIds: [store.salesChannelId],
        shippingProfileId: store.shippingProfileId,
      }),
      vori: product,
    }))

    const toCreate = shaped.filter((s) => !existingByExternalId.has(s.vori.id))
    const toUpdate = shaped.filter((s) => existingByExternalId.has(s.vori.id))

    for (const [index, batch] of chunk(toCreate, CHUNK).entries()) {
      await createProductsWorkflow(container).run({
        input: { products: batch.map((s) => s.medusa) },
      })
      logger.info(
        `vori: created ${Math.min((index + 1) * CHUNK, toCreate.length)}/${toCreate.length} products`,
      )
    }

    /**
     * Whether a refresh would leave the gallery exactly as it already is.
     *
     * Medusa replaces the whole image collection on update, so writing an
     * unchanged gallery deletes and re-inserts every row. The catalog job runs
     * hourly, and most products keep the same photography for months.
     *
     * URLs are compared as a set rather than in order: the read does not
     * promise rank ordering, so an order-only change can go unwritten. Losing
     * that is worth thousands of untouched rows an hour.
     */
    const photographyUnchanged = (
      medusa: (typeof shaped)[number]["medusa"],
      record: { images?: { url?: string }[]; thumbnail?: null | string },
    ): boolean => {
      if (medusa.thumbnail !== record.thumbnail) return false

      const wanted = new Set(medusa.images?.map((image) => image.url) ?? [])
      const held = new Set((record.images ?? []).map((image) => image.url))

      return wanted.size === held.size && [...wanted].every((url) => held.has(url))
    }

    // Everything the product itself needs, in one call per batch.
    const productUpdates = toUpdate.map(({ medusa, vori }) => {
      const record = existingByExternalId.get(vori.id)!

      return {
        id: record.id,
        category_ids: medusa.category_ids,
        description: medusa.description,
        handle: medusa.handle,
        metadata: medusa.metadata,
        status: medusa.status,
        title: medusa.title,
        // Only when one was found, so a product that already has photography
        // does not have it cleared by a run that turned nothing up - and only
        // when it actually differs, so an unchanged gallery is left alone.
        ...(medusa.thumbnail && !photographyUnchanged(medusa, record)
          ? { images: medusa.images, thumbnail: medusa.thumbnail }
          : {}),
      }
    })

    for (const batch of chunk(productUpdates, CHUNK)) {
      await updateProductsWorkflow(container).run({ input: { products: batch } })
    }

    // Prices live on the variant, and a shelf price is the thing most likely to
    // have moved since the last run.
    const variantUpdates = toUpdate
      .map(({ medusa, vori }) => {
        const variantId = existingByExternalId.get(vori.id)!.variants?.[0]?.id
        if (!variantId) return null

        return {
          id: variantId,
          metadata: medusa.variants[0].metadata,
          prices: medusa.variants[0].prices,
        }
      })
      .filter(Boolean) as { id: string; metadata: Record<string, unknown>; prices: unknown[] }[]

    for (const batch of chunk(variantUpdates, CHUNK)) {
      await updateProductVariantsWorkflow(container).run({
        input: { product_variants: batch as never },
      })
    }

    logger.info(`vori: ${toCreate.length} products created, ${toUpdate.length} refreshed`)

    return new StepResponse<UpsertProductsResult>({
      created: toCreate.length,
      updated: toUpdate.length,
    })
  },
)
