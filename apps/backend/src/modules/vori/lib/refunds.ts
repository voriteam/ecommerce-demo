import type { components } from "./generated/schema"

import { centsToDecimal, decimalToCents, sumCents } from "./money"

/**
 * Recording a refund against a sale Vori already holds.
 *
 * The shapes come from the generated schema, so the sign rules below are the
 * only thing here a spec cannot express.
 */

export type VoriTransaction = components["schemas"]["Transaction"]
export type CreateRefundRequest = components["schemas"]["CreateRefundRequest"]
export type CreateRefundLineItem = components["schemas"]["CreateRefundLineItem"]
export type CreateRefundPayment = components["schemas"]["CreateRefundPayment"]

export class RefundBuildError extends Error {}

/** "8.62" -> "-8.62", via cents so no value ever becomes a float. */
const negate = (value: null | string | undefined): string => {
  const cents = decimalToCents(value ?? "0") ?? 0
  return centsToDecimal(-Math.abs(cents))
}

/**
 * "3" -> "-3", "112.4" -> "-112.4".
 *
 * Quantities and weights are counts and scale readings, not money, so they
 * keep whatever precision the sale recorded rather than being rounded to two
 * decimal places. A weight in particular can be fractional to more places than
 * currency allows.
 */
const negateAmount = (value: null | string | undefined): string => {
  const text = String(value ?? "0").trim()
  if (!text || Number(text) === 0) return text || "0"
  return text.startsWith("-") ? text.slice(1) : `-${text}`
}

/**
 * Reverses a whole sale.
 *
 * Only a full reversal is expressed here, because a refund line has to name
 * the line it reverses and a partial refund in this store is an amount with no
 * items attached to it. Guessing which products came back would put the wrong
 * items back on a grocer's shelves and misstate their tax, so the caller is
 * expected to refuse a partial rather than approximate one.
 *
 * The sign rules are the endpoint's own, and they are not uniform:
 *
 *   - quantities, weights, taxable amounts, tax totals, line totals, the
 *     transaction totals and every payment amount all go negative;
 *   - `retail_price` stays positive, because it is the price the item sold at
 *     rather than an amount moving;
 *   - `promo_savings` and `discount_total` stay positive, because they reverse
 *     savings that were themselves recorded negative on the sale.
 */
export const buildFullRefund = (args: {
  completedAt: string
  original: VoriTransaction
  /** The processor's own reference for the money going back. Always required. */
  paymentReference: string
  refundId: string
  /**
   * Weights as they were sent on the sale, by Vori store product ID.
   *
   * A read line item carries no weight - `variable_weights` is about tare
   * containers, not the amount that went on the scale - so the only place the
   * figure survives is the request this store recorded when it made the sale.
   * Absent for an each-priced line, which has no weight to reverse.
   */
  weightsByStoreProductId?: Record<string, string>
}): CreateRefundRequest => {
  const { completedAt, original, paymentReference, refundId, weightsByStoreProductId } = args

  if (!original.line_items?.length) {
    throw new RefundBuildError(`Transaction ${original.id} has no line items to reverse.`)
  }

  if (!original.payments?.length) {
    throw new RefundBuildError(`Transaction ${original.id} has no payment to refund against.`)
  }

  const lineItems: CreateRefundLineItem[] = original.line_items.map((line) => {
    const weight = weightsByStoreProductId?.[line.product?.id ?? ""]

    return {
      quantity: negateAmount(line.quantity),
      // The price it sold at. A refund cannot restate it.
      retail_price: line.retail_price,
      tax_total: negate(line.tax_total),
      taxable_amount: negate(line.taxable_amount),
      total: negate(line.total),
      transaction_line_item_id: line.id,
      // Savings reverse the other way: they were negative on the sale.
      ...(decimalToCents(line.promo_savings ?? "0")
        ? { promo_savings: centsToDecimal(Math.abs(decimalToCents(line.promo_savings) ?? 0)) }
        : {}),
      ...(decimalToCents(line.discount_total ?? "0")
        ? { discount_total: centsToDecimal(Math.abs(decimalToCents(line.discount_total) ?? 0)) }
        : {}),
      ...(weight ? { weight: negateAmount(weight) } : {}),
    }
  })

  const payments: CreateRefundPayment[] = original.payments.map((payment) => ({
    amount: negate(payment.authorized_amount ?? payment.requested_amount),
    external_transaction_id: paymentReference,
    transaction_payment_id: payment.id,
  }))

  // Summed from the lines rather than negating the sale's own totals, so the
  // same per-line arithmetic Vori re-checks is what produced them.
  const taxTotal = sumCents(lineItems.map((line) => decimalToCents(line.tax_total) ?? 0))
  const total = sumCents(lineItems.map((line) => decimalToCents(line.total) ?? 0))

  const paid = sumCents(payments.map((payment) => decimalToCents(payment.amount) ?? 0))

  if (paid !== total) {
    throw new RefundBuildError(
      `Refund of ${original.id} returns ${centsToDecimal(total)} across its lines but ` +
        `${centsToDecimal(paid)} across its payments. Refusing to record one that does not reconcile.`,
    )
  }

  return {
    completed_at: completedAt,
    id: refundId,
    line_items: lineItems,
    payments,
    tax_total: centsToDecimal(taxTotal),
    total: centsToDecimal(total),
  }
}
