import { ContainerRegistrationKeys, ProductStatus } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"

import type { VoriStoreProduct } from "../../../modules/vori/lib/mapping"

/** How many products to hand to one workflow run. */
const CHUNK = 100

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Takes down products the store no longer sells online.
 *
 * A grocer withdraws a product by clearing its ecommerce flag, deactivating it,
 * or making it something a website cannot sell - a manual item, a variable
 * price. Any of those and it stops appearing in the catalog fetch, so anything
 * this store still has published that the fetch did not return is no longer
 * meant to be on sale.
 *
 * Unpublished rather than deleted, so its orders, its handle and its history
 * survive. A product that comes back is published again by the upsert, which
 * sets the status on every run.
 */
export const deactivateWithdrawnProductsStep = createStep(
  "deactivate-withdrawn-products",
  async (sellable: VoriStoreProduct[], { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

    // An empty catalog is far more likely to be a bad response than a grocer
    // withdrawing every product they sell, and acting on it would empty the
    // storefront. Do nothing and let the next run decide.
    if (sellable.length === 0) {
      logger.warn("vori: catalog came back empty, so nothing was taken down")
      return new StepResponse({ deactivated: 0 })
    }

    const stillSold = new Set(sellable.map((product) => product.id))

    const { data: published } = await query.graph({
      entity: "product",
      fields: ["id", "external_id", "status"],
      filters: { status: ProductStatus.PUBLISHED },
    })

    const withdrawn = published
      .filter((product) => product.external_id && !stillSold.has(product.external_id as string))
      .map((product) => product.id as string)

    if (withdrawn.length === 0) {
      return new StepResponse({ deactivated: 0 })
    }

    for (const batch of chunk(withdrawn, CHUNK)) {
      await updateProductsWorkflow(container).run({
        input: { selector: { id: batch }, update: { status: ProductStatus.DRAFT } },
      })
    }

    logger.info(`vori: ${withdrawn.length} products are no longer sold online and were taken down`)

    return new StepResponse({ deactivated: withdrawn.length })
  },
)
