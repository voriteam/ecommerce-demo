import { HttpTypes } from "@medusajs/types"

/**
 * Whether a variant can be bought right now.
 *
 * The same three questions the product page asks before enabling its add-to-cart
 * button, kept here so a listing and a product page can never disagree about
 * what is on the shelf.
 */
export const variantIsInStock = (
  variant: HttpTypes.StoreProductVariant
): boolean => {
  if (!variant.manage_inventory) return true
  if (variant.allow_backorder) return true
  return (variant.inventory_quantity ?? 0) > 0
}

/** A product is sellable when any of its variants is. */
export const productIsInStock = (product: HttpTypes.StoreProduct): boolean =>
  (product.variants ?? []).some(variantIsInStock)
