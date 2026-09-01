import { z } from "@medusajs/framework/zod"

/** Exactly one: neither is the empty form, both leaves which to trust undecided. */
export const ApplyGiftCardSchema = z
  .object({
    barcode: z.string().trim().min(1).max(255).optional(),
    gift_card_id: z.string().trim().min(1).max(255).optional(),
  })
  .refine((body) => Boolean(body.barcode) !== Boolean(body.gift_card_id), {
    message: "Provide either a barcode or a gift card ID.",
  })

export const RemoveGiftCardSchema = z.object({
  gift_card_id: z.string().trim().min(1).max(255),
})

export type ApplyGiftCardBody = z.infer<typeof ApplyGiftCardSchema>
export type RemoveGiftCardBody = z.infer<typeof RemoveGiftCardSchema>
