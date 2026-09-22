import { Radio as RadioGroupOption } from "@headlessui/react"
import { Text, clx } from "@modules/common/components/ui"
import React, { useContext, useMemo, useRef, type JSX } from "react"

import Radio from "@modules/common/components/radio"

import { isManual, VORI_PAYMENTS_FORM_ID } from "@lib/constants"
import { datacap } from "@lib/util/datacap"
import SkeletonCardDetails from "@modules/skeletons/components/skeleton-card-details"
import { CardElement } from "@stripe/react-stripe-js"
import { StripeCardElementOptions } from "@stripe/stripe-js"
import PaymentTest from "../payment-test"
import { StripeContext } from "../payment-wrapper/stripe-wrapper"
import { DatacapContext } from "../payment-wrapper/vori-payments-wrapper"

type PaymentContainerProps = {
  paymentProviderId: string
  selectedPaymentOptionId: string | null
  disabled?: boolean
  paymentInfoMap: Record<string, { title: string; icon: JSX.Element }>
  children?: React.ReactNode
}

const PaymentContainer: React.FC<PaymentContainerProps> = ({
  paymentProviderId,
  selectedPaymentOptionId,
  paymentInfoMap,
  disabled = false,
  children,
}) => {
  const isDevelopment = process.env.NODE_ENV === "development"

  return (
    <RadioGroupOption
      key={paymentProviderId}
      value={paymentProviderId}
      disabled={disabled}
      className={clx(
        "flex flex-col gap-y-2 text-small-regular cursor-pointer py-4 border rounded-rounded px-8 mb-2 hover:shadow-borders-interactive-with-active",
        {
          "border-ui-border-interactive":
            selectedPaymentOptionId === paymentProviderId,
        }
      )}
    >
      <div className="flex items-center justify-between ">
        <div className="flex items-center gap-x-4">
          <Radio checked={selectedPaymentOptionId === paymentProviderId} />
          <Text className="text-base-regular">
            {paymentInfoMap[paymentProviderId]?.title || paymentProviderId}
          </Text>
          {isManual(paymentProviderId) && isDevelopment && (
            <PaymentTest className="hidden small:block" />
          )}
        </div>
        <span className="justify-self-end text-ui-fg-base">
          {paymentInfoMap[paymentProviderId]?.icon}
        </span>
      </div>
      {isManual(paymentProviderId) && isDevelopment && (
        <PaymentTest className="small:hidden text-[10px]" />
      )}
      {children}
    </RadioGroupOption>
  )
}

export default PaymentContainer

export const StripeCardContainer = ({
  paymentProviderId,
  selectedPaymentOptionId,
  paymentInfoMap,
  disabled = false,
  setCardBrand,
  setError,
  setCardComplete,
}: Omit<PaymentContainerProps, "children"> & {
  setCardBrand: (brand: string) => void
  setError: (error: string | null) => void
  setCardComplete: (complete: boolean) => void
}) => {
  const stripeReady = useContext(StripeContext)

  const useOptions: StripeCardElementOptions = useMemo(() => {
    return {
      style: {
        base: {
          fontFamily: "Inter, sans-serif",
          color: "#424270",
          "::placeholder": {
            color: "rgb(107 114 128)",
          },
        },
      },
      classes: {
        base: "pt-3 pb-1 block w-full h-11 px-4 mt-0 bg-ui-bg-field border rounded-md appearance-none focus:outline-none focus:ring-0 focus:shadow-borders-interactive-with-active border-ui-border-base hover:bg-ui-bg-field-hover transition-all duration-300 ease-in-out",
      },
    }
  }, [])

  return (
    <PaymentContainer
      paymentProviderId={paymentProviderId}
      selectedPaymentOptionId={selectedPaymentOptionId}
      paymentInfoMap={paymentInfoMap}
      disabled={disabled}
    >
      {selectedPaymentOptionId === paymentProviderId &&
        (stripeReady ? (
          <div className="my-4 transition-all duration-150 ease-in-out">
            <Text className="txt-medium-plus text-ui-fg-base mb-1">
              Enter your card details:
            </Text>
            <CardElement
              options={useOptions as StripeCardElementOptions}
              onChange={(e) => {
                setCardBrand(
                  e.brand && e.brand.charAt(0).toUpperCase() + e.brand.slice(1)
                )
                setError(e.error?.message || null)
                setCardComplete(e.complete)
              }}
            />
          </div>
        ) : (
          <SkeletonCardDetails />
        ))}
    </PaymentContainer>
  )
}

const cardInputClassName =
  "pt-3 pb-1 block w-full h-11 px-4 mt-0 bg-ui-bg-field border rounded-md appearance-none focus:outline-none focus:ring-0 focus:shadow-borders-interactive-with-active border-ui-border-base hover:bg-ui-bg-field-hover transition-all duration-300 ease-in-out"

/**
 * The card form Datacap tokenizes. Datacap finds the fields by their
 * `data-token` attribute and requires them to carry no `id` or `name`, which
 * also keeps the browser from ever submitting them anywhere.
 */
export const VoriPaymentsCardContainer = ({
  paymentProviderId,
  selectedPaymentOptionId,
  paymentInfoMap,
  disabled = false,
  setCardComplete,
}: Omit<PaymentContainerProps, "children"> & {
  setCardComplete: (complete: boolean) => void
}) => {
  const datacapReady = useContext(DatacapContext)
  const formRef = useRef<HTMLFormElement>(null)

  const validate = () => {
    const client = datacap()
    const form = formRef.current
    if (!client || !form) return setCardComplete(false)

    const value = (field: string) =>
      form.querySelector<HTMLInputElement>(`[data-token="${field}"]`)?.value ??
      ""

    setCardComplete(
      client.validateCardNumber(value("card_number")) &&
        client.validateExpirationDate(value("exp_month"), value("exp_year")) &&
        client.validateCVV(value("cvv"))
    )
  }

  return (
    <PaymentContainer
      paymentProviderId={paymentProviderId}
      selectedPaymentOptionId={selectedPaymentOptionId}
      paymentInfoMap={paymentInfoMap}
      disabled={disabled}
    >
      {selectedPaymentOptionId === paymentProviderId &&
        (datacapReady ? (
          <form
            id={VORI_PAYMENTS_FORM_ID}
            ref={formRef}
            onInput={validate}
            onSubmit={(event) => event.preventDefault()}
            className="my-4 flex flex-col gap-y-2 transition-all duration-150 ease-in-out"
            data-testid="vori-payments-card-form"
          >
            <Text className="txt-medium-plus text-ui-fg-base mb-1">
              Enter your card details:
            </Text>
            <input
              data-token="card_number"
              aria-label="Card number"
              placeholder="Card number"
              inputMode="numeric"
              autoComplete="cc-number"
              className={cardInputClassName}
            />
            <div className="grid grid-cols-3 gap-x-2">
              <input
                data-token="exp_month"
                aria-label="Expiry month"
                placeholder="MM"
                inputMode="numeric"
                maxLength={2}
                autoComplete="cc-exp-month"
                className={cardInputClassName}
              />
              <input
                data-token="exp_year"
                aria-label="Expiry year"
                placeholder="YYYY"
                inputMode="numeric"
                maxLength={4}
                autoComplete="cc-exp-year"
                className={cardInputClassName}
              />
              <input
                data-token="cvv"
                aria-label="Security code"
                placeholder="CVV"
                inputMode="numeric"
                maxLength={4}
                autoComplete="cc-csc"
                className={cardInputClassName}
              />
            </div>
          </form>
        ) : (
          <SkeletonCardDetails />
        ))}
    </PaymentContainer>
  )
}
