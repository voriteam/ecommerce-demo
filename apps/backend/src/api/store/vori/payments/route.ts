import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { VORI_MODULE } from "../../../../modules/vori"
import type VoriModuleService from "../../../../modules/vori/service"

/**
 * What the checkout needs to read a card: the mode the store charges in, and
 * the public key the browser tokenizes with. Both come from Vori rather than
 * this app's configuration, so a key the grocer rotates takes effect here
 * without a redeploy.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const vori = req.scope.resolve(VORI_MODULE) as VoriModuleService

  if (!(await vori.canRead())) {
    res.json({ mode: null, token_key: null })
    return
  }

  res.json({ mode: await vori.paymentsMode(), token_key: await vori.ecommerceTokenizationKey() })
}
