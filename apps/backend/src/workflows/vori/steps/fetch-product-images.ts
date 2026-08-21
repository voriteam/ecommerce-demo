import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { getVoriConfig } from "../../../modules/vori/lib/config"
import { findProductImages, normalizeBarcode } from "../../../modules/vori/lib/open-food-facts"
import {
  fallbackPhotography,
  isVoriHostedImage,
  voriProductPhotography,
  type ProductPhotography,
  type VoriStoreProduct,
} from "../../../modules/vori/lib/mapping"

/** Vori store product ID to the photography settled on for it. */
export type PhotographyByProduct = Record<string, ProductPhotography>

/**
 * Settles what each product in the catalog is illustrated with.
 *
 * The grocer's own photography wins wherever they have any: it comes down with
 * the catalog at no extra cost and it is a picture of the thing actually on
 * their shelf. Open Food Facts fills the gaps, matched on the barcode that
 * scans at the register.
 *
 * Set OPEN_FOOD_FACTS_ENABLED=false to seed without the fallback - useful
 * offline, or when re-seeding repeatedly and the lookups are just noise. The
 * grocer's own pictures still come through.
 */
export const fetchProductImagesStep = createStep(
  "fetch-product-images",
  async (products: VoriStoreProduct[], { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const photography: PhotographyByProduct = {}
    const unillustrated: VoriStoreProduct[] = []

    // Before any lookup and before touching the database: a product the grocer
    // has photographed is settled, including one currently showing a fallback
    // picture. That is what upgrades it on the next sync.
    for (const product of products) {
      const own = voriProductPhotography(product)
      if (own) photography[product.id] = own
      else unillustrated.push(product)
    }

    logger.info(
      `vori: ${Object.keys(photography).length} of ${products.length} products carry the grocer's own photography`,
    )

    if (!getVoriConfig().openFoodFactsEnabled) return new StepResponse(photography)

    const needing = unillustrated.filter((product) => product.barcode)
    if (needing.length === 0) return new StepResponse(photography)

    const { data: existing } = await query.graph({
      entity: "product",
      fields: ["external_id", "thumbnail"],
      filters: { external_id: needing.map((product) => product.id) },
    })

    const alreadyIllustrated = new Set(
      existing
        // A thumbnail on the grocer's own bucket, for a product that no longer
        // reports any photography, means they took the picture down. Let the
        // fallback have a go rather than leaving a dead URL on the shelf.
        .filter((p) => p.thumbnail && !isVoriHostedImage(p.thumbnail as string))
        .map((p) => p.external_id as string),
    )

    const looking = needing.filter((product) => !alreadyIllustrated.has(product.id))
    if (looking.length === 0) return new StepResponse(photography)

    const byBarcode = await findProductImages(
      looking.map((product) => product.barcode as string),
      logger,
    )

    for (const product of looking) {
      const url = byBarcode.get(normalizeBarcode(product.barcode as string))
      if (url) photography[product.id] = fallbackPhotography(url)
    }

    return new StepResponse(photography)
  },
)
