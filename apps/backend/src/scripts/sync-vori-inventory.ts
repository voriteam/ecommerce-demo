import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { VORI_MODULE } from "../modules/vori"
import type VoriModuleService from "../modules/vori/service"
import { syncVoriInventoryWorkflow } from "../workflows/vori/sync-vori-inventory"

/**
 * Runs one inventory poll, the same one the scheduled job runs.
 *
 * Run with: pnpm sync:inventory
 */
export default async function syncVoriInventory({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const vori = container.resolve(VORI_MODULE) as VoriModuleService

  if (!(await vori.canRead())) {
    logger.error("VORI_API_KEY and VORI_STORE_ID must both be set to sync inventory")
    process.exit(1)
  }

  const { result } = await syncVoriInventoryWorkflow(container).run({ input: {} })

  logger.info(
    `vori: ${result.recordsSeen} records seen, ${result.productsUpdated} stock levels updated`,
  )
}
