import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { VORI_MODULE } from "../../../../modules/vori"
import { giftCardRefusal, toGiftCardSummary } from "../../../../modules/vori/lib/gift-cards"
import type VoriModuleService from "../../../../modules/vori/service"

/**
 * What a gift card is worth, for a shopper about to spend it.
 *
 * Answers the same way for a card that does not exist as for one that cannot be
 * spent, so this cannot be used to find which barcodes are real.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const vori = req.scope.resolve(VORI_MODULE) as VoriModuleService

  if (!(await vori.canRead())) {
    res.status(400).json({ message: "This store is not connected to Vori." })
    return
  }

  const barcode = typeof req.query.barcode === "string" ? req.query.barcode.trim() : ""
  const id = typeof req.query.id === "string" ? req.query.id.trim() : ""

  if (!barcode && !id) {
    res.status(400).json({ message: "Enter the number printed on your gift card." })
    return
  }

  const found = id ? await vori.getGiftCard(id) : await vori.findGiftCardByBarcode(barcode)
  const card = found ? toGiftCardSummary(found) : null
  const refusal = card ? giftCardRefusal(card) : "No gift card matches that number."

  if (!card || refusal) {
    res.status(404).json({ message: refusal })
    return
  }

  res.json({ gift_card: card })
}
