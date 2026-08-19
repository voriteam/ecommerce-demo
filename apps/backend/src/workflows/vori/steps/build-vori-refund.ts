import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { v7 as uuidv7 } from "uuid"

import { VORI_MODULE } from "../../../modules/vori"
import { decimalToCentsRounded } from "../../../modules/vori/lib/money"
import { buildFullRefund, RefundBuildError } from "../../../modules/vori/lib/refunds"
import type { CreateRefundRequest } from "../../../modules/vori/lib/refunds"
import type VoriModuleService from "../../../modules/vori/service"

export type BuiltRefund = {
  orderId: string
  /** Null when there is nothing to send; `reason` says why. */
  request: CreateRefundRequest | null
  reason?: string
  refundId: string
  transactionId: string | null
}

/**
 * Turns a refunded payment into the refund Vori should record.
 *
 * Only a full reversal is built. A Medusa refund is an amount against a
 * payment with no items attached, while a Vori refund line has to name the
 * line it reverses - so a partial refund cannot be expressed without guessing
 * which products came back, which would put the wrong stock on a grocer's
 * shelves and misstate their tax. Those are reported and left alone.
 *
 * The refund ID is minted and stored on the order before anything is sent, the
 * same way the sale's transaction ID is, so a retry lands on the same record.
 */
export const buildVoriRefundStep = createStep(
  "build-vori-refund",
  async (input: { orderId: string }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    const vori = container.resolve(VORI_MODULE) as VoriModuleService

    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "metadata",
        "payment_collections.payments.id",
        "payment_collections.payments.amount",
        "payment_collections.payments.captured_at",
        "payment_collections.payments.refunds.*",
      ],
      filters: { id: input.orderId },
    })

    const order = orders[0]

    if (!order) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${input.orderId} was not found.`)
    }

    const payment = ((order.payment_collections ?? []) as any[]).flatMap(
      (collection) => collection.payments ?? [],
    )[0]

    const refundId = uuidv7()

    const nothingToSend = (reason: string): BuiltRefund => {
      logger.info(`vori: not reversing order ${order.id} — ${reason}`)
      return { orderId: order.id, reason, refundId, request: null, transactionId: null }
    }

    if (!payment) {
      return new StepResponse<BuiltRefund>(
        nothingToSend("the order has no payment, so there is nothing to give back"),
      )
    }

    if (!payment.captured_at) {
      return new StepResponse<BuiltRefund>(
        nothingToSend("the payment was never captured, so no money changed hands"),
      )
    }

    const paidCents = decimalToCentsRounded(String(payment.amount)) ?? 0
    const refundedCents = ((payment.refunds ?? []) as any[]).reduce(
      (total, refund) => total + (decimalToCentsRounded(String(refund.amount)) ?? 0),
      0,
    )

    if (refundedCents < paidCents) {
      return new StepResponse<BuiltRefund>(
        nothingToSend(
          "only part of the payment was given back, and a reversal has to name the lines it covers",
        ),
      )
    }

    const transaction = await vori.findTransactionByExternalId(order.id)

    if (!transaction) {
      return new StepResponse<BuiltRefund>(
        nothingToSend("the sale was never recorded in Vori, so there is nothing to reverse"),
      )
    }

    // A read line carries no weight, so the figures we sent are the only place
    // a by-weight line's weight survives.
    const sent = (order.metadata as Record<string, any> | null)?.vori_request
    const weightsByStoreProductId: Record<string, string> = {}
    for (const line of (sent?.line_items ?? []) as any[]) {
      if (line.weight && line.store_product_id) {
        weightsByStoreProductId[line.store_product_id] = String(line.weight)
      }
    }

    try {
      const request = buildFullRefund({
        completedAt: new Date().toISOString(),
        original: transaction,
        // Stripe's own refund reference is not on the payment record, so the
        // refund is identified by ours. It still traces back to one refund.
        paymentReference: `medusa:${refundId}`,
        refundId,
        weightsByStoreProductId,
      })

      return new StepResponse<BuiltRefund>({
        orderId: order.id,
        refundId,
        request,
        transactionId: transaction.id,
      })
    } catch (error) {
      if (error instanceof RefundBuildError) {
        return new StepResponse<BuiltRefund>(nothingToSend(error.message))
      }
      throw error
    }
  },
)
