import { HttpTypes } from "@medusajs/types"

/**
 * Whether gift cards have covered the basket outright.
 *
 * Cart completion authorises no payment for such a cart, so every check that
 * would otherwise wait for a payment session has to let it through.
 */
export const coveredByGiftCards = (cart: HttpTypes.StoreCart): boolean => {
  const creditLineTotal = Number(
    (cart as unknown as Record<string, unknown>).credit_line_total ?? 0,
  )

  return creditLineTotal > 0 && (cart?.total ?? 0) <= 0
}

export type GiftCardCreditLine = {
  amount: number
  id: string
  metadata?: null | Record<string, unknown>
  reference?: null | string
  reference_id?: null | string
}

export const GIFT_CARD_CREDIT_LINE_REFERENCE = "vori_gift_card"

/** The gift cards paying for a cart or an order. */
export const giftCardsOn = (entity: unknown): GiftCardCreditLine[] =>
  (((entity as Record<string, unknown>)?.credit_lines ?? []) as GiftCardCreditLine[]).filter(
    (line) => line?.reference === GIFT_CARD_CREDIT_LINE_REFERENCE,
  )

/** What a shopper calls the card: the short ID from their receipt. */
export const giftCardLabel = (line: GiftCardCreditLine): string =>
  String(line.metadata?.gift_card_shopper_facing_id ?? line.reference_id ?? "")
