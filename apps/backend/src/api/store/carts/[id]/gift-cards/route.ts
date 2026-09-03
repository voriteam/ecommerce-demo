import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  applyGiftCardToCartWorkflow,
  removeGiftCardFromCartWorkflow,
} from "../../../../../workflows/vori/apply-gift-card-to-cart"
import type { ApplyGiftCardBody, RemoveGiftCardBody } from "./validators"

export const POST = async (
  req: MedusaRequest<ApplyGiftCardBody>,
  res: MedusaResponse,
) => {
  const { result } = await applyGiftCardToCartWorkflow(req.scope).run({
    input: {
      barcode: req.validatedBody.barcode,
      cartId: req.params.id,
      giftCardId: req.validatedBody.gift_card_id,
    },
  })

  res.json({ applied_amount: result.appliedCents / 100, gift_card: result.card })
}

export const DELETE = async (
  req: MedusaRequest<RemoveGiftCardBody>,
  res: MedusaResponse,
) => {
  await removeGiftCardFromCartWorkflow(req.scope).run({
    input: { cartId: req.params.id, giftCardId: req.validatedBody.gift_card_id },
  })

  res.json({ id: req.params.id, object: "cart" })
}
