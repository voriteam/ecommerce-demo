import {
  buildGiftCardMovement,
  giftCardRefusal,
  giftCardRedemptionKey,
  giftCardReversalKey,
  GiftCardError,
  toGiftCardSummary,
  type GiftCard,
} from "../gift-cards"

const TRANSACTION_ID = "01a01879-0000-7000-8000-000000000000"
const GIFT_CARD_ID = "01a01879-1111-7000-8000-000000000001"

const card = (overrides: Partial<GiftCard> = {}): GiftCard =>
  ({
    balance: "25.00",
    barcodes: ["VGC000000000001"],
    created_at: "2026-08-19T05:00:00.000Z",
    deactivated_at: null,
    deactivated_by_api_client_id: null,
    deactivated_by_employee_id: null,
    deactivated_by_user_id: null,
    deactivation_reason: null,
    id: GIFT_CARD_ID,
    last_order_at: null,
    magstripe_account_numbers: ["6011000000000000"],
    owner_id: null,
    printed_account_numbers: ["1234567890"],
    purchaser_id: null,
    shopper_facing_id: "GC-1234",
    status: "active",
    updated_at: "2026-08-19T05:00:00.000Z",
    ...overrides,
  }) as GiftCard

describe("a gift card summary", () => {
  it("reads the balance as whole cents", () => {
    expect(toGiftCardSummary(card({ balance: "25.00" })).balanceCents).toBe(2500)
  })

  it("leaves the account numbers behind", () => {
    const summary = toGiftCardSummary(card())

    expect(summary).toEqual({
      balanceCents: 2500,
      id: GIFT_CARD_ID,
      shopperFacingId: "GC-1234",
      status: "active",
    })
    expect(summary).not.toHaveProperty("magstripe_account_numbers")
    expect(summary).not.toHaveProperty("printed_account_numbers")
  })

  it("refuses a balance it cannot read rather than treating it as nothing", () => {
    expect(() => toGiftCardSummary(card({ balance: "" }))).toThrow(GiftCardError)
  })
})

describe("whether a card can be spent", () => {
  it("accepts an active card with money on it", () => {
    expect(giftCardRefusal(toGiftCardSummary(card()))).toBeNull()
  })

  it("refuses a deactivated card", () => {
    expect(giftCardRefusal(toGiftCardSummary(card({ status: "deactivated" })))).toMatch(
      /no longer active/,
    )
  })

  it("refuses an empty card", () => {
    expect(giftCardRefusal(toGiftCardSummary(card({ balance: "0.00" })))).toMatch(/no balance/)
  })

  it("refuses a card in the red", () => {
    expect(giftCardRefusal(toGiftCardSummary(card({ balance: "-5.00" })))).toMatch(/no balance/)
  })
})

describe("moving money on a card", () => {
  const movement = (amountCents: number) =>
    buildGiftCardMovement({
      amountCents,
      giftCardId: GIFT_CARD_ID,
      orderId: "order_01ABC",
      storeId: "12345",
      transactionId: TRANSACTION_ID,
    })

  it("spends with a negative amount against the sale it paid for", () => {
    expect(movement(-1000)).toEqual({
      amount: "-10.00",
      description: "Online order order_01ABC",
      idempotency_key: giftCardRedemptionKey(TRANSACTION_ID, GIFT_CARD_ID),
      order_id: TRANSACTION_ID,
      store_id: "12345",
      type: "order_payment",
    })
  })

  it("returns money under its own key, so a reversal is not mistaken for the payment", () => {
    const returned = movement(1000)

    expect(returned.amount).toBe("10.00")
    expect(returned.idempotency_key).toBe(giftCardReversalKey(TRANSACTION_ID, GIFT_CARD_ID))
    expect(returned.idempotency_key).not.toBe(giftCardRedemptionKey(TRANSACTION_ID, GIFT_CARD_ID))
  })

  it("keys a movement off the transaction rather than the moment", () => {
    expect(movement(-1000).idempotency_key).toBe(movement(-1000).idempotency_key)
  })

  it("refuses to move nothing", () => {
    expect(() => movement(0)).toThrow(GiftCardError)
  })
})
