"use client"

import { setGiftCardRecipients } from "@lib/data/cart"
import { convertToLocale } from "@lib/util/money"
import { CheckCircleSolid } from "@medusajs/icons"
import { HttpTypes } from "@medusajs/types"
import Divider from "@modules/common/components/divider"
import Input from "@modules/common/components/input"
import { Heading, Text } from "@modules/common/components/ui"
import { useActionState } from "react"
import ErrorMessage from "../error-message"
import { SubmitButton } from "../submit-button"

const GiftCardDetails = ({ cart }: { cart: HttpTypes.StoreCart }) => {
  const giftCards = (cart.items ?? []).filter(
    (item) => item.variant?.metadata?.vori_gift_card === true
  )

  const [message, formAction] = useActionState(setGiftCardRecipients, null)

  if (giftCards.length === 0) {
    return null
  }

  const saved = message === "success"

  return (
    <div className="bg-white">
      <div className="flex flex-row items-center gap-x-2 mb-2">
        <Heading level="h2" className="text-3xl-regular">
          Gift card recipient
        </Heading>
        {saved && <CheckCircleSolid />}
      </div>
      <Text className="txt-medium text-ui-fg-subtle mb-6">
        Enter the phone number of whoever the card is for. They get a text with
        the card, and can use it in store right away. Each card already carries a
        barcode we generated when you added it.
      </Text>

      <form action={formAction}>
        <div className="flex flex-col gap-y-6">
          {giftCards.map((item) => (
            <div key={item.id} className="flex flex-col gap-y-2">
              <Text className="txt-medium-plus text-ui-fg-base">
                {item.product_title ?? item.title}
                {" — "}
                {convertToLocale({
                  amount: item.unit_price ?? 0,
                  currency_code: cart.currency_code,
                })}
              </Text>
              <Input
                label="Recipient phone"
                name={`gift_card_recipient.${item.id}`}
                type="tel"
                autoComplete="tel"
                // Kept permissive on shape; the server parses it into a real
                // number and has the final say on whether it is one.
                pattern="\+?1?[\s.\-]?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}(\s*(x|ext\.?)\s*\d+)?"
                title="Enter a 10-digit phone number, for example (415) 555-1234."
                defaultValue={
                  typeof item.metadata?.gift_card_recipient_phone === "string"
                    ? item.metadata.gift_card_recipient_phone
                    : ""
                }
                data-testid="gift-card-recipient-input"
              />
            </div>
          ))}
        </div>
        <SubmitButton className="mt-6" data-testid="save-gift-card-recipients-button">
          Save recipient{giftCards.length > 1 ? "s" : ""}
        </SubmitButton>
        <ErrorMessage
          error={saved ? null : message}
          data-testid="gift-card-error-message"
        />
      </form>
      <Divider className="mt-8" />
    </div>
  )
}

export default GiftCardDetails
