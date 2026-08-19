import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import type { CreateTransactionRequest } from "../../../modules/vori/lib/transactions"
import type { RecordStatus } from "./post-vori-transaction"

export type SaveOrderStateInput = {
  detail?: null | string
  orderId: string
  request?: CreateTransactionRequest
  status: RecordStatus | "pending"
  transactionId: string
}

/**
 * Records what happened on the order itself.
 *
 * The full request is kept, not just the outcome, because the interesting
 * moment in a demo is being able to open an order and see exactly what would
 * be sent to the grocer's books — especially when writes are switched off and
 * nothing was sent at all.
 */
export const saveVoriOrderStateStep = createStep(
  "save-vori-order-state",
  async (input: SaveOrderStateInput, { container }) => {
    const orderModule = container.resolve(Modules.ORDER)
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "metadata"],
      filters: { id: input.orderId },
    })

    const existing = (orders[0]?.metadata ?? {}) as Record<string, unknown>

    await orderModule.updateOrders([
      {
        id: input.orderId,
        metadata: {
          ...existing,
          vori_synced_at: new Date().toISOString(),
          vori_sync_error: input.detail ?? null,
          vori_sync_status: input.status,
          vori_transaction_id: input.transactionId,
          ...(input.request ? { vori_request: input.request } : {}),
        },
      },
    ])

    return new StepResponse(input.orderId)
  },
)
