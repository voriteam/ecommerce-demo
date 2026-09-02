import { Container, Heading, Text } from "@modules/common/components/ui"

import { isStripeLike, paymentInfoMap } from "@lib/constants"
import Divider from "@modules/common/components/divider"
import { convertToLocale } from "@lib/util/money"
import { giftCardLabel, giftCardsOn } from "@lib/util/gift-card-payment"
import { HttpTypes } from "@medusajs/types"

type PaymentDetailsProps = {
  order: HttpTypes.StoreOrder
}

const Tender = ({
  method,
  icon,
  detail,
  testId,
}: {
  method: string
  icon?: React.ReactNode
  detail: string
  testId: string
}) => (
  <div className="flex items-start gap-x-1 w-full">
    <div className="flex flex-col w-1/3">
      <Text className="txt-medium-plus text-ui-fg-base mb-1">Payment method</Text>
      <Text className="txt-medium text-ui-fg-subtle" data-testid="payment-method">
        {method}
      </Text>
    </div>
    <div className="flex flex-col w-2/3">
      <Text className="txt-medium-plus text-ui-fg-base mb-1">Payment details</Text>
      <div className="flex gap-2 txt-medium text-ui-fg-subtle items-center">
        {icon && (
          <Container className="flex items-center h-7 w-fit p-2 bg-ui-button-neutral-hover">
            {icon}
          </Container>
        )}
        <Text data-testid={testId}>{detail}</Text>
      </div>
    </div>
  </div>
)

const PaymentDetails = ({ order }: PaymentDetailsProps) => {
  const payment = order.payment_collections?.[0]?.payments?.[0]
  const giftCards = giftCardsOn(order)

  return (
    <div>
      <Heading level="h2" className="flex flex-row text-3xl-regular my-6">
        Payment
      </Heading>
      <div className="flex flex-col gap-y-4">
        {giftCards.map((line) => (
          <Tender
            key={line.id}
            method="Gift card"
            detail={`${convertToLocale({
              amount: line.amount,
              currency_code: order.currency_code,
            })} from card ${giftCardLabel(line)}`}
            testId="gift-card-payment-amount"
          />
        ))}

        {payment && (
          <Tender
            method={paymentInfoMap[payment.provider_id]?.title ?? payment.provider_id}
            icon={paymentInfoMap[payment.provider_id]?.icon}
            detail={
              isStripeLike(payment.provider_id) && payment.data?.card_last4
                ? `**** **** **** ${payment.data.card_last4}`
                : `${convertToLocale({
                    amount: payment.amount,
                    currency_code: order.currency_code,
                  })} paid at ${new Date(payment.created_at ?? "").toLocaleString()}`
            }
            testId="payment-amount"
          />
        )}
      </div>

      <Divider className="mt-8" />
    </div>
  )
}

export default PaymentDetails
