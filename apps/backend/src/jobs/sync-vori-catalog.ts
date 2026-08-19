import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { VORI_MODULE } from "../modules/vori"
import type VoriModuleService from "../modules/vori/service"
import { seedVoriCatalogWorkflow } from "../workflows/vori/seed-vori-catalog"

/**
 * Keeps the catalog in step with the store.
 *
 * Products a grocer adds appear, names and prices are refreshed, and anything
 * they stop selling online is taken down. This is the same work
 * `pnpm seed:catalog` does - there is one catalog sync, run on a schedule as
 * well as by hand.
 *
 * Slower than the stock poll on purpose: a catalog changes over days, a shelf
 * quantity changes all day, and a full pass over several thousand products is
 * not something to do every couple of minutes.
 */
export default async function syncVoriCatalogJob(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const vori = container.resolve(VORI_MODULE) as VoriModuleService

  if (!vori.options.syncEnabled) return
  if (!(await vori.canRead())) {
    logger.debug("vori: catalog sync skipped — no Vori credentials are configured")
    return
  }

  const { result } = await seedVoriCatalogWorkflow(container).run({ input: {} })

  logger.info(
    `vori: catalog sync — ${result.productsCreated} added, ${result.productsUpdated} refreshed, ` +
      `${result.productsDeactivated} taken down`,
  )
}

export const config = {
  name: "sync-vori-catalog",
  schedule: process.env.VORI_CATALOG_CRON || "0 * * * *",
}
