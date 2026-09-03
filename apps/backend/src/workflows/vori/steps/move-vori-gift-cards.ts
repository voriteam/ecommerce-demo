import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { VORI_MODULE } from "../../../modules/vori"
import { VoriApiError } from "../../../modules/vori/lib/errors"
import { buildGiftCardMovement, GiftCardError } from "../../../modules/vori/lib/gift-cards"
import type { VoriGiftCardPayment } from "../../../modules/vori/lib/transactions"
import type VoriModuleService from "../../../modules/vori/service"

export type GiftCardMoveStatus = "failed" | "moved" | "skipped"

export type GiftCardMoveResult = {
  detail?: string
  /** Empty unless the status is `moved`. */
  entryIds: string[]
  status: GiftCardMoveStatus
}

export type MoveVoriGiftCardsInput = {
  direction: "return" | "spend"
  giftCardPayments: VoriGiftCardPayment[]
  orderId: string
  transactionId: string
}

/**
 * Moves money on the gift cards that paid for an order.
 *
 * Spending runs before the sale is sent, so a card that cannot pay stops the
 * sale rather than being recorded as though it had. Vori checks the balance
 * under a lock on the card, which is why nothing here checks it first.
 *
 * Needs no compensation: every entry is keyed off the transaction, so re-running
 * is free.
 */
export const moveVoriGiftCardsStep = createStep(
  {
    name: "move-vori-gift-cards",
    maxRetries: 5,
    retryInterval: 15,
  },
  async (input: MoveVoriGiftCardsInput, { container }) => {
    const vori = container.resolve(VORI_MODULE) as VoriModuleService
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

    if (input.giftCardPayments.length === 0) {
      return new StepResponse<GiftCardMoveResult>({ entryIds: [], status: "moved" })
    }

    const blocked = await vori.writeBlockedReason()
    if (blocked) {
      logger.info(
        `vori: not moving gift card money for order ${input.orderId} — ${blocked}. ` +
          "The balances are untouched.",
      )
      return new StepResponse<GiftCardMoveResult>({
        detail: blocked,
        entryIds: [],
        status: "skipped",
      })
    }

    const entryIds: string[] = []

    for (const payment of input.giftCardPayments) {
      try {
        const entry = await vori.createGiftCardTransaction(
          payment.giftCardId,
          buildGiftCardMovement({
            amountCents: input.direction === "spend" ? -payment.amountCents : payment.amountCents,
            giftCardId: payment.giftCardId,
            orderId: input.orderId,
            storeId: vori.options.storeId!,
            transactionId: input.transactionId,
          }),
        )

        entryIds.push(entry.id)
      } catch (error) {
        if (error instanceof GiftCardError || (error instanceof VoriApiError && !error.isRetryable)) {
          const detail = error instanceof Error ? error.message : String(error)
          logger.error(
            `vori: gift card ${payment.giftCardId} refused a ${input.direction} for order ${input.orderId} — ${detail}`,
          )
          return new StepResponse<GiftCardMoveResult>({ detail, entryIds, status: "failed" })
        }

        throw error
      }
    }

    logger.info(
      `vori: ${input.direction === "spend" ? "spent" : "returned"} ${entryIds.length} gift card ` +
        `payment(s) for order ${input.orderId}`,
    )

    return new StepResponse<GiftCardMoveResult>({ entryIds, status: "moved" })
  },
)
