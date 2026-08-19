import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { v7 as uuidv7 } from "uuid"

import { VORI_MODULE } from "../../../modules/vori"
import { decimalToCents, decimalToCentsRounded } from "../../../modules/vori/lib/money"
import { readCardPayment, type CardPayment } from "../../../modules/vori/lib/payments"
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

const cardPaymentFor = (order: Record<string, any>): CardPayment => {
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

  return readCardPayment(payment)
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
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
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
        "customer.phone",
        "customer.email",
        "customer.first_name",
        "customer.last_name",
        "shipping_address.*",
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

    const card = cardPaymentFor(order)

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

    // The number a shopper gave at checkout is where loyalty starts. The
    // customer record is the fallback for a returning shopper who did not
    // retype it. An unusable number simply means an anonymous sale.
    const address = (order.shipping_address ?? {}) as Record<string, any>
    const customer = (order.customer ?? {}) as Record<string, any>
    const phone = address.phone ?? customer.phone

    let shopperId: string | null = null

    if (phone) {
      try {
        const shopper = await vori.findOrCreateShopper({
          email: customer.email ?? order.email,
          firstName: address.first_name ?? customer.first_name,
          lastName: address.last_name ?? customer.last_name,
          phone,
          postalCode: address.postal_code,
        })
        shopperId = shopper?.id ?? null
      } catch (error) {
        // Loyalty is an addition to the sale, not a condition of it: a shopper
        // service that is down must not stop the grocer's books being right.
        logger.warn(
          `vori: could not resolve a loyalty shopper for order ${order.id} — ` +
            `recording the sale without one (${error instanceof Error ? error.message : String(error)})`,
        )
      }
    }

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
      shopperId,
      storeId: vori.options.storeId!,
      transactionId,
    })

    return new StepResponse<BuiltTransaction>({ request, transactionId })
  },
)
