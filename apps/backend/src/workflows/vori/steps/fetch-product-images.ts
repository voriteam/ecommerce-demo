import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { findProductImages, normalizeBarcode } from "../../../modules/vori/lib/open-food-facts"
import type { VoriStoreProduct } from "../../../modules/vori/lib/mapping"

/** Vori store product ID to a front-of-pack image URL. */
export type ImagesByProduct = Record<string, string>

/**
 * Finds product photography for the catalog, by barcode.
 *
 * Set OPEN_FOOD_FACTS_ENABLED=false to seed without it - useful offline, or
 * when re-seeding repeatedly and the lookups are just noise.
 *
 * Products that already have an image in this store are not looked up again,
 * which keeps a re-seed cheap and leaves the free service alone. A product that
 * has never matched is retried each run, since their coverage grows over time.
 */
export const fetchProductImagesStep = createStep(
  "fetch-product-images",
  async (products: VoriStoreProduct[], { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    if (process.env.OPEN_FOOD_FACTS_ENABLED === "false") {
      return new StepResponse<ImagesByProduct>({})
    }

    const { data: existing } = await query.graph({
      entity: "product",
      fields: ["external_id", "thumbnail"],
      filters: { external_id: products.map((product) => product.id) },
    })

    const alreadyIllustrated = new Set(
      existing.filter((p) => p.thumbnail).map((p) => p.external_id as string),
    )

    const needing = products.filter(
      (product) => product.barcode && !alreadyIllustrated.has(product.id),
    )

    if (needing.length === 0) {
      return new StepResponse<ImagesByProduct>({})
    }

    const byBarcode = await findProductImages(
      needing.map((product) => product.barcode as string),
      logger,
    )

    const images: ImagesByProduct = {}
    for (const product of needing) {
      const image = byBarcode.get(normalizeBarcode(product.barcode as string))
      if (image) images[product.id] = image
    }

    return new StepResponse<ImagesByProduct>(images)
  },
)
