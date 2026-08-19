import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { batchInventoryItemLevelsWorkflow } from "@medusajs/medusa/core-flows"

import type { MedusaContainer } from "@medusajs/framework/types"

/** A Vori store product ID and the count Vori last reported for it. */
export type InventoryCount = {
  /** Null means never counted. The shelf is left as it is. */
  quantity: null | number
  /** Raw value, kept only so an oversold shelf can be logged as such. */
  raw?: null | string
  storeProductId: string
}

export type ApplyInventoryInput = {
  counts: InventoryCount[]
  stockLocationId: string
}

/** The SKU every seeded variant carries, derived from the Vori identifier. */
export const voriSku = (storeProductId: string): string => `VORI-${storeProductId}`

/**
 * Writes on-hand quantities onto the matching inventory levels.
 *
 * Products this store does not carry are silently ignored — a Vori store holds
 * plenty the demo never seeded — and so is a product Vori has never counted,
 * because "unknown" is not "none in stock" and emptying a shelf on the website
 * over missing data is worse than showing a slightly stale figure.
 *
 * Returns how many levels actually moved, so a sync that saw a thousand
 * records and changed nothing reports that honestly.
 */
export const applyInventoryLevels = async (
  input: ApplyInventoryInput,
  container: MedusaContainer,
): Promise<number> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const countable = input.counts.filter((c) => c.quantity !== null)
  if (countable.length === 0) return 0

  const bySku = new Map(countable.map((c) => [voriSku(c.storeProductId), c]))

  const { data: variants } = await query.graph({
    entity: "variant",
    fields: ["id", "sku", "inventory_items.inventory_item_id"],
    filters: { sku: [...bySku.keys()] },
  })

  const wanted = new Map<string, number>()
  for (const variant of variants) {
    const count = variant.sku ? bySku.get(variant.sku) : undefined
    const inventoryItemId = variant.inventory_items?.[0]?.inventory_item_id
    if (!count || !inventoryItemId) continue

    if (count.raw !== undefined && count.raw !== null && Number(count.raw) < 0) {
      logger.warn(
        `vori: store product ${count.storeProductId} is oversold in Vori (${count.raw}); showing it as out of stock`,
      )
    }

    wanted.set(inventoryItemId, count.quantity as number)
  }

  if (wanted.size === 0) return 0

  const { data: levels } = await query.graph({
    entity: "inventory_level",
    fields: ["id", "inventory_item_id", "stocked_quantity"],
    filters: { inventory_item_id: [...wanted.keys()], location_id: input.stockLocationId },
  })

  const existing = new Map(levels.map((level) => [level.inventory_item_id as string, level]))

  const create: { inventory_item_id: string; location_id: string; stocked_quantity: number }[] = []
  const update: {
    id: string
    inventory_item_id: string
    location_id: string
    stocked_quantity: number
  }[] = []

  for (const [inventoryItemId, quantity] of wanted) {
    const level = existing.get(inventoryItemId)

    if (!level) {
      create.push({
        inventory_item_id: inventoryItemId,
        location_id: input.stockLocationId,
        stocked_quantity: quantity,
      })
      continue
    }

    // Skipping unchanged levels keeps the write small and keeps the admin's
    // "last updated" honest about when stock actually moved.
    if (Number(level.stocked_quantity) === quantity) continue

    update.push({
      id: level.id as string,
      inventory_item_id: inventoryItemId,
      location_id: input.stockLocationId,
      stocked_quantity: quantity,
    })
  }

  if (create.length === 0 && update.length === 0) return 0

  await batchInventoryItemLevelsWorkflow(container).run({
    input: { create, delete: [], update },
  })

  return create.length + update.length
}

export const applyInventoryLevelsStep = createStep(
  "apply-inventory-levels",
  async (input: ApplyInventoryInput, { container }) =>
    new StepResponse(await applyInventoryLevels(input, container)),
)
