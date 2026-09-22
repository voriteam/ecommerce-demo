import { VoriApiError } from "../errors"
import {
  amountToCents,
  buildCreatePaymentRequest,
  buildCreateRefundRequest,
  PaymentBuildError,
  isUnconfirmedPayment,
  paymentRefusalMessage,
  refundIdempotencyKey,
  remainingRefundableCents,
} from "../payments-api"

const sale = {
  amountCents: 1249,
  cartId: "cart_01",
  currencyCode: "usd",
  mode: "test" as const,
  sessionId: "payses_01",
  storeId: "4320",
  token: "DC4:token",
}

const refusal = (status: number, errorCode: string) =>
  new VoriApiError({
    body: { error_code: errorCode },
    method: "POST",
    path: "/v1/payments",
    status,
  })

describe("building a payment", () => {
  it("charges the session's amount under the session's key", () => {
    expect(buildCreatePaymentRequest(sale)).toEqual({
      amount: "12.49",
      idempotency_key: "payses_01",
      metadata: { medusa_cart_id: "cart_01" },
      mode: "test",
      store_id: "4320",
      token: "DC4:token",
    })
  })

  it("leaves metadata off when there is no cart to name", () => {
    expect(buildCreatePaymentRequest({ ...sale, cartId: null })).not.toHaveProperty("metadata")
  })

  it("refuses anything but US dollars", () => {
    expect(() => buildCreatePaymentRequest({ ...sale, currencyCode: "eur" })).toThrow(
      PaymentBuildError,
    )
  })

  it("refuses a zero or fractional amount", () => {
    expect(() => buildCreatePaymentRequest({ ...sale, amountCents: 0 })).toThrow(PaymentBuildError)
    expect(() => buildCreatePaymentRequest({ ...sale, amountCents: 1.5 })).toThrow(
      PaymentBuildError,
    )
  })
})

describe("building a refund", () => {
  it("keys a refund on the payment, the amount and its position", () => {
    expect(
      buildCreateRefundRequest({
        amountCents: 500,
        index: 1,
        medusaRefundId: "ref_01",
        mode: "live",
        paymentId: "pay_01",
        storeId: "4320",
      }),
    ).toEqual({
      amount: "5.00",
      idempotency_key: "pay_01:5.00:1",
      metadata: { medusa_refund_id: "ref_01" },
      mode: "live",
      payment_id: "pay_01",
      store_id: "4320",
    })
  })

  it("gives a retry of the same refund the same key whatever Medusa calls it", () => {
    const first = buildCreateRefundRequest({
      amountCents: 500,
      index: 0,
      medusaRefundId: "ref_01",
      mode: "test",
      paymentId: "pay_01",
      storeId: "4320",
    })
    const retry = buildCreateRefundRequest({
      amountCents: 500,
      index: 0,
      medusaRefundId: "ref_02",
      mode: "test",
      paymentId: "pay_01",
      storeId: "4320",
    })

    expect(retry.idempotency_key).toBe(first.idempotency_key)
    expect(refundIdempotencyKey("pay_01", 500, 1)).not.toBe(first.idempotency_key)
  })

  it("counts approved and pending refunds against what is left", () => {
    expect(
      remainingRefundableCents(1000, [
        { amount_cents: 200, idempotency_key: "a", status: "approved" },
        { amount_cents: 300, idempotency_key: "b", status: "pending" },
        { amount_cents: 400, idempotency_key: "c", status: "declined" },
        { amount_cents: 100, idempotency_key: "d", skipped: "VORI_WRITE_ENABLED is false" },
      ]),
    ).toBe(500)
  })
})

describe("reading a Medusa amount", () => {
  it("accepts a number, a string, a BigNumber and the raw form", () => {
    expect(amountToCents(12.49)).toBe(1249)
    expect(amountToCents("12.49")).toBe(1249)
    expect(amountToCents({ numeric: 12.49 })).toBe(1249)
    expect(amountToCents({ value: "12.49", precision: 20 })).toBe(1249)
  })

  it("refuses something that is not money", () => {
    expect(() => amountToCents("twelve")).toThrow(PaymentBuildError)
  })
})

describe("explaining a refusal", () => {
  it("tells the shopper about a declined card or refund and a payment still in flight", () => {
    expect(paymentRefusalMessage(refusal(402, "card_declined"))).toMatch(/declined/)
    expect(paymentRefusalMessage(refusal(409, "payment_in_progress"))).toMatch(/still being/)
    expect(paymentRefusalMessage(refusal(402, "refund_declined"))).toMatch(/refund/)
  })

  it("says nothing about a refusal the shopper cannot act on", () => {
    expect(paymentRefusalMessage(refusal(400, "invalid_store"))).toBeNull()
  })
})

describe("recognising a payment nobody can vouch for", () => {
  it("treats a processor timeout as unconfirmed and a decline as settled", () => {
    expect(isUnconfirmedPayment(refusal(504, "payment_processor_timeout"))).toBe(true)
    expect(isUnconfirmedPayment(refusal(402, "card_declined"))).toBe(false)
    expect(isUnconfirmedPayment(new Error("socket hang up"))).toBe(false)
  })
})
