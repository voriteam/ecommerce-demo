import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { VORI_MODULE } from "../modules/vori"
import type VoriModuleService from "../modules/vori/service"
import { syncVoriInventoryWorkflow } from "../workflows/vori/sync-vori-inventory"

/**
 * Keeps shelf quantities current.
 *
 * Every couple of minutes by default, which is a freshness setting rather than
 * a correctness one: Vori is the only writer of stock, so a late poll shows a
 * slightly stale number and never a wrong one. Turn the interval down for a
 * live demo where someone is changing counts in Vori and watching the site.
 */
export default async function syncVoriInventoryJob(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const vori = container.resolve(VORI_MODULE) as VoriModuleService

  if (!vori.options.syncEnabled) return
  if (!(await vori.canRead())) {
    logger.debug("vori: inventory sync skipped — no Vori credentials are configured")
    return
  }

  await syncVoriInventoryWorkflow(container).run({ input: {} })
}

export const config = {
  name: "sync-vori-inventory",
  schedule: process.env.VORI_SYNC_CRON || "*/2 * * * *",
}
