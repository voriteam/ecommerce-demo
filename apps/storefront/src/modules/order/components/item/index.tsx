import { HttpTypes } from "@medusajs/types"
import { Table, Text } from "@modules/common/components/ui"

import { isGiftCardLineItem } from "@lib/util/gift-card"
import Barcode from "@modules/common/components/barcode"
import LineItemOptions from "@modules/common/components/line-item-options"
import LineItemPrice from "@modules/common/components/line-item-price"
import LineItemUnitPrice from "@modules/common/components/line-item-unit-price"
import Thumbnail from "@modules/products/components/thumbnail"

type ItemProps = {
  item: HttpTypes.StoreCartLineItem | HttpTypes.StoreOrderLineItem
  currencyCode: string
}

const Item = ({ item, currencyCode }: ItemProps) => {
  const metadata = (item.metadata ?? {}) as Record<string, unknown>
  const isGiftCard = isGiftCardLineItem(item)
  const barcode =
    typeof metadata.gift_card_barcode === "string"
      ? metadata.gift_card_barcode
      : null
  const recipient =
    typeof metadata.gift_card_recipient_phone === "string"
      ? metadata.gift_card_recipient_phone
      : null

  return (
    <Table.Row className="w-full" data-testid="product-row">
      <Table.Cell className="!pl-0 p-4 w-24">
        <div className="flex w-16">
          <Thumbnail thumbnail={item.thumbnail} size="square" />
        </div>
      </Table.Cell>

      <Table.Cell className="text-left">
        <Text
          className="txt-medium-plus text-ui-fg-base"
          data-testid="product-name"
        >
          {item.product_title}
        </Text>
        <LineItemOptions variant={item.variant} data-testid="product-variant" />

        {isGiftCard && (
          <div className="mt-2 flex flex-col gap-y-1" data-testid="gift-card-details">
            {recipient && (
              <Text className="txt-small text-ui-fg-subtle">
                For {recipient}
              </Text>
            )}
            {barcode && (
              <Barcode value={barcode} className="max-w-[200px] h-16" />
            )}
          </div>
        )}
      </Table.Cell>

      <Table.Cell className="!pr-0">
        <span className="!pr-0 flex flex-col items-end h-full justify-center">
          <span className="flex gap-x-1 ">
            <Text className="text-ui-fg-muted">
              <span data-testid="product-quantity">{item.quantity}</span>x{" "}
            </Text>
            <LineItemUnitPrice
              item={item}
              style="tight"
              currencyCode={currencyCode}
            />
          </span>

          <LineItemPrice
            item={item}
            style="tight"
            currencyCode={currencyCode}
          />
        </span>
      </Table.Cell>
    </Table.Row>
  )
}

export default Item
