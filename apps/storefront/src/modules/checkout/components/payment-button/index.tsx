"use client"

import {
  datacapTokenKey,
  isManual,
  isStripeLike,
  isVoriPayments,
  VORI_PAYMENTS_FORM_ID,
} from "@lib/constants"
import { initiatePaymentSession, placeOrder, retrieveCart } from "@lib/data/cart"
import { requestDatacapToken } from "@lib/util/datacap"
import { coveredByGiftCards } from "@lib/util/gift-card-payment"
import { HttpTypes } from "@medusajs/types"
import { Button } from "@modules/common/components/ui"
import { useElements, useStripe } from "@stripe/react-stripe-js"
import React, { useEffect, useState } from "react"
import ErrorMessage from "../error-message"

type PaymentButtonProps = {
  cart: HttpTypes.StoreCart
  "data-testid": string
}

const PaymentButton: React.FC<PaymentButtonProps> = ({
  cart,
  "data-testid": dataTestId,
}) => {
  const notReady =
    !cart ||
    !cart.shipping_address ||
    !cart.billing_address ||
    !cart.email ||
    (cart.shipping_methods?.length ?? 0) < 1

  const paymentSession = cart.payment_collection?.payment_sessions?.[0]

  switch (true) {
    // No payment session to authorise, so nothing to wait for or select.
    case coveredByGiftCards(cart):
      return <GiftCardPaymentButton notReady={notReady} data-testid={dataTestId} />
    case isStripeLike(paymentSession?.provider_id):
      return (
        <StripePaymentButton
          notReady={notReady}
          cart={cart}
          data-testid={dataTestId}
        />
      )
    case isVoriPayments(paymentSession?.provider_id):
      return (
        <VoriPaymentsPaymentButton
          notReady={notReady}
          cart={cart}
          providerId={paymentSession!.provider_id}
          data-testid={dataTestId}
        />
      )
    case isManual(paymentSession?.provider_id):
      return (
        <ManualTestPaymentButton notReady={notReady} data-testid={dataTestId} />
      )
    default:
      return <Button disabled>Select a payment method</Button>
  }
}

const StripePaymentButton = ({
  cart,
  notReady,
  "data-testid": dataTestId,
}: {
  cart: HttpTypes.StoreCart
  notReady: boolean
  "data-testid"?: string
}) => {
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const onPaymentCompleted = async () => {
    await placeOrder()
      .catch((err) => {
        setErrorMessage(err.message)
      })
      .finally(() => {
        setSubmitting(false)
      })
  }

  const stripe = useStripe()
  const elements = useElements()
  const card = elements?.getElement("card")

  const session = cart.payment_collection?.payment_sessions?.find(
    (s) => s.status === "pending"
  )

  const disabled = !stripe || !elements ? true : false

  const handlePayment = async () => {
    setSubmitting(true)

    if (!stripe || !elements || !card || !cart) {
      setSubmitting(false)
      return
    }

    await stripe
      .confirmCardPayment(session?.data.client_secret as string, {
        payment_method: {
          card: card,
          billing_details: {
            name:
              cart.billing_address?.first_name +
              " " +
              cart.billing_address?.last_name,
            address: {
              city: cart.billing_address?.city ?? undefined,
              country: cart.billing_address?.country_code ?? undefined,
              line1: cart.billing_address?.address_1 ?? undefined,
              line2: cart.billing_address?.address_2 ?? undefined,
              postal_code: cart.billing_address?.postal_code ?? undefined,
              state: cart.billing_address?.province ?? undefined,
            },
            email: cart.email,
            phone: cart.billing_address?.phone ?? undefined,
          },
        },
      })
      .then(({ error, paymentIntent }) => {
        if (error) {
          const pi = error.payment_intent

          if (
            (pi && pi.status === "requires_capture") ||
            (pi && pi.status === "succeeded")
          ) {
            return onPaymentCompleted()
          }

          setErrorMessage(error.message || null)
          setSubmitting(false)
          return
        }

        if (
          (paymentIntent && paymentIntent.status === "requires_capture") ||
          paymentIntent.status === "succeeded"
        ) {
          return onPaymentCompleted()
        }

        // Every path that does not place the order has to give the button back,
        // or it spins for good.
        setSubmitting(false)
      })
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : String(error))
        setSubmitting(false)
      })
  }

  return (
    <>
      <Button
        disabled={disabled || notReady}
        onClick={handlePayment}
        size="large"
        isLoading={submitting}
        data-testid={dataTestId}
      >
        Place order
      </Button>
      <ErrorMessage
        error={errorMessage}
        data-testid="stripe-payment-error-message"
      />
    </>
  )
}

const unconfirmedPaymentMessage = (paymentId: unknown) =>
  "We could not confirm your payment, and your card may have been charged. " +
  "Please do not pay again until the store confirms. Placing the order again " +
  "checks the same payment rather than taking a new one." +
  (typeof paymentId === "string"
    ? ` If you contact the store, quote payment ${paymentId}.`
    : "")

const DECLINED_MESSAGE =
  "Your card was declined. Check the details or try another card."

const sessionData = (cart: HttpTypes.StoreCart | null, providerId: string) =>
  cart?.payment_collection?.payment_sessions?.find(
    (session) => session.provider_id === providerId
  )?.data

const isUnconfirmed = (cart: HttpTypes.StoreCart | null, providerId: string) =>
  Boolean(sessionData(cart, providerId)?.vori_payment_unconfirmed_at)

/**
 * Tokenizes at the moment of paying rather than when the card is entered: a
 * token pays once, so every attempt after a decline needs a fresh one, and a
 * fresh session with it.
 */
const VoriPaymentsPaymentButton = ({
  cart,
  notReady,
  providerId,
  "data-testid": dataTestId,
}: {
  cart: HttpTypes.StoreCart
  notReady: boolean
  providerId: string
  "data-testid"?: string
}) => {
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  // What our own post-failure read found, until the cart prop catches up.
  const [checkedUnconfirmed, setCheckedUnconfirmed] = useState<
    boolean | null
  >(null)
  useEffect(() => setCheckedUnconfirmed(null), [cart])
  const unconfirmed = checkedUnconfirmed ?? isUnconfirmed(cart, providerId)

  const handlePayment = async () => {
    setSubmitting(true)
    setErrorMessage(null)

    try {
      // A new token would open a new session, and with it a new idempotency
      // key: the unanswered payment has to be asked about again, not retaken.
      if (unconfirmed) {
        await placeOrder()
        return
      }

      const card = await requestDatacapToken(
        datacapTokenKey,
        VORI_PAYMENTS_FORM_ID
      )

      await initiatePaymentSession(cart, {
        provider_id: providerId,
        data: {
          card_brand: card.Brand,
          cart_id: cart.id,
          last4: card.Last4,
          token: card.Token,
        },
      })

      await placeOrder()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Offline, this read fails too. Then nothing new is known, so what the
      // cart last said about an unconfirmed payment stands.
      const latest = await retrieveCart(
        cart.id,
        "id,*payment_collection.payment_sessions",
        { fresh: true }
      ).catch(() => null)

      if (!latest) {
        setErrorMessage(
          unconfirmed
            ? unconfirmedPaymentMessage(
                sessionData(cart, providerId)?.vori_payment_id
              )
            : message
        )
        return
      }

      const stillUnconfirmed = isUnconfirmed(latest, providerId)
      const declined =
        sessionData(latest, providerId)?.vori_payment_status === "declined"

      setCheckedUnconfirmed(stillUnconfirmed)
      setErrorMessage(
        stillUnconfirmed
          ? unconfirmedPaymentMessage(
              sessionData(latest, providerId)?.vori_payment_id
            )
          : declined
          ? DECLINED_MESSAGE
          : message
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Button
        disabled={notReady}
        isLoading={submitting}
        onClick={handlePayment}
        size="large"
        data-testid={dataTestId}
      >
        Place order
      </Button>
      <ErrorMessage
        error={
          errorMessage ??
          (unconfirmed
            ? unconfirmedPaymentMessage(
                sessionData(cart, providerId)?.vori_payment_id
              )
            : null)
        }
        data-testid="vori-payments-error-message"
      />
    </>
  )
}

const GiftCardPaymentButton = ({
  notReady,
  "data-testid": dataTestId,
}: {
  notReady: boolean
  "data-testid"?: string
}) => {
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handlePayment = () => {
    setSubmitting(true)
    setErrorMessage(null)

    placeOrder().catch((error: Error) => {
      setErrorMessage(error.message)
      setSubmitting(false)
    })
  }

  return (
    <>
      <Button
        disabled={notReady}
        isLoading={submitting}
        onClick={handlePayment}
        size="large"
        data-testid={dataTestId}
      >
        Place order
      </Button>
      <ErrorMessage
        error={errorMessage}
        data-testid="gift-card-payment-error-message"
      />
    </>
  )
}

const ManualTestPaymentButton = ({ notReady }: { notReady: boolean }) => {
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const onPaymentCompleted = async () => {
    await placeOrder()
      .catch((err) => {
        setErrorMessage(err.message)
      })
      .finally(() => {
        setSubmitting(false)
      })
  }

  const handlePayment = () => {
    setSubmitting(true)

    onPaymentCompleted()
  }

  return (
    <>
      <Button
        disabled={notReady}
        isLoading={submitting}
        onClick={handlePayment}
        size="large"
        data-testid="submit-order-button"
      >
        Place order
      </Button>
      <ErrorMessage
        error={errorMessage}
        data-testid="manual-payment-error-message"
      />
    </>
  )
}

export default PaymentButton
