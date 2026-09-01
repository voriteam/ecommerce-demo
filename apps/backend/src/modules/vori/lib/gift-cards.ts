import type { components } from "./generated/schema"

import { centsToDecimal, decimalToCents } from "./money"

export type GiftCard = components["schemas"]["GiftCard"]
export type GiftCardStatus = components["schemas"]["GiftCardStatus"]
export type GiftCardTransaction = components["schemas"]["GiftCardTransaction"]
export type CreateGiftCardTransactionRequest =
  components["schemas"]["CreateGiftCardTransactionRequest"]

export class GiftCardError extends Error {}

/**
 * All of a gift card a shopper is ever shown.
 *
 * The full record carries the magstripe and printed account numbers, which are
 * card-equivalent data. Reducing here rather than at the route keeps them off
 * every caller.
 */
export type GiftCardSummary = {
  balanceCents: number
  id: string
  /** The short ID printed on receipts. */
  shopperFacingId: string
  status: GiftCardStatus
}

export const toGiftCardSummary = (card: GiftCard): GiftCardSummary => {
  const balanceCents = decimalToCents(card.balance)

  if (balanceCents === null) {
    throw new GiftCardError(`Gift card ${card.id} has an unreadable balance of "${card.balance}".`)
  }

  return {
    balanceCents,
    id: card.id,
    shopperFacingId: card.shopper_facing_id,
    status: card.status,
  }
}

export const giftCardRefusal = (card: GiftCardSummary): null | string => {
  if (card.status !== "active") return "This gift card is no longer active."
  if (card.balanceCents <= 0) return "This gift card has no balance left."
  return null
}

/**
 * Derived rather than generated, so a retried sale lands on the entry the first
 * attempt made: Vori returns the existing entry for a key it has seen, and that
 * is what stops a retry spending the card twice.
 */
export const giftCardRedemptionKey = (transactionId: string, giftCardId: string): string =>
  `${transactionId}:${giftCardId}`

export const giftCardReversalKey = (transactionId: string, giftCardId: string): string =>
  `${transactionId}:${giftCardId}:reversal`

/**
 * Money off a card for a sale, or back onto it when that sale is reversed.
 *
 * A negative amount spends and a positive one credits. Both directions are
 * `order_payment`: a reversal is the same movement against the same sale, not a
 * correction.
 */
export const buildGiftCardMovement = (args: {
  amountCents: number
  giftCardId: string
  orderId: string
  storeId: string
  transactionId: string
}): CreateGiftCardTransactionRequest => {
  const { amountCents, giftCardId, orderId, storeId, transactionId } = args

  if (!Number.isInteger(amountCents) || amountCents === 0) {
    throw new GiftCardError(
      `Gift card ${giftCardId} was asked to move ${amountCents}, which is not a non-zero whole number of cents.`,
    )
  }

  const spending = amountCents < 0

  return {
    amount: centsToDecimal(amountCents),
    description: spending ? `Online order ${orderId}` : `Reversal of online order ${orderId}`,
    idempotency_key: spending
      ? giftCardRedemptionKey(transactionId, giftCardId)
      : giftCardReversalKey(transactionId, giftCardId),
    order_id: transactionId,
    store_id: storeId,
    type: "order_payment",
  }
}
