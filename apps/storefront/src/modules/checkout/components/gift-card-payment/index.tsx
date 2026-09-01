"use client"

import { applyGiftCard, removeGiftCard } from "@lib/data/gift-cards"
import { convertToLocale } from "@lib/util/money"
import { Trash } from "@medusajs/icons"
import { HttpTypes } from "@medusajs/types"
import Input from "@modules/common/components/input"
import { Button, Heading, Text } from "@modules/common/components/ui"
import { useActionState, useState, useTransition } from "react"

import ErrorMessage from "../error-message"
import { SubmitButton } from "../submit-button"

type CreditLine = {
  amount: number
  id: string
  metadata?: null | Record<string, unknown>
  reference?: null | string
  reference_id?: null | string
}

const GIFT_CARD_REFERENCE = "vori_gift_card"

export const giftCardsOn = (cart: HttpTypes.StoreCart): CreditLine[] =>
  (((cart as unknown as Record<string, unknown>).credit_lines ?? []) as CreditLine[]).filter(
    (line) => line.reference === GIFT_CARD_REFERENCE,
  )

/**
 * A card that does not cover the basket is not refused: it pays what it can and
 * the remainder stays on the payment step, which is why this sits above it.
 */
const GiftCardPayment = ({ cart }: { cart: HttpTypes.StoreCart }) => {
  const [state, formAction] = useActionState(applyGiftCard, { error: null })
  const [removing, startRemoving] = useTransition()
  const [removeError, setRemoveError] = useState<null | string>(null)

  const applied = giftCardsOn(cart)
  const currency = cart.currency_code

  return (
    <div className="bg-white">
      <Heading level="h2" className="text-3xl-regular mb-2">
        Gift card
      </Heading>
      <Text className="txt-medium text-ui-fg-subtle mb-6">
        Paying with a Vori gift card? Enter the number printed on it. We will
        show you what is left on the card before anything is charged.
      </Text>

      {applied.length > 0 && (
        <ul className="flex flex-col gap-y-2 mb-6" data-testid="applied-gift-cards">
          {applied.map((line) => (
            <li
              key={line.id}
              className="flex items-center justify-between border rounded-rounded px-4 py-3"
            >
              <div className="flex flex-col">
                <Text className="txt-medium-plus text-ui-fg-base">
                  Gift card{" "}
                  {String(line.metadata?.gift_card_shopper_facing_id ?? line.reference_id ?? "")}
                </Text>
                <Text className="txt-small text-ui-fg-subtle">
                  Paying {convertToLocale({ amount: line.amount, currency_code: currency })} of this
                  order
                </Text>
              </div>
              <Button
                variant="transparent"
                disabled={removing}
                onClick={() =>
                  startRemoving(async () => {
                    setRemoveError(null)
                    const { error } = await removeGiftCard(String(line.reference_id))
                    setRemoveError(error)
                  })
                }
                data-testid="remove-gift-card-button"
              >
                <Trash />
                <span className="sr-only">Remove this gift card</span>
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form action={formAction}>
        <div className="flex gap-x-2 items-end">
          <div className="grow">
            <Input
              label="Gift card number"
              name="gift_card_number"
              autoComplete="off"
              data-testid="gift-card-input"
            />
          </div>
          <SubmitButton variant="secondary" data-testid="apply-gift-card-button">
            Apply
          </SubmitButton>
        </div>
        <ErrorMessage error={state.error} data-testid="gift-card-error-message" />
      </form>

      <ErrorMessage error={removeError} data-testid="gift-card-remove-error-message" />
    </div>
  )
}

export default GiftCardPayment
