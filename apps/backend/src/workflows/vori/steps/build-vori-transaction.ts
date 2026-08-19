import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { v7 as uuidv7 } from "uuid"

import { VORI_MODULE } from "../../../modules/vori"
import { decimalToCents, decimalToCentsRounded } from "../../../modules/vori/lib/money"
import {
  buildTransaction,
  type CreateTransactionRequest,
  type VoriOrderLine,
} from "../../../modules/vori/lib/transactions"
import type VoriModuleService from "../../../modules/vori/service"

export type BuiltTransaction = {
  request: CreateTransactionRequest
  transactionId: string
}

/** The Stripe PaymentIntent, as much of it as the payment record carries. */
type CardPayment = {
  brand: null | string
  last4: null | string
  paidCents: null | number
  reference: string
}

const readCardPayment = (order: Record<string, any>): CardPayment => {
  const payments = (order.payment_collections ?? []).flatMap(
    (collection: Record<string, any>) => collection.payments ?? [],
  )
  const payment = payments[0]

  if (!payment) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Order ${order.id} has no payment to record against.`,
    )
  }

  const data = (payment.data ?? {}) as Record<string, any>
  // Stripe's PaymentIntent is stored verbatim on the payment. Its `id` is the
  // reference a grocer can paste into Stripe to find this charge, which is the
  // whole reason it is carried across.
  const intentId = typeof data.id === "string" ? data.id : null
  const card =
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

/**
 * Turns a placed order into the transaction Vori should record.
 *
 * The transaction ID is minted here and persisted on the order *before*
 * anything is sent, so every later attempt reuses it. That is what makes a
 * retry idempotent rather than a second sale in the grocer's books, and it is
 * why this is its own step ahead of the send.
 */
export const buildVoriTransactionStep = createStep(
  "build-vori-transaction",
  async (input: { orderId: string }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const vori = container.resolve(VORI_MODULE) as VoriModuleService

    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "created_at",
        "metadata",
        // The order's own totals have to be asked for, even though they are
        // not read here: without them Medusa does not run the totals pass and
        // every line comes back with a tax total of zero.
        "total",
        "tax_total",
        "items.*",
        "items.tax_lines.*",
        "items.variant.id",
        "items.variant.metadata",
        "payment_collections.payments.*",
      ],
      filters: { id: input.orderId },
    })

    const order = orders[0]
    if (!order) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${input.orderId} was not found.`)
    }

    const metadata = (order.metadata ?? {}) as Record<string, unknown>
    const transactionId =
      typeof metadata.vori_transaction_id === "string" ? metadata.vori_transaction_id : uuidv7()

    const card = readCardPayment(order)

    const lines: VoriOrderLine[] = ((order.items ?? []) as Record<string, any>[]).map((item) => {
      const variantMetadata = (item.variant?.metadata ?? {}) as Record<string, unknown>
      const title = String(item.title ?? item.variant?.id ?? "unknown item")

      // A tax-inclusive price would put tax inside the subtotal, and every
      // number sent to Vori below would then be wrong by that amount. This
      // store prices tax-exclusive; refuse rather than misstate the books.
      if (item.is_tax_inclusive) {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          `Line "${title}" on order ${order.id} is priced tax-inclusive, which this integration does not record.`,
        )
      }

      return {
        quantity: Number(item.quantity),
        soldByWeight: variantMetadata.vori_sold_by_weight === true,
        // Medusa keeps tax unrounded, so this is rounded here - per line,
        // because that is where Vori rounds. Rounding the order's tax as a
        // whole instead would hand Vori a figure its own per-line arithmetic
        // disagrees with.
        taxCents: decimalToCentsRounded(String(item.tax_total ?? 0)) ?? 0,
        storeProductId:
          typeof variantMetadata.vori_store_product_id === "string"
            ? variantMetadata.vori_store_product_id
            : null,
        title,
        unitPriceCents: decimalToCents(String(item.unit_price)),
      }
    })

    const request = buildTransaction({
      cardBrand: card.brand,
      cardLast4: card.last4,
      order: {
        createdAt: new Date(order.created_at).toISOString(),
        id: order.id,
        lines,
        paidCents: card.paidCents,
      },
      paymentReference: card.reference,
      storeId: vori.options.storeId!,
      transactionId,
    })

    return new StepResponse<BuiltTransaction>({ request, transactionId })
  },
)
