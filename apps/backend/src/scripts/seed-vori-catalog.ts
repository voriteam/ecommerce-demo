import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { VORI_MODULE } from "../modules/vori"
import type VoriModuleService from "../modules/vori/service"
import { seedVoriCatalogWorkflow } from "../workflows/vori/seed-vori-catalog"

/**
 * Builds the storefront catalog from a Vori store. Read-only against Vori.
 *
 * Run with: pnpm seed:catalog
 */
export default async function seedVoriCatalog({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const vori = container.resolve(VORI_MODULE) as VoriModuleService

  if (!(await vori.canRead())) {
    logger.error("VORI_API_KEY and VORI_STORE_ID must both be set to seed the catalog")
    process.exit(1)
  }

  const { result } = await seedVoriCatalogWorkflow(container).run({ input: {} })

  logger.info(
    `vori: catalog seeded — ${result.productsCreated} created, ${result.productsUpdated} refreshed, ` +
      `${result.categories} categories, ${result.levelsSet} stock levels set, ` +
      `${result.imagesFound} product images found`,
  )

  if (Object.keys(result.skipped).length) {
    logger.info(`vori: skipped ${JSON.stringify(result.skipped)}`)
  }
}
