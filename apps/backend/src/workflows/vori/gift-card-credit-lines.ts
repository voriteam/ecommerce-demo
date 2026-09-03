import type { VoriGiftCardPayment } from "../../modules/vori/lib/transactions"

import { decimalToCentsRounded } from "../../modules/vori/lib/money"

/** Paired with `reference_id`, which holds the Vori gift card ID. */
export const GIFT_CARD_CREDIT_LINE_REFERENCE = "vori_gift_card"

type CreditLine = {
  amount: number | string
  reference?: null | string
  reference_id?: null | string
}

/**
 * The gift cards that paid for a cart or an order.
 *
 * Amounts come back positive: that is the direction a credit line runs in Medusa
 * and the direction a payment runs in Vori. Only the debit written against the
 * card itself is negative.
 */
export const giftCardPaymentsFrom = (
  creditLines: readonly (CreditLine | null | undefined)[] | null | undefined,
): VoriGiftCardPayment[] => {
  const payments: VoriGiftCardPayment[] = []

  for (const line of creditLines ?? []) {
    if (line?.reference !== GIFT_CARD_CREDIT_LINE_REFERENCE) continue

    const giftCardId = line.reference_id
    const amountCents = decimalToCentsRounded(String(line.amount))

    if (!giftCardId || amountCents === null || amountCents <= 0) continue

    payments.push({ amountCents, giftCardId })
  }

  return payments
}
