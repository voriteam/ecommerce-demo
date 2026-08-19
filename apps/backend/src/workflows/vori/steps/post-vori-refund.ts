import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { VORI_MODULE } from "../../../modules/vori"
import { VoriApiError } from "../../../modules/vori/lib/errors"
import type VoriModuleService from "../../../modules/vori/service"
import type { BuiltRefund } from "./build-vori-refund"

export type RefundStatus = "conflict" | "failed" | "refunded" | "skipped"

export type RefundResult = {
  detail?: string
  refundId: string
  status: RefundStatus
}

/**
 * Sends the refund to Vori, and records the outcome on the order.
 *
 * The outcomes mirror the sale's: only a 429, a 5xx or a transport error
 * throws, and throwing is what makes the workflow retry. A 409 means Vori
 * already holds this refund ID with different contents, which no retry fixes.
 */
export const postVoriRefundStep = createStep(
  {
    name: "post-vori-refund",
    maxRetries: 5,
    retryInterval: 15,
  },
  async (input: BuiltRefund, { container }) => {
    const vori = container.resolve(VORI_MODULE) as VoriModuleService
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    const orderModule = container.resolve(Modules.ORDER)
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const save = async (status: RefundStatus, detail?: string) => {
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
            vori_refund_error: detail ?? null,
            vori_refund_id: input.refundId,
            vori_refund_request: input.request ?? null,
            vori_refund_status: status,
            vori_refunded_at: new Date().toISOString(),
          },
        },
      ])
    }

    if (!input.request || !input.transactionId) {
      await save("skipped", input.reason)
      return new StepResponse<RefundResult>({
        detail: input.reason,
        refundId: input.refundId,
        status: "skipped",
      })
    }

    const blocked = await vori.writeBlockedReason()
    if (blocked) {
      logger.info(
        `vori: not refunding ${input.refundId} — ${blocked}. The request is on the order.`,
      )
      await save("skipped", blocked)
      return new StepResponse<RefundResult>({
        detail: blocked,
        refundId: input.refundId,
        status: "skipped",
      })
    }

    try {
      await vori.refundTransaction(input.transactionId, input.request)

      logger.info(`vori: refunded transaction ${input.transactionId} as ${input.refundId}`)
      await save("refunded")
      return new StepResponse<RefundResult>({ refundId: input.refundId, status: "refunded" })
    } catch (error) {
      if (error instanceof VoriApiError && error.isConflict) {
        logger.warn(`vori: refund ${input.refundId} conflicts with one Vori already holds`)
        await save("conflict", error.message)
        return new StepResponse<RefundResult>({
          detail: error.message,
          refundId: input.refundId,
          status: "conflict",
        })
      }

      if (error instanceof VoriApiError && !error.isRetryable) {
        logger.error(`vori: refund ${input.refundId} rejected — ${error.message}`)
        await save("failed", error.message)
        return new StepResponse<RefundResult>({
          detail: error.message,
          refundId: input.refundId,
          status: "failed",
        })
      }

      throw error
    }
  },
)
