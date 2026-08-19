import { decimalToCentsRounded } from "./money"

/** What a completed payment tells us, reduced to what Vori records. */
export type CardPayment = {
  brand: null | string
  last4: null | string
  /** What the card was actually charged, in cents. */
  paidCents: null | number
  reference: string
}

/**
 * Reads the card off a completed payment.
 *
 * Where the card details sit depends on how the provider stored the payment,
 * and getting it wrong is silent: the sale still records, just without a brand
 * or last four, which nobody notices until a grocer looks at a receipt.
 *
 * For Stripe the payment holds the PaymentIntent verbatim. Its `payment_method`
 * is expanded, so that is where the card is; `latest_charge` is only ever an ID
 * string on a stored intent, whatever the API reference suggests. The other two
 * paths cover an intent expanded differently.
 *
 * A payment with no intent - the manual provider, used when Stripe is not
 * configured - still gets a reference, so the sale can be traced back to
 * something.
 */
export const readCardPayment = (payment: Record<string, any>): CardPayment => {
  const data = (payment.data ?? {}) as Record<string, any>

  const intentId = typeof data.id === "string" ? data.id : null

  const card =
    data.payment_method?.card ??
    data.latest_charge?.payment_method_details?.card ??
    data.charges?.data?.[0]?.payment_method_details?.card

  return {
    brand: card?.brand ?? null,
    last4: card?.last4 ?? null,
    // Rounded, not truncated: this is money that moved, and the card was
    // charged a whole number of cents.
    paidCents: decimalToCentsRounded(String(payment.amount)),
    reference: intentId ? `stripe:${intentId}` : `medusa:${payment.id}`,
  }
}
