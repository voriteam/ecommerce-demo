"use server"

import { sdk } from "@lib/config"
import { revalidateTag } from "next/cache"

import { getAuthHeaders, getCacheTag, getCartId } from "./cookies"

export type StoreGiftCard = {
  balanceCents: number
  id: string
  shopperFacingId: string
  status: "active" | "deactivated"
}

/**
 * Puts a gift card against the cart, or says why it cannot go on.
 *
 * A refusal comes back as a value rather than an exception: an empty card is an
 * ordinary thing to happen at a checkout, not something the page falls over on.
 */
export async function applyGiftCard(
  currentState: unknown,
  formData: FormData,
): Promise<{ error: null | string }> {
  const number = String(formData.get("gift_card_number") ?? "").trim()

  if (!number) {
    return { error: "Enter the number printed on your gift card." }
  }

  const cartId = await getCartId()
  if (!cartId) {
    return { error: "Your basket has expired. Start again to use a gift card." }
  }

  const headers = { ...(await getAuthHeaders()) }

  // A card ID is a UUID; anything else a shopper types is the barcode.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(number)

  try {
    await sdk.client.fetch(`/store/carts/${cartId}/gift-cards`, {
      method: "POST",
      body: isUuid ? { gift_card_id: number } : { barcode: number },
      headers,
    })
  } catch (error: any) {
    return { error: error?.message ?? "That gift card could not be used." }
  }

  revalidateTag(await getCacheTag("carts"))
  return { error: null }
}

export async function removeGiftCard(giftCardId: string): Promise<{ error: null | string }> {
  const cartId = await getCartId()
  if (!cartId) {
    return { error: "Your basket has expired." }
  }

  const headers = { ...(await getAuthHeaders()) }

  try {
    await sdk.client.fetch(`/store/carts/${cartId}/gift-cards`, {
      method: "DELETE",
      body: { gift_card_id: giftCardId },
      headers,
    })
  } catch (error: any) {
    return { error: error?.message ?? "That gift card could not be removed." }
  }

  revalidateTag(await getCacheTag("carts"))
  return { error: null }
}
