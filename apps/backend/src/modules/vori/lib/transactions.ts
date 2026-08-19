import type { components } from "./generated/schema"

import { centsToDecimal, extendCents, sumCents } from "./money"

export type CreateTransactionRequest = components["schemas"]["CreateTransactionRequest"]
export type CreateTransactionLineItem = components["schemas"]["CreateTransactionLineItem"]
export type CreateTransactionPayment = components["schemas"]["CreateTransactionPayment"]
export type CreateTransactionCardBrand = components["schemas"]["CreateTransactionCardBrand"]

/**
 * One line of a placed order, reduced to what Vori needs.
 *
 * The workflow flattens Medusa's order graph into this before building a
 * request, which keeps everything below here pure: no container, no query, no
 * order DTO, and therefore testable without booting an application.
 */
export type VoriOrderLine = {
  /** Whole pounds when sold by weight, otherwise a count of units. */
  quantity: number
  soldByWeight: boolean
  /** Sales tax charged on this line, in cents. Zero for an untaxed item. */
  taxCents: number
  /** For error messages only. */
  title: string
  /** Null when the variant did not come from Vori. */
  storeProductId: null | string | undefined
  unitPriceCents: null | number
}

export type VoriOrderSnapshot = {
  /** ISO 8601. Becomes the transaction's `completed_at`. */
  createdAt: string
  id: string
  lines: VoriOrderLine[]
  /** What the shopper was actually charged, in cents. Null when unknown. */
  paidCents: null | number
}

/**
 * Stripe's card brands, mapped onto the ones Vori accepts.
 *
 * Anything not in this table is left off the payment rather than guessed at.
 * `card_brand` only drives what a receipt and a report display, so an absent
 * brand is a cosmetic gap; a wrong one is a wrong record.
 */
const CARD_BRANDS: Record<string, CreateTransactionCardBrand> = {
  amex: "american_express",
  american_express: "american_express",
  diners: "diners_club",
  diners_club: "diners_club",
  discover: "discover",
  jcb: "jcb",
  mastercard: "mastercard",
  unionpay: "china_union_pay",
  visa: "visa",
}

export const toVoriCardBrand = (
  brand: null | string | undefined,
): CreateTransactionCardBrand | undefined => (brand ? CARD_BRANDS[brand.toLowerCase()] : undefined)

export class TransactionBuildError extends Error {}

/**
 * One order line as a Vori transaction line.
 *
 * The quantity/weight split is the interesting part. For an each-priced
 * product the cart quantity is a count of units. For a per-pound product the
 * shelf price is per pound and the cart quantity is a number of pounds, which
 * the API wants expressed as quantity 1 plus an explicit weight — so the same
 * integer arithmetic produces the line total either way, and only the two
 * fields differ.
 */
export const buildLineItem = (line: VoriOrderLine): CreateTransactionLineItem => {
  if (!line.storeProductId) {
    throw new TransactionBuildError(
      `Line "${line.title}" has no Vori store product ID. ` +
        "Only products seeded from Vori can be recorded as a transaction line.",
    )
  }

  if (typeof line.unitPriceCents !== "number") {
    throw new TransactionBuildError(`Line "${line.title}" has no unit price to record.`)
  }

  const extendedCents = extendCents(line.unitPriceCents, line.quantity)
  const taxCents = line.taxCents

  if (!Number.isInteger(taxCents) || taxCents < 0) {
    throw new TransactionBuildError(
      `Line "${line.title}" has a tax total of ${taxCents}, which is not a whole number of cents.`,
    )
  }

  return {
    quantity: line.soldByWeight ? "1" : String(line.quantity),
    retail_price: centsToDecimal(line.unitPriceCents),
    store_product_id: line.storeProductId,
    tax_total: centsToDecimal(taxCents),
    // The whole line is taxable when any tax was charged on it. This demo has
    // no partial exemptions, and reporting a taxable amount that disagrees
    // with the tax charged would misstate the grocer's tax base.
    taxable_amount: centsToDecimal(taxCents > 0 ? extendedCents : 0),
    total: centsToDecimal(extendedCents + taxCents),
    ...(line.soldByWeight ? { weight: String(line.quantity) } : {}),
  }
}

/**
 * A completed order as the transaction Vori should record.
 *
 * Vori re-adds every line and rejects the transaction unless the line totals
 * sum to `total` and the payments sum to it as well, so the sums here are
 * computed from the same integers the lines were built from rather than taken
 * from the order's own paid amount. If the two ever disagree, that is a bug
 * worth failing on rather than papering over — so it is checked explicitly.
 */
export const buildTransaction = (args: {
  cardBrand?: null | string
  cardLast4?: null | string
  order: VoriOrderSnapshot
  paymentReference: string
  /** The loyalty account this sale earns points for, when there is one. */
  shopperId?: null | string
  storeId: string
  transactionId: string
}): CreateTransactionRequest => {
  const { cardBrand, cardLast4, order, paymentReference, shopperId, storeId, transactionId } = args

  if (order.lines.length === 0) {
    throw new TransactionBuildError(`Order ${order.id} has no items to record.`)
  }

  const lineItems: CreateTransactionLineItem[] = []
  const lineTotalsCents: number[] = []
  const lineTaxesCents: number[] = []

  for (const line of order.lines) {
    lineItems.push(buildLineItem(line))
    lineTotalsCents.push(extendCents(line.unitPriceCents as number, line.quantity) + line.taxCents)
    lineTaxesCents.push(line.taxCents)
  }

  // Tax-inclusive, because that is what a line total is. Both sums are taken
  // over the per-line figures rather than recomputed from the order, because
  // Vori rounds tax at the line and re-adds from there.
  const totalCents = sumCents(lineTotalsCents)
  const taxTotalCents = sumCents(lineTaxesCents)

  // The paid amount is what the card was actually charged. If our line
  // arithmetic disagrees with it, Vori would reject the transaction anyway —
  // and a silent mismatch between what the shopper paid and what the store's
  // books say is the worst possible outcome here.
  if (typeof order.paidCents === "number" && order.paidCents !== totalCents) {
    const drift = Math.abs(order.paidCents - totalCents)

    throw new TransactionBuildError(
      `Order ${order.id} was charged ${centsToDecimal(order.paidCents)} but its line items total ` +
        `${centsToDecimal(totalCents)}. Refusing to record a transaction that does not reconcile.` +
        // Vori rounds tax per line; a checkout that rounds the order's tax as
        // a whole lands a penny or two away on a basket of taxed lines.
        (drift <= order.lines.length
          ? " The difference is within rounding of the taxed lines, so this is most likely a tax rounding mismatch rather than a pricing error."
          : ""),
    )
  }

  const payment: CreateTransactionPayment = {
    amount: centsToDecimal(totalCents),
    external_transaction_id: paymentReference,
    // Card payments are recorded as the real tender they are. There is no
    // "external" tender type, by design: the store's books should show a card
    // sale, not an unclassified one.
    payment_type: "credit",
    ...(toVoriCardBrand(cardBrand) ? { card_brand: toVoriCardBrand(cardBrand) } : {}),
    ...(cardLast4 ? { account_number_last4: cardLast4 } : {}),
  }

  return {
    id: transactionId,
    completed_at: new Date(order.createdAt).toISOString(),
    // Our own order number. Vori does not require it to be unique and never
    // interprets it; `id` above is what makes a retry idempotent.
    external_id: order.id,
    line_items: lineItems,
    metadata: {
      channel: "web",
      fulfillment_type: "pickup",
      order_id: order.id,
      source: "vori-ecommerce-demo",
    },
    payments: [payment],
    // Links the sale to a loyalty account so it earns points. Left off for a
    // shopper we could not identify, which records an anonymous sale rather
    // than crediting the wrong person.
    ...(shopperId ? { shopper_id: shopperId } : {}),
    // store_id is the only attribution this endpoint needs: Vori maintains the
    // virtual lane and employee that API-submitted orders are recorded
    // against, and naming a staffed lane would be rejected.
    store_id: storeId,
    tax_total: centsToDecimal(taxTotalCents),
    total: centsToDecimal(totalCents),
  }
}
