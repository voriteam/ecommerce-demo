import type { Order, Product } from '@/payload-types'

import type { components } from './generated/schema'

import { centsToDecimal, extendCents, sumCents } from './money'

export type CreateTransactionRequest = components['schemas']['CreateTransactionRequest']
export type CreateTransactionLineItem = components['schemas']['CreateTransactionLineItem']
export type CreateTransactionPayment = components['schemas']['CreateTransactionPayment']
export type CreateTransactionCardBrand = components['schemas']['CreateTransactionCardBrand']

/**
 * Stripe's card brands, mapped onto the ones Vori accepts.
 *
 * Anything not in this table is left off the payment rather than guessed at.
 * `card_brand` only drives what a receipt and a report display, so an absent
 * brand is a cosmetic gap; a wrong one is a wrong record.
 */
const CARD_BRANDS: Record<string, CreateTransactionCardBrand> = {
  amex: 'american_express',
  american_express: 'american_express',
  diners: 'diners_club',
  diners_club: 'diners_club',
  discover: 'discover',
  jcb: 'jcb',
  mastercard: 'mastercard',
  unionpay: 'china_union_pay',
  visa: 'visa',
}

export const toVoriCardBrand = (brand: null | string | undefined): CreateTransactionCardBrand | undefined =>
  brand ? CARD_BRANDS[brand.toLowerCase()] : undefined

export class TransactionBuildError extends Error {}

type OrderItem = NonNullable<Order['items']>[number]

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
export const buildLineItem = (args: {
  product: Product
  quantity: number
}): CreateTransactionLineItem => {
  const { product, quantity } = args

  if (!product.voriStoreProductId) {
    throw new TransactionBuildError(
      `Product ${product.id} ("${product.title}") has no Vori store product ID. ` +
        'Only products seeded from Vori can be recorded as a transaction line.',
    )
  }

  const unitCents = product.priceInUSD
  if (typeof unitCents !== 'number') {
    throw new TransactionBuildError(
      `Product ${product.id} ("${product.title}") has no USD price to record.`,
    )
  }

  const totalCents = extendCents(unitCents, quantity)

  return {
    // This demo charges no tax, so a line total is exactly the extended
    // price. See the README for why, and what it would take to change.
    quantity: product.soldByWeight ? '1' : String(quantity),
    retail_price: centsToDecimal(unitCents),
    store_product_id: product.voriStoreProductId,
    tax_total: '0.00',
    taxable_amount: '0.00',
    total: centsToDecimal(totalCents),
    ...(product.soldByWeight ? { weight: String(quantity) } : {}),
  }
}

/**
 * A completed Payload order as the transaction Vori should record.
 *
 * Vori re-adds every line and rejects the transaction unless the line totals
 * sum to `total` and the payments sum to it as well, so the sums here are
 * computed from the same integers the lines were built from rather than taken
 * from the order's own `amount` field. If the two ever disagree, that is a bug
 * worth failing on rather than papering over — so it is checked explicitly.
 */
export const buildTransaction = (args: {
  cardBrand?: null | string
  cardLast4?: null | string
  order: Order
  paymentReference: string
  productsById: Map<number | string, Product>
  storeId: string
  transactionId: string
}): CreateTransactionRequest => {
  const { cardBrand, cardLast4, order, paymentReference, productsById, storeId, transactionId } = args

  const items = order.items ?? []
  if (items.length === 0) {
    throw new TransactionBuildError(`Order ${order.id} has no items to record.`)
  }

  const lineItems: CreateTransactionLineItem[] = []
  const lineTotalsCents: number[] = []

  for (const item of items as OrderItem[]) {
    const productId = typeof item.product === 'object' ? item.product?.id : item.product
    const product = productId === undefined || productId === null ? undefined : productsById.get(productId)

    if (!product) {
      throw new TransactionBuildError(
        `Order ${order.id} references product ${String(productId)}, which could not be loaded.`,
      )
    }

    const line = buildLineItem({ product, quantity: item.quantity })
    lineItems.push(line)
    lineTotalsCents.push(extendCents(product.priceInUSD as number, item.quantity))
  }

  const totalCents = sumCents(lineTotalsCents)

  // The order's own amount is what Stripe actually charged. If our line
  // arithmetic disagrees with it, Vori would reject the transaction anyway —
  // and a silent mismatch between what the shopper paid and what the store's
  // books say is the worst possible outcome here.
  if (typeof order.amount === 'number' && order.amount !== totalCents) {
    throw new TransactionBuildError(
      `Order ${order.id} was charged ${centsToDecimal(order.amount)} but its line items total ` +
        `${centsToDecimal(totalCents)}. Refusing to record a transaction that does not reconcile.`,
    )
  }

  const payment: CreateTransactionPayment = {
    amount: centsToDecimal(totalCents),
    external_transaction_id: paymentReference,
    // Stripe card payments are recorded as the real tender they are. There is
    // no "external" tender type, by design: the store's books should show a
    // card sale, not an unclassified one.
    payment_type: 'credit',
    ...(toVoriCardBrand(cardBrand) ? { card_brand: toVoriCardBrand(cardBrand) } : {}),
    ...(cardLast4 ? { account_number_last4: cardLast4 } : {}),
  }

  return {
    id: transactionId,
    completed_at: new Date(order.createdAt).toISOString(),
    // Our own order number. Vori does not require it to be unique and never
    // interprets it; `id` above is what makes a retry idempotent.
    external_id: String(order.id),
    line_items: lineItems,
    metadata: {
      channel: 'web',
      fulfillment_type: 'pickup',
      payload_order_id: String(order.id),
      source: 'payload-ecommerce-demo',
    },
    payments: [payment],
    // store_id is the only attribution this endpoint needs: Vori maintains
    // the virtual lane and employee that API-submitted orders are recorded
    // against, and naming a staffed lane would be rejected.
    store_id: storeId,
    tax_total: '0.00',
    total: centsToDecimal(totalCents),
  }
}
