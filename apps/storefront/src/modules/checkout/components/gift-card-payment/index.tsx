"use client"

import { applyGiftCard, removeGiftCard } from "@lib/data/gift-cards"
import { giftCardLabel, giftCardsOn } from "@lib/util/gift-card-payment"
import { convertToLocale } from "@lib/util/money"
import { Trash } from "@medusajs/icons"
import { HttpTypes } from "@medusajs/types"
import Input from "@modules/common/components/input"
import { Button, Text } from "@modules/common/components/ui"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useActionState, useEffect, useRef, useState, useTransition } from "react"

import ErrorMessage from "../error-message"
import { SubmitButton } from "../submit-button"


/**
 * A card that does not cover the basket is not refused: it pays what it can and
 * the remainder stays on the payment step, which is why this sits above it.
 */
const GiftCardPayment = ({ cart }: { cart: HttpTypes.StoreCart }) => {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [state, formAction] = useActionState(applyGiftCard, { error: null })
  const [removing, startRemoving] = useTransition()
  const [removeError, setRemoveError] = useState<null | string>(null)

  const applied = giftCardsOn(cart)
  const currency = cart.currency_code

  // Changing what a card covers changes what is left to charge, so Medusa drops
  // the payment session priced against the old total. Anything entered against
  // it is stale, which is why this reopens the payment step rather than letting
  // the shopper reach a review backed by no session.
  const appliedCount = useRef(applied.length)
  useEffect(() => {
    if (appliedCount.current === applied.length) return
    appliedCount.current = applied.length

    if (searchParams.get("step") !== "payment") {
      const params = new URLSearchParams(searchParams)
      params.set("step", "payment")
      router.push(pathname + "?" + params.toString(), { scroll: false })
    }
  }, [applied.length, pathname, router, searchParams])

  return (
    <div className="mb-6">
      <Text className="txt-medium-plus text-ui-fg-base mb-1">Gift card</Text>
      <Text className="txt-medium text-ui-fg-subtle mb-4">
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
                  Gift card {giftCardLabel(line)}
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
