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
