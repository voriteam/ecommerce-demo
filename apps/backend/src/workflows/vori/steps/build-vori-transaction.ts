import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { v7 as uuidv7 } from "uuid"

import { VORI_MODULE } from "../../../modules/vori"
import { decimalToCents, decimalToCentsRounded, sumCents } from "../../../modules/vori/lib/money"
import { readCardPayment, type CardPayment } from "../../../modules/vori/lib/payments"
import {
  buildTransaction,
  type CreateTransactionRequest,
  type VoriGiftCardPayment,
  type VoriGiftCardSale,
  type VoriOrderLine,
} from "../../../modules/vori/lib/transactions"
import { giftCardPaymentsFrom } from "../gift-card-credit-lines"
import type VoriModuleService from "../../../modules/vori/service"

export type BuiltTransaction = {
  /** The cards to take money off, and how much off each. */
  giftCardPayments: VoriGiftCardPayment[]
  request: CreateTransactionRequest
  transactionId: string
}

/**
 * What the shopper's card was charged, or null when no card was.
 *
 * An order gift cards covered outright carries no payment: cart completion
 * authorises nothing once credit lines take the total to zero. That is a paid
 * order, not a broken one, so the caller decides whether null is an error.
 *
 * The amount sums every payment while the brand and reference come from the
 * first, because those describe a card and an order only ever carries one.
 */
const cardPaymentFor = (order: Record<string, any>): CardPayment | null => {
  const payments = (order.payment_collections ?? []).flatMap(
    (collection: Record<string, any>) => collection.payments ?? [],
  )

  if (payments.length === 0) return null

  return {
    ...readCardPayment(payments[0]),
    paidCents: sumCents(
      payments.map(
        (payment: Record<string, any>) => decimalToCentsRounded(String(payment.amount)) ?? 0,
      ),
    ),
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
        "items.metadata",
        "items.tax_lines.*",
        "items.variant.id",
        "items.variant.metadata",
        "payment_collections.payments.*",
        "credit_lines.*",
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

    // A gift card is not a product and has no store product behind it. It is
    // told apart by a positive flag on its variant, set when the demo seeds the
    // gift card product, rather than by the mere absence of a Vori store product
    // ID - a product that failed to seed correctly should fail loudly as a
    // missing line item, not be silently recorded as a gift card.
    const lines: VoriOrderLine[] = []
    const giftCards: VoriGiftCardSale[] = []

    for (const item of (order.items ?? []) as Record<string, any>[]) {
      const variantMetadata = (item.variant?.metadata ?? {}) as Record<string, unknown>
      const itemMetadata = (item.metadata ?? {}) as Record<string, unknown>
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

      if (variantMetadata.vori_gift_card === true) {
        // Each gift card is a single physical card with its own barcode, so the
        // storefront sells it one to a line. A quantity above one would mean
        // several cards behind one barcode, which is not a card we can issue.
        if (Number(item.quantity) !== 1) {
          throw new MedusaError(
            MedusaError.Types.NOT_ALLOWED,
            `Gift card "${title}" on order ${order.id} has quantity ${item.quantity}; each gift card must be sold one to a line.`,
          )
        }

        giftCards.push({
          amountCents: decimalToCents(String(item.unit_price)) ?? 0,
          barcode:
            typeof itemMetadata.gift_card_barcode === "string"
              ? itemMetadata.gift_card_barcode
              : null,
          recipientPhone:
            typeof itemMetadata.gift_card_recipient_phone === "string"
              ? itemMetadata.gift_card_recipient_phone
              : null,
          title,
        })
        continue
      }

      lines.push({
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
      })
    }

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

    const giftCardPayments = giftCardPaymentsFrom(order.credit_lines)

    if (!card && giftCardPayments.length === 0) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Order ${order.id} has no payment to record against.`,
      )
    }

    const request = buildTransaction({
      cardBrand: card?.brand,
      cardLast4: card?.last4,
      order: {
        createdAt: new Date(order.created_at).toISOString(),
        giftCardPayments,
        giftCards,
        id: order.id,
        lines,
        paidCents: card ? card.paidCents : 0,
      },
      paymentReference: card?.reference,
      shopperId,
      storeId: vori.options.storeId!,
      transactionId,
    })

    return new StepResponse<BuiltTransaction>({ giftCardPayments, request, transactionId })
  },
)
