import {
  buildLineItem,
  buildTransaction,
  toVoriCardBrand,
  TransactionBuildError,
  type VoriOrderLine,
  type VoriOrderSnapshot,
} from "../transactions"

const milk: VoriOrderLine = {
  quantity: 2,
  soldByWeight: false,
  storeProductId: "900001",
  taxCents: 0,
  title: "Clover Whole Milk, Half Gallon",
  unitPriceCents: 499,
}

const bananas: VoriOrderLine = {
  quantity: 3,
  soldByWeight: true,
  storeProductId: "900002",
  taxCents: 0,
  title: "Bananas",
  unitPriceCents: 69,
}

/** $12.49 six-pack at CA's 8.25%, which rounds to 103 cents. */
const beer: VoriOrderLine = {
  quantity: 1,
  soldByWeight: false,
  storeProductId: "900003",
  taxCents: 103,
  title: "Lagunitas IPA 6-Pack",
  unitPriceCents: 1249,
}

const order = (lines: VoriOrderLine[], paidCents: null | number): VoriOrderSnapshot => ({
  createdAt: "2026-08-19T05:00:00.000Z",
  id: "order_01ABC",
  lines,
  paidCents,
})

const record = (snapshot: VoriOrderSnapshot) =>
  buildTransaction({
    order: snapshot,
    paymentReference: "stripe:pi_123",
    storeId: "12345",
    transactionId: "01a01879-0000-7000-8000-000000000000",
  })

describe("a line item", () => {
  it("counts units for an each-priced product", () => {
    expect(buildLineItem(milk)).toEqual({
      quantity: "2",
      retail_price: "4.99",
      store_product_id: "900001",
      tax_total: "0.00",
      taxable_amount: "0.00",
      total: "9.98",
    })
  })

  it("puts tax inside the line total, which is what the API means by total", () => {
    // total = retail_price x quantity + tax_total. A line reporting the
    // pre-tax figure fails Vori's own arithmetic check even though every
    // individual number on it is right.
    expect(buildLineItem(beer)).toEqual({
      quantity: "1",
      retail_price: "12.49",
      store_product_id: "900003",
      tax_total: "1.03",
      taxable_amount: "12.49",
      total: "13.52",
    })
  })

  it("reports nothing taxable on an untaxed line", () => {
    expect(buildLineItem(milk).taxable_amount).toBe("0.00")
  })

  it("taxes a per-pound line on the weighed amount, not on one unit", () => {
    const weighed = buildLineItem({ ...bananas, taxCents: 17 })

    expect(weighed).toMatchObject({
      quantity: "1",
      weight: "3",
      taxable_amount: "2.07",
      tax_total: "0.17",
      total: "2.24",
    })
  })

  it("refuses a tax total that is not a whole number of cents", () => {
    expect(() => buildLineItem({ ...beer, taxCents: 103.4 })).toThrow(TransactionBuildError)
    expect(() => buildLineItem({ ...beer, taxCents: -1 })).toThrow(TransactionBuildError)
  })

  it("sends a per-pound product as one unit plus an explicit weight", () => {
    expect(buildLineItem(bananas)).toEqual({
      quantity: "1",
      retail_price: "0.69",
      store_product_id: "900002",
      tax_total: "0.00",
      taxable_amount: "0.00",
      total: "2.07",
      weight: "3",
    })
  })

  it("refuses a line that did not come from Vori", () => {
    expect(() => buildLineItem({ ...milk, storeProductId: null })).toThrow(TransactionBuildError)
  })

  it("refuses a line with no price rather than recording a free sale", () => {
    expect(() => buildLineItem({ ...milk, unitPriceCents: null })).toThrow(TransactionBuildError)
  })
})

describe("a transaction", () => {
  it("reconciles line totals against the payment and the transaction total", () => {
    const transaction = record(order([milk, bananas], 1205))

    expect(transaction.total).toBe("12.05")
    expect(transaction.tax_total).toBe("0.00")
    expect(transaction.payments).toEqual([
      {
        amount: "12.05",
        external_transaction_id: "stripe:pi_123",
        payment_type: "credit",
      },
    ])
  })

  it("sums the line taxes into the transaction tax total", () => {
    // Groceries untaxed, beer taxed: the mixed basket a grocer actually rings
    // up. 9.98 + 2.07 + 13.52 = 25.57, of which 1.03 is tax.
    const transaction = record(order([milk, bananas, beer], 2557))

    expect(transaction.tax_total).toBe("1.03")
    expect(transaction.total).toBe("25.57")
    expect(transaction.payments[0].amount).toBe("25.57")

    const lineTaxes = transaction.line_items.map((line) => line.tax_total)
    expect(lineTaxes).toEqual(["0.00", "0.00", "1.03"])
  })

  it("sums the taxes the lines actually carry, because Vori rounds at the line", () => {
    // Two lines whose unrounded taxes are 0.345 each round to 0.35 apiece, so
    // Vori re-adds 0.70. A transaction reporting the 0.69 that the pair's
    // unrounded sum rounds to would fail Vori's own arithmetic.
    const half = { ...beer, taxCents: 35, unitPriceCents: 418, quantity: 1 }
    const transaction = record(order([half, { ...half, storeProductId: "900009" }], 906))

    expect(transaction.tax_total).toBe("0.70")
    expect(transaction.line_items.map((l) => l.tax_total)).toEqual(["0.35", "0.35"])
    expect(transaction.total).toBe("9.06")
  })

  it("refuses when the card was charged the pre-tax amount", () => {
    // The classic off-by-tax: charging 24.54 and booking 25.57 would leave the
    // shopper's statement disagreeing with the grocer's books.
    expect(() => record(order([milk, bananas, beer], 2454))).toThrow(
      /was charged 24.54 but its line items total 25.57/,
    )
  })

  it("says so when the gap is small enough to be a rounding mismatch", () => {
    // A penny apart on a taxed basket is almost always the two systems
    // rounding tax differently, and saying so saves an hour of hunting.
    expect(() => record(order([milk, bananas, beer], 2556))).toThrow(/tax rounding mismatch/)
    // Far apart is a real pricing error, and should not be explained away.
    expect(() => record(order([milk, bananas, beer], 1000))).not.toThrow(/tax rounding mismatch/)
  })

  it("refuses to record a sale whose lines disagree with what was charged", () => {
    // The worst outcome here is a silent mismatch between the shopper's card
    // statement and the grocer's books, so this fails loudly instead.
    expect(() => record(order([milk, bananas], 1300))).toThrow(
      /was charged 13.00 but its line items total 12.05/,
    )
  })

  it("accepts an order whose paid amount is unknown", () => {
    expect(record(order([milk], null)).total).toBe("9.98")
  })

  it("refuses an order with nothing in it", () => {
    expect(() => record(order([], 0))).toThrow(TransactionBuildError)
  })

  it("carries the order number and its own idempotency key separately", () => {
    const transaction = record(order([milk], 998))

    // `id` is what makes a retry idempotent; `external_id` is only our label.
    expect(transaction.id).toBe("01a01879-0000-7000-8000-000000000000")
    expect(transaction.external_id).toBe("order_01ABC")
    expect(transaction.metadata).toMatchObject({ channel: "web", fulfillment_type: "pickup" })
  })

  it("attaches the card brand and last four when they are known", () => {
    const transaction = buildTransaction({
      cardBrand: "Visa",
      cardLast4: "4242",
      order: order([milk], 998),
      paymentReference: "stripe:pi_123",
      storeId: "12345",
      transactionId: "01a01879-0000-7000-8000-000000000000",
    })

    expect(transaction.payments[0]).toMatchObject({
      account_number_last4: "4242",
      card_brand: "visa",
    })
  })

  it("leaves an unrecognised brand off rather than guessing at one", () => {
    // A missing brand is a cosmetic gap on a receipt; a wrong one is a wrong
    // record.
    expect(toVoriCardBrand("interac")).toBeUndefined()
    expect(toVoriCardBrand(null)).toBeUndefined()
    expect(toVoriCardBrand("AMEX")).toBe("american_express")
    expect(toVoriCardBrand("unionpay")).toBe("china_union_pay")
  })
})

describe("loyalty", () => {
  it("links the sale to a shopper when one was identified", () => {
    const transaction = buildTransaction({
      order: order([milk], 998),
      paymentReference: "stripe:pi_123",
      shopperId: "1f0a9b2c-3d4e-7f60-8a1b-2c3d4e5f6a7b",
      storeId: "12345",
      transactionId: "01a01879-0000-7000-8000-000000000000",
    })

    expect(transaction.shopper_id).toBe("1f0a9b2c-3d4e-7f60-8a1b-2c3d4e5f6a7b")
  })

  it("records an anonymous sale rather than crediting the wrong person", () => {
    // No shopper is not an error. Sending a placeholder or somebody else's
    // account would put points on the wrong loyalty record.
    expect(record(order([milk], 998)).shopper_id).toBeUndefined()
  })
})
