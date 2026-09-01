import { createWorkflow, transform, when, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import { buildVoriTransactionStep } from "./steps/build-vori-transaction"
import { moveVoriGiftCardsStep } from "./steps/move-vori-gift-cards"
import { postVoriTransactionStep } from "./steps/post-vori-transaction"
import { saveVoriOrderStateStep } from "./steps/save-vori-order-state"

export type RecordVoriTransactionInput = {
  orderId: string
}

/**
 * Records a placed order as a transaction in the grocer's books.
 *
 * The order of the steps is the whole design. The transaction ID is minted and
 * written to the order first, so a retry after an ambiguous failure reuses it.
 * Gift cards are spent before the send rather than after, so a card that cannot
 * pay stops the sale. Then the send, then the outcome.
 *
 * A sale Vori rejects outright returns the money already off a card. A conflict
 * does not: Vori holds a transaction under this ID, and the balance may have
 * paid for it.
 */
export const recordVoriTransactionWorkflow = createWorkflow(
  "record-vori-transaction",
  (input: RecordVoriTransactionInput) => {
    const built = buildVoriTransactionStep({ orderId: input.orderId })

    saveVoriOrderStateStep(
      transform({ built, input }, (data) => ({
        orderId: data.input.orderId,
        request: data.built.request,
        status: "pending" as const,
        transactionId: data.built.transactionId,
      })),
    ).config({ name: "save-vori-order-pending" })

    const redemption = moveVoriGiftCardsStep(
      transform({ built, input }, (data) => ({
        direction: "spend" as const,
        giftCardPayments: data.built.giftCardPayments,
        orderId: data.input.orderId,
        transactionId: data.built.transactionId,
      })),
    ).config({ name: "spend-vori-gift-cards" })

    const result = postVoriTransactionStep(
      transform({ built, redemption }, (data) => ({ ...data.built, redemption: data.redemption })),
    )

    when(
      "return-gift-card-money",
      { built, redemption, result },
      (data) =>
        data.result.status === "failed" &&
        data.redemption.status === "moved" &&
        data.redemption.entryIds.length > 0,
    ).then(() => {
      moveVoriGiftCardsStep(
        transform({ built, input }, (data) => ({
          direction: "return" as const,
          giftCardPayments: data.built.giftCardPayments,
          orderId: data.input.orderId,
          transactionId: data.built.transactionId,
        })),
      ).config({ name: "return-vori-gift-cards" })
    })

    saveVoriOrderStateStep(
      transform({ input, result }, (data) => ({
        detail: data.result.detail ?? null,
        giftCardIds: data.result.giftCardIds ?? null,
        orderId: data.input.orderId,
        status: data.result.status,
        transactionId: data.result.transactionId,
      })),
    ).config({ name: "save-vori-order-outcome" })

    return new WorkflowResponse(result)
  },
)
