import type { TaskConfig } from 'payload'

import { getVoriConfig } from '@/vori/config'
import { recordVoriTransaction } from '@/vori/recordTransaction'

/**
 * Records a completed order in Vori.
 *
 * Enqueued by the Orders afterChange hook. Only genuinely transient outcomes
 * throw: a 409, a validation error or an unbuildable payload are all recorded
 * on the order and returned as a completed run, because retrying any of them
 * would just fail the same way and bury the real problem under attempts.
 */
export const recordVoriTransactionTask: TaskConfig<'recordVoriTransaction'> = {
  slug: 'recordVoriTransaction',
  // Two runs for the same order would both send under the same idempotency
  // key. The API would dedupe them, but there is no reason to make it.
  concurrency: ({ input }) => `vori-transaction-${input.orderId}`,
  handler: async ({ input, req }) => {
    const result = await recordVoriTransaction({
      config: getVoriConfig(),
      logger: req.payload.logger,
      orderId: input.orderId,
      payload: req.payload,
    })

    if (result.retryable) {
      // Throwing is what hands this back to the queue's backoff. The order
      // already carries the failure detail either way.
      throw new Error(result.detail ?? `Recording order ${input.orderId} failed; will retry`)
    }

    return { output: { detail: result.detail ?? '', status: result.status } }
  },
  inputSchema: [{ name: 'orderId', type: 'text', required: true }],
  label: 'Record order in Vori',
  outputSchema: [
    { name: 'status', type: 'text' },
    { name: 'detail', type: 'text' },
  ],
  // Spaced out rather than immediate: the failures worth retrying are a rate
  // limit or an upstream blip, and neither clears in a second.
  retries: { attempts: 5, backoff: { type: 'exponential', delay: 15_000 } },
}
