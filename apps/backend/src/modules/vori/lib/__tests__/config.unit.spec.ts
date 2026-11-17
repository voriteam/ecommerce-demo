import { paymentsModeFor } from "../config"

describe("the mode a key charges in", () => {
  it("charges live only for a live key", () => {
    expect(paymentsModeFor("sk_live_abc123")).toBe("live")
    expect(paymentsModeFor("sk_test_abc123")).toBe("test")
  })

  it("charges the test account for a key it cannot place", () => {
    // Test moves no money, so an unreadable key costs a failed checkout
    // rather than a charge nobody meant to make.
    expect(paymentsModeFor("abc123")).toBe("test")
    expect(paymentsModeFor(undefined)).toBe("test")
    expect(paymentsModeFor(null)).toBe("test")
  })
})
