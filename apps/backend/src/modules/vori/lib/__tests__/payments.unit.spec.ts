import { readCardPayment } from "../payments"

/**
 * The shape Stripe actually stored on a real test-mode card sale.
 *
 * Copied from a payment this store recorded, not from the API reference: the
 * reference describes `latest_charge` as expandable, and the value here is a
 * bare ID string. Reading the card off it produced no error and no card, which
 * is exactly the kind of gap a test is for.
 */
const stripeCardPayment = {
  id: "pay_01ABC",
  amount: 4.49,
  data: {
    id: "pi_3U6BXLRikn0xirYn1PA5S1aN",
    amount: 449,
    latest_charge: "ch_3U6BXLRikn0xirYn1PLmsdzn",
    payment_method: {
      id: "pm_1U6Ba4Rikn0xirYnSPr9ormE",
      card: { brand: "visa", last4: "4242" },
    },
  },
}

describe("reading a card off a payment", () => {
  it("finds the card where Stripe actually puts it", () => {
    expect(readCardPayment(stripeCardPayment)).toEqual({
      brand: "visa",
      last4: "4242",
      paidCents: 449,
      reference: "stripe:pi_3U6BXLRikn0xirYn1PA5S1aN",
    })
  })

  it("does not go looking on the charge, which is only ever an ID", () => {
    // Guards the regression directly: drop the expanded payment method and
    // there is nothing left to read, rather than something read wrongly.
    const withoutMethod = {
      ...stripeCardPayment,
      data: { ...stripeCardPayment.data, payment_method: undefined },
    }

    expect(readCardPayment(withoutMethod)).toMatchObject({ brand: null, last4: null })
  })

  it("reads a charge-expanded intent too, for a payment stored that way", () => {
    const expandedCharge = {
      id: "pay_01ABC",
      amount: 4.49,
      data: {
        id: "pi_123",
        latest_charge: {
          payment_method_details: { card: { brand: "mastercard", last4: "1881" } },
        },
      },
    }

    expect(readCardPayment(expandedCharge)).toMatchObject({
      brand: "mastercard",
      last4: "1881",
      reference: "stripe:pi_123",
    })
  })

  it("still identifies a sale taken without Stripe", () => {
    // The manual provider, used when no Stripe key is configured. No card to
    // describe, but the sale still has to be traceable.
    expect(readCardPayment({ id: "pay_01XYZ", amount: 12.05, data: {} })).toEqual({
      brand: null,
      last4: null,
      paidCents: 1205,
      reference: "medusa:pay_01XYZ",
    })
  })

  it("rounds the amount that moved rather than truncating it", () => {
    expect(readCardPayment({ id: "pay_1", amount: 23.500425, data: {} }).paidCents).toBe(2350)
    expect(readCardPayment({ id: "pay_2", amount: 1.035, data: {} }).paidCents).toBe(104)
  })
})
