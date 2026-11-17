"use client"

import { loadStripe } from "@stripe/stripe-js"
import React from "react"
import StripeWrapper from "./stripe-wrapper"
import VoriPaymentsWrapper from "./vori-payments-wrapper"
import { HttpTypes } from "@medusajs/types"
import { isStripeLike } from "@lib/constants"
import type { VoriPaymentsSetup } from "@lib/data/vori"

type PaymentWrapperProps = {
  cart: HttpTypes.StoreCart
  children: React.ReactNode
  voriPayments: VoriPaymentsSetup
}

const stripeKey =
  process.env.NEXT_PUBLIC_STRIPE_KEY ||
  process.env.NEXT_PUBLIC_MEDUSA_PAYMENTS_PUBLISHABLE_KEY

const medusaAccountId = process.env.NEXT_PUBLIC_MEDUSA_PAYMENTS_ACCOUNT_ID
const stripePromise = stripeKey
  ? loadStripe(
      stripeKey,
      medusaAccountId ? { stripeAccount: medusaAccountId } : undefined
    )
  : null

const PaymentWrapper: React.FC<PaymentWrapperProps> = ({
  cart,
  children,
  voriPayments,
}) => {
  const paymentSession = cart.payment_collection?.payment_sessions?.find(
    (s) => s.status === "pending"
  )

  if (
    isStripeLike(paymentSession?.provider_id) &&
    paymentSession &&
    stripePromise
  ) {
    return (
      <VoriPaymentsWrapper setup={voriPayments}>
        <StripeWrapper
          paymentSession={paymentSession}
          stripeKey={stripeKey}
          stripePromise={stripePromise}
        >
          {children}
        </StripeWrapper>
      </VoriPaymentsWrapper>
    )
  }

  return (
    <VoriPaymentsWrapper setup={voriPayments}>
      <div>{children}</div>
    </VoriPaymentsWrapper>
  )
}

export default PaymentWrapper
