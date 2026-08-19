import { buildFullRefund, RefundBuildError, type VoriTransaction } from "../refunds"

/** A sale as the transactions endpoint returns it, trimmed to what a refund reads. */
const sale = {
  id: "01a018c3-d54f-72fb-a919-6fb1fb92b2a2",
  external_id: "order_01ABC",
  total: "25.57",
  line_items: [
    {
      id: "line_milk",
      product: { id: "900001" },
      quantity: "2",
      retail_price: "4.99",
      taxable_amount: "0.00",
      tax_total: "0.00",
      total: "9.98",
      promo_savings: "0.00",
      discount_total: "0.00",
    },
    {
      id: "line_beer",
      product: { id: "900003" },
      quantity: "1",
      retail_price: "12.49",
      taxable_amount: "12.49",
      tax_total: "1.03",
      total: "13.52",
      promo_savings: "0.00",
      discount_total: "0.00",
    },
    {
      id: "line_bananas",
      product: { id: "900002" },
      quantity: "1",
      retail_price: "0.69",
      taxable_amount: "0.00",
      tax_total: "0.00",
      total: "2.07",
      promo_savings: "0.00",
      discount_total: "0.00",
    },
  ],
  payments: [{ id: "pay_1", authorized_amount: "25.57", requested_amount: "25.57" }],
} as unknown as VoriTransaction

const refund = (overrides: Partial<Parameters<typeof buildFullRefund>[0]> = {}) =>
  buildFullRefund({
    completedAt: "2026-08-19T17:00:00.000Z",
    original: sale,
    paymentReference: "medusa:01a018c4-0000-7000-8000-000000000000",
    refundId: "01a018c4-0000-7000-8000-000000000000",
    // Bananas sold by weight: three pounds at 0.69.
    weightsByStoreProductId: { "900002": "3" },
    ...overrides,
  })

describe("reversing a sale", () => {
  it("sends the money back as negatives", () => {
    const request = refund()

    expect(request.total).toBe("-25.57")
    expect(request.tax_total).toBe("-1.03")
    expect(request.payments).toEqual([
      {
        amount: "-25.57",
        external_transaction_id: "medusa:01a018c4-0000-7000-8000-000000000000",
        transaction_payment_id: "pay_1",
      },
    ])
  })

  it("keeps retail_price positive, because it is a price and not an amount moving", () => {
    const beer = refund().line_items.find((l) => l.transaction_line_item_id === "line_beer")!

    expect(beer).toMatchObject({
      quantity: "-1",
      retail_price: "12.49",
      tax_total: "-1.03",
      taxable_amount: "-12.49",
      total: "-13.52",
    })
  })

  it("names the line it reverses, since a refund cannot stand on its own", () => {
    expect(refund().line_items.map((l) => l.transaction_line_item_id)).toEqual([
      "line_milk",
      "line_beer",
      "line_bananas",
    ])
  })

  it("reverses the weight of a by-weight line, which the sale does not read back", () => {
    // A read line item carries no weight - `variable_weights` is tare
    // containers - so this comes from the request the sale was made with.
    const bananas = refund().line_items.find((l) => l.transaction_line_item_id === "line_bananas")!

    expect(bananas.weight).toBe("-3")
    expect(bananas.quantity).toBe("-1")
  })

  it("leaves weight off a line that was never weighed", () => {
    expect(
      refund().line_items.find((l) => l.transaction_line_item_id === "line_milk")!.weight,
    ).toBeUndefined()
  })

  it("reverses savings the other way, since they were negative on the sale", () => {
    const discounted = {
      ...sale,
      line_items: [
        {
          ...(sale.line_items[1] as any),
          promo_savings: "-1.00",
          discount_total: "-0.50",
          total: "12.02",
        },
      ],
      payments: [{ id: "pay_1", authorized_amount: "12.02", requested_amount: "12.02" }],
    } as unknown as VoriTransaction

    const line = refund({ original: discounted }).line_items[0]

    expect(line.promo_savings).toBe("1.00")
    expect(line.discount_total).toBe("0.50")
  })

  it("sums the transaction totals from the lines it just built", () => {
    const request = refund()
    const lineTotals = request.line_items.map((l) => Number(l.total))
    const lineTaxes = request.line_items.map((l) => Number(l.tax_total))

    expect(Number(request.total)).toBeCloseTo(
      lineTotals.reduce((a, b) => a + b, 0),
      2,
    )
    expect(Number(request.tax_total)).toBeCloseTo(
      lineTaxes.reduce((a, b) => a + b, 0),
      2,
    )
  })

  it("refuses when the lines and the payments disagree", () => {
    const mismatched = {
      ...sale,
      payments: [{ id: "pay_1", authorized_amount: "20.00", requested_amount: "20.00" }],
    } as unknown as VoriTransaction

    expect(() => refund({ original: mismatched })).toThrow(RefundBuildError)
  })

  it("refuses a sale with nothing on it", () => {
    expect(() => refund({ original: { ...sale, line_items: [] } as VoriTransaction })).toThrow(
      RefundBuildError,
    )
    expect(() => refund({ original: { ...sale, payments: [] } as VoriTransaction })).toThrow(
      RefundBuildError,
    )
  })
})
