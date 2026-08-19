import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createOrderFulfillmentWorkflow } from "@medusajs/medusa/core-flows"

/**
 * Hands the order over the counter the moment it is placed.
 *
 * Every order here is a pickup order, and the sale has already been rung up in
 * Vori by the time this runs - which means the shelf has already been
 * decremented at the source. Leaving the order unfulfilled would have Medusa
 * hold a reservation on top of that, counting the same sale twice and showing
 * shoppers a smaller number than the grocer's own system does.
 *
 * Fulfilling releases the reservation, so the quantity on the site is whatever
 * Vori last reported and nothing else.
 */
export default async function fulfillOrderOnPlacement({
  container,
  event,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: orders } = await query.graph({
    entity: "order",
    // `items.*` rather than naming the fields: quantity lives on the item's
    // detail record, and asking for `items.quantity` returns the item without
    // it, which fails the fulfillment with a bare "quantity is required".
    fields: ["id", "items.*", "fulfillments.id"],
    filters: { id: event.data.id },
  })

  const order = orders[0]

  if (!order) {
    logger.warn(`vori: order ${event.data.id} vanished before it could be fulfilled`)
    return
  }

  // Nothing to do for an order somebody already fulfilled by hand.
  if (order.fulfillments?.length) {
    return
  }

  const items = (order.items ?? [])
    .filter(Boolean)
    .map((item) => ({ id: item!.id as string, quantity: Number(item!.quantity) }))
    .filter((item) => item.quantity > 0)

  if (items.length === 0) {
    return
  }

  await createOrderFulfillmentWorkflow(container).run({
    input: { order_id: order.id, items },
  })

  logger.info(`vori: order ${order.id} fulfilled on placement, releasing its stock reservation`)
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
