import { HttpTypes } from "@medusajs/types"

type StockLevelProps = {
  inStock: boolean
  variant?: HttpTypes.StoreProductVariant
}

/**
 * What the store has on the shelf.
 *
 * The count comes from Vori and is refreshed by the inventory sync, so this is
 * the number a grocer would see in their own system - which is the point of
 * putting it in front of a shopper on a demo. A variant Medusa does not track
 * inventory for, or one that allows backorders, has no meaningful count to
 * show and says so instead.
 */
const StockLevel = ({ inStock, variant }: StockLevelProps) => {
  if (!variant) {
    return null
  }

  if (!variant.manage_inventory) {
    return (
      <p className="txt-medium text-ui-fg-subtle" data-testid="stock-level">
        Available
      </p>
    )
  }

  const quantity = variant.inventory_quantity ?? 0

  if (!inStock) {
    return (
      <p className="txt-medium text-ui-fg-error" data-testid="stock-level">
        Out of stock
      </p>
    )
  }

  if (variant.allow_backorder && quantity <= 0) {
    return (
      <p className="txt-medium text-ui-fg-subtle" data-testid="stock-level">
        Available to order
      </p>
    )
  }

  return (
    <p className="txt-medium text-ui-fg-subtle" data-testid="stock-level">
      <span className="text-ui-fg-base">{quantity}</span> in stock
      {quantity <= 5 && <span className="text-ui-fg-error"> — low stock</span>}
    </p>
  )
}

export default StockLevel
