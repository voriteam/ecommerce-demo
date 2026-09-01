import { isGiftCardLineItem } from "@lib/util/gift-card"
import { HttpTypes } from "@medusajs/types"
import { Heading, Text } from "@modules/common/components/ui"

const GiftCardsIssued = ({ order }: { order: HttpTypes.StoreOrder }) => {
  const hasGiftCards = (order.items ?? []).some(isGiftCardLineItem)
  if (!hasGiftCards) {
    return null
  }

  const metadata = (order.metadata ?? {}) as Record<string, unknown>
  const giftCardIds = Array.isArray(metadata.vori_gift_card_ids)
    ? (metadata.vori_gift_card_ids as unknown[]).filter(
        (id): id is string => typeof id === "string"
      )
    : []

  return (
    <div className="flex flex-col gap-y-2" data-testid="gift-cards-issued">
      <Heading level="h2" className="flex flex-row text-3xl-regular">
        Gift cards
      </Heading>
      {giftCardIds.length > 0 ? (
        <div className="flex flex-col gap-y-1">
          <Text className="txt-medium text-ui-fg-subtle">
            {giftCardIds.length === 1
              ? "This card was issued and funded:"
              : "These cards were issued and funded:"}
          </Text>
          {giftCardIds.map((id) => (
            <Text
              key={id}
              className="txt-medium-plus text-ui-fg-base font-mono"
              data-testid="gift-card-id"
            >
              {id}
            </Text>
          ))}
        </div>
      ) : (
        <Text className="txt-medium text-ui-fg-subtle">
          The card carries the barcode above and will be issued to its recipient
          shortly.
        </Text>
      )}
    </div>
  )
}

export default GiftCardsIssued
