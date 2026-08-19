import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { VORI_MODULE } from "../../../modules/vori"
import { VoriApiError } from "../../../modules/vori/lib/errors"
import { TransactionBuildError } from "../../../modules/vori/lib/transactions"
import type VoriModuleService from "../../../modules/vori/service"
import type { BuiltTransaction } from "./build-vori-transaction"

export type RecordStatus = "conflict" | "failed" | "recorded" | "skipped"

export type RecordResult = {
  detail?: string
  status: RecordStatus
  transactionId: string
}

/**
 * Sends the transaction to Vori.
 *
 * Outcomes are deliberately not all failures:
 *
 *   - `recorded` — Vori accepted it.
 *   - `skipped` — a write gate is closed. The request was built and is on the
 *     order, but nothing was sent. This is the default posture of a fresh
 *     clone.
 *   - `conflict` — a 409. The transaction ID already exists in Vori with
 *     different contents, so this is settled, not transient: retrying the same
 *     divergent payload returns 409 forever.
 *   - `failed` — a 4xx or a payload we should not have built. Our bug to fix,
 *     not something a retry resolves.
 *
 * Only a 429, a 5xx or a transport error throws, and throwing is what makes
 * the workflow engine retry. The transaction ID is minted before the first
 * send, so a retry after an ambiguous transport failure lands on the same
 * record rather than creating a second sale.
 */
export const postVoriTransactionStep = createStep(
  {
    name: "post-vori-transaction",
    maxRetries: 5,
    retryInterval: 15,
  },
  async (input: BuiltTransaction, { container }) => {
    const vori = container.resolve(VORI_MODULE) as VoriModuleService
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

    const blocked = await vori.writeBlockedReason()
    if (blocked) {
      logger.info(
        `vori: not recording transaction ${input.transactionId} — ${blocked}. ` +
          "The request is stored on the order.",
      )
      return new StepResponse<RecordResult>({
        detail: blocked,
        status: "skipped",
        transactionId: input.transactionId,
      })
    }

    try {
      await vori.createTransaction(input.request)

      logger.info(`vori: recorded transaction ${input.transactionId}`)
      return new StepResponse<RecordResult>({
        status: "recorded",
        transactionId: input.transactionId,
      })
    } catch (error) {
      if (error instanceof VoriApiError && error.isConflict) {
        logger.warn(
          `vori: transaction ${input.transactionId} conflicts with one Vori already holds — ${error.message}`,
        )
        return new StepResponse<RecordResult>({
          detail: error.message,
          status: "conflict",
          transactionId: input.transactionId,
        })
      }

      if (error instanceof TransactionBuildError) {
        return new StepResponse<RecordResult>({
          detail: error.message,
          status: "failed",
          transactionId: input.transactionId,
        })
      }

      if (error instanceof VoriApiError && !error.isRetryable) {
        logger.error(`vori: transaction ${input.transactionId} rejected — ${error.message}`)
        return new StepResponse<RecordResult>({
          detail: error.message,
          status: "failed",
          transactionId: input.transactionId,
        })
      }

      throw error
    }
  },
)
