import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { VORI_MODULE } from "../modules/vori"
import type VoriModuleService from "../modules/vori/service"
import { recordVoriRefundWorkflow } from "../workflows/vori/record-vori-refund"
import { syncVoriInventoryWorkflow } from "../workflows/vori/sync-vori-inventory"

/**
 * Reverses the sale in the grocer's books when an order is cancelled.
 *
 * Cancelling in the admin gives the shopper their money back. Without this the
 * grocer's books would still show the sale, with no entry against it and stock
 * that never came back.
 *
 * Cancellation rather than the payment refund action, because that is the
 * gesture this demo shows - and because refunding a payment directly emits
 * nothing to listen for: the cancel path refunds through a workflow that does
 * not raise an event, so `order.canceled` is what actually fires.
 */
export default async function voriOrderCanceledHandler({
  container,
  event,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const vori = container.resolve(VORI_MODULE) as VoriModuleService

  if (!(await vori.canRead())) {
    logger.info(
      `vori: cancellation of order ${event.data.id} not recorded — no credentials configured`,
    )
    return
  }

  await recordVoriRefundWorkflow(container).run({ input: { orderId: event.data.id } })

  // Returned stock moves the shelf at the source, so pull it straight away
  // rather than leaving the site a poll behind.
  try {
    await syncVoriInventoryWorkflow(container).run({ input: {} })
  } catch (error) {
    logger.warn(
      `vori: could not refresh stock after cancelling order ${event.data.id} — ` +
        `the scheduled poll will catch it (${error instanceof Error ? error.message : String(error)})`,
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.canceled",
}
