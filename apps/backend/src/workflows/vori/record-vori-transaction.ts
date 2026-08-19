import { createWorkflow, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import { buildVoriTransactionStep } from "./steps/build-vori-transaction"
import { postVoriTransactionStep } from "./steps/post-vori-transaction"
import { saveVoriOrderStateStep } from "./steps/save-vori-order-state"

export type RecordVoriTransactionInput = {
  orderId: string
}

/**
 * Records a placed order as a transaction in the grocer's books.
 *
 * The order of the three steps is the whole design. The transaction ID is
 * minted and written to the order first, so a retry after an ambiguous failure
 * reuses it. Then the send, which retries on its own for anything transient.
 * Then the outcome, written back where a demo can see it.
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

    const result = postVoriTransactionStep(built)

    saveVoriOrderStateStep(
      transform({ input, result }, (data) => ({
        detail: data.result.detail ?? null,
        orderId: data.input.orderId,
        status: data.result.status,
        transactionId: data.result.transactionId,
      })),
    ).config({ name: "save-vori-order-outcome" })

    return new WorkflowResponse(result)
  },
)
