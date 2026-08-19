import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { VORI_MODULE } from "../modules/vori"
import type VoriModuleService from "../modules/vori/service"
import { recordVoriTransactionWorkflow } from "../workflows/vori/record-vori-transaction"
import { syncVoriInventoryWorkflow } from "../workflows/vori/sync-vori-inventory"

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

  // Recording the sale moves the shelf in Vori, so poll straight away rather
  // than leaving the site showing pre-sale quantities until the next tick.
  // The window this covers is small and the poll is cheap - it asks only for
  // what changed since the last run, which at this point is this sale.
  //
  // Failing here must not fail the order: the scheduled job picks the same
  // change up on its next pass.
  try {
    await syncVoriInventoryWorkflow(container).run({ input: {} })
  } catch (error) {
    logger.warn(
      `vori: could not refresh stock right after order ${event.data.id} — ` +
        `the scheduled poll will catch it (${error instanceof Error ? error.message : String(error)})`,
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
