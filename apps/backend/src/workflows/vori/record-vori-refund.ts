import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import { buildVoriRefundStep } from "./steps/build-vori-refund"
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
 */
export const recordVoriRefundWorkflow = createWorkflow(
  "record-vori-refund",
  (input: RecordVoriRefundInput) => {
    const built = buildVoriRefundStep({ orderId: input.orderId })
    const result = postVoriRefundStep(built)

    return new WorkflowResponse(result)
  },
)
