import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import {
  createCartCreditLinesWorkflow,
  deleteCartCreditLinesWorkflow,
  refreshPaymentCollectionForCartWorkflow,
} from "@medusajs/medusa/core-flows"

import { VORI_MODULE } from "../../modules/vori"
import {
  giftCardRefusal,
  toGiftCardSummary,
  type GiftCardSummary,
} from "../../modules/vori/lib/gift-cards"
import { decimalToCentsRounded } from "../../modules/vori/lib/money"
import type VoriModuleService from "../../modules/vori/service"
import { GIFT_CARD_CREDIT_LINE_REFERENCE } from "./gift-card-credit-lines"

export type ApplyGiftCardToCartInput = {
  /** Exactly one of these two. */
  barcode?: string
  cartId: string
  giftCardId?: string
}

export type AppliedGiftCard = {
  /** What this card is now covering, in cents. */
  appliedCents: number
  card: GiftCardSummary
}

/**
 * Finds the card a shopper named and works out what it can cover.
 *
 * Capped at what is still owed, so a card worth more than the basket keeps the
 * difference. Refusals are raised here rather than at cart completion, while a
 * shopper can still do something about it.
 */
const resolveGiftCardStep = createStep(
  "resolve-gift-card",
  async (input: ApplyGiftCardToCartInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const vori = container.resolve(VORI_MODULE) as VoriModuleService

    if (!(await vori.canRead())) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Gift cards are unavailable: this store is not connected to Vori.",
      )
    }

    const found = input.giftCardId
      ? await vori.getGiftCard(input.giftCardId)
      : await vori.findGiftCardByBarcode(input.barcode ?? "")

    if (!found) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "No gift card matches that number.")
    }

    const card = toGiftCardSummary(found)
    const refusal = giftCardRefusal(card)
    if (refusal) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, refusal)
    }

    const { data: carts } = await query.graph({
      entity: "cart",
      fields: ["id", "total", "credit_lines.*"],
      filters: { id: input.cartId },
    })

    const cart = carts[0]
    if (!cart) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Cart ${input.cartId} was not found.`)
    }

    const alreadyApplied = ((cart.credit_lines ?? []) as Record<string, any>[]).some(
      (line) => line.reference === GIFT_CARD_CREDIT_LINE_REFERENCE && line.reference_id === card.id,
    )
    if (alreadyApplied) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "That gift card is already paying for this order.",
      )
    }

    // The cart total is already net of any card applied before this one, so
    // two cards split the basket between them rather than both covering it.
    const dueCents = decimalToCentsRounded(String(cart.total)) ?? 0
    if (dueCents <= 0) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "This order is already paid for in full.",
      )
    }

    return new StepResponse<AppliedGiftCard>({
      appliedCents: Math.min(card.balanceCents, dueCents),
      card,
    })
  },
)

/**
 * Puts a gift card against a cart, as a credit line rather than a payment
 * method.
 *
 * That is what lets it pay for part of a basket: a credit line comes off what is
 * left to charge without touching the subtotal or the tax. Cover the basket
 * outright and the total reaches zero, and no payment is asked for at all.
 */
export const applyGiftCardToCartWorkflow = createWorkflow(
  "apply-gift-card-to-cart",
  (input: ApplyGiftCardToCartInput) => {
    const applied = resolveGiftCardStep(input)

    createCartCreditLinesWorkflow.runAsStep({
      input: transform({ applied, input }, (data) => [
        {
          amount: data.applied.appliedCents / 100,
          cart_id: data.input.cartId,
          metadata: {
            gift_card_shopper_facing_id: data.applied.card.shopperFacingId,
          },
          reference: GIFT_CARD_CREDIT_LINE_REFERENCE,
          reference_id: data.applied.card.id,
        },
      ]),
    })

    // The payment collection was priced against the old total, so its amount is
    // re-synced and any session priced against it dropped. Without this a card
    // is charged for a basket a gift card has already paid part of.
    refreshPaymentCollectionForCartWorkflow.runAsStep({
      input: transform({ input }, (data) => ({ cart_id: data.input.cartId })),
    })

    return new WorkflowResponse(applied)
  },
)

export type RemoveGiftCardFromCartInput = {
  cartId: string
  giftCardId: string
}

const findGiftCardCreditLineStep = createStep(
  "find-gift-card-credit-line",
  async (input: RemoveGiftCardFromCartInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: carts } = await query.graph({
      entity: "cart",
      fields: ["id", "credit_lines.*"],
      filters: { id: input.cartId },
    })

    const line = ((carts[0]?.credit_lines ?? []) as Record<string, any>[]).find(
      (creditLine) =>
        creditLine.reference === GIFT_CARD_CREDIT_LINE_REFERENCE &&
        creditLine.reference_id === input.giftCardId,
    )

    if (!line) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "That gift card is not paying for this order.",
      )
    }

    return new StepResponse<string[]>([line.id])
  },
)

export const removeGiftCardFromCartWorkflow = createWorkflow(
  "remove-gift-card-from-cart",
  (input: RemoveGiftCardFromCartInput) => {
    const creditLineIds = findGiftCardCreditLineStep(input)

    deleteCartCreditLinesWorkflow.runAsStep({
      input: transform({ creditLineIds }, (data) => ({ id: data.creditLineIds })),
    })

    refreshPaymentCollectionForCartWorkflow.runAsStep({
      input: transform({ input }, (data) => ({ cart_id: data.input.cartId })),
    })

    return new WorkflowResponse(void 0)
  },
)
