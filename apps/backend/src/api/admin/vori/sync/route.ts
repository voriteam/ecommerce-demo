import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { VORI_MODULE } from "../../../../modules/vori"
import type VoriModuleService from "../../../../modules/vori/service"
import { syncVoriInventoryWorkflow } from "../../../../workflows/vori/sync-vori-inventory"

/** Where the last sync got to, for the admin and for a live demo. */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const vori = req.scope.resolve(VORI_MODULE) as VoriModuleService

  res.json({
    configured: await vori.canRead(),
    state: await vori.getSyncState(),
    write_blocked_reason: await vori.writeBlockedReason(),
  })
}

/**
 * Runs the poll now instead of waiting for the next tick.
 *
 * This exists for demos: changing a count in Vori and watching it land on the
 * storefront is the whole point, and two minutes is a long time to stand in
 * front of an audience.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const vori = req.scope.resolve(VORI_MODULE) as VoriModuleService

  if (!(await vori.canRead())) {
    res.status(400).json({ message: "VORI_API_KEY and VORI_STORE_ID must both be set" })
    return
  }

  const { result } = await syncVoriInventoryWorkflow(req.scope).run({ input: {} })

  res.json(result)
}
