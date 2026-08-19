import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { VORI_MODULE } from "../modules/vori"
import type VoriModuleService from "../modules/vori/service"
import { recordVoriTransactionWorkflow } from "../workflows/vori/record-vori-transaction"

/**
 * Records every completed checkout in the grocer's books.
 *
 * The work is handed to a workflow rather than done here because sending can
 * fail transiently and the shopper must not wait on a retry. The workflow owns
 * the idempotency key, the backoff and the outcome, so this is only the
 * trigger.
 */
export default async function voriOrderPlacedHandler({
  container,
  event,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const vori = container.resolve(VORI_MODULE) as VoriModuleService

  if (!(await vori.canRead())) {
    logger.info(`vori: order ${event.data.id} not recorded — no Vori credentials are configured`)
    return
  }

  await recordVoriTransactionWorkflow(container).run({ input: { orderId: event.data.id } })
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
