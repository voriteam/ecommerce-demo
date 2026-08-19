import { formatPhone, normalizePhone } from "../phone"

describe("keying a shopper on their phone number", () => {
  it("resolves the same number typed any of the usual ways", () => {
    // All one shopper. Treating them as several would split one person's
    // points across duplicate loyalty accounts.
    for (const written of [
      "4155551234",
      "415-555-1234",
      "(415) 555-1234",
      "415.555.1234",
      " 415 555 1234 ",
      "+14155551234",
      "1-415-555-1234",
      "+1 (415) 555-1234",
    ]) {
      expect(normalizePhone(written)).toBe("+14155551234")
    }
  })

  it("refuses an email in the phone field", () => {
    // A real order in this store had an email address sitting in its phone
    // field. Stripping it to digits would have produced a plausible-looking
    // wrong number and enrolled somebody else.
    expect(normalizePhone("clinton.blackburn@gmail.com")).toBeNull()
  })

  it("refuses anything that is not a number it can key on", () => {
    for (const bad of [null, undefined, "", "   ", "abc", "555-1234", "1234567890123456"]) {
      expect(normalizePhone(bad)).toBeNull()
    }
  })

  it("refuses numbers that are the right length but cannot exist", () => {
    // The dangerous direction. Each of these would enrol a junk loyalty
    // account that no future checkout could ever match, and each was accepted
    // by the hand-rolled version this replaced.
    expect(normalizePhone("000-000-0000")).toBeNull()
    expect(normalizePhone("+9999999999")).toBeNull()
    expect(normalizePhone("111-111-1111")).toBeNull()
  })

  it("reads a number that carries an extension", () => {
    // Rejected outright before, which silently dropped loyalty from the sale.
    expect(normalizePhone("415-555-1234 x22")).toBe("+14155551234")
    expect(normalizePhone("(415) 555-1234 ext. 9")).toBe("+14155551234")
  })

  it("reads a real international number rather than assuming it is American", () => {
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958")
  })

  it("shows a matched number back the way a shopper would write it", () => {
    expect(formatPhone("+14155551234")).toBe("(415) 555-1234")
    // A number from somewhere else keeps its country code.
    expect(formatPhone("+442079460958")).toBe("+44 20 7946 0958")
    // Nothing to reformat, so nothing invented.
    expect(formatPhone("not a number")).toBe("not a number")
    expect(formatPhone(null)).toBeNull()
  })
})
