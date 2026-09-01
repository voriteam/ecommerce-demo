import { createWorkflow, transform, when, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import { buildVoriRefundStep } from "./steps/build-vori-refund"
import { moveVoriGiftCardsStep } from "./steps/move-vori-gift-cards"
import { postVoriRefundStep } from "./steps/post-vori-refund"

export type RecordVoriRefundInput = {
  orderId: string
}

/**
 * Reverses a sale in the grocer's books when an order is cancelled.
 *
 * The sale is found in Vori by the order ID it was recorded under, rather than
 * from anything kept on this side: a refund has to name the line and payment
 * IDs it reverses, and those only exist once Vori has assigned them.
 *
 * A gift card is credited back only once the reversal itself is accepted: a
 * balance returned against a sale still standing would pay the shopper twice.
 */
export const recordVoriRefundWorkflow = createWorkflow(
  "record-vori-refund",
  (input: RecordVoriRefundInput) => {
    const built = buildVoriRefundStep({ orderId: input.orderId })
    const result = postVoriRefundStep(built)

    when(
      "return-gift-card-money",
      { built, result },
      (data) => data.result.status === "refunded" && data.built.giftCardPayments.length > 0,
    ).then(() => {
      moveVoriGiftCardsStep(
        transform({ built }, (data) => ({
          direction: "return" as const,
          giftCardPayments: data.built.giftCardPayments,
          orderId: data.built.orderId,
          transactionId: data.built.transactionId!,
        })),
      ).config({ name: "return-vori-gift-cards" })
    })

    return new WorkflowResponse(result)
  },
)
