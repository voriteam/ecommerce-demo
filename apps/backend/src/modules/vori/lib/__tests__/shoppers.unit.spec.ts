import { missingShopperDetails, shopperFromCheckout, type VoriShopper } from "../shoppers"

const bare = {
  id: "019cfdfa-2b61-7c77-9e27-b5d901ce8e0e",
  phone_number: "+15105551212",
  first_name: null,
  last_name: null,
  email_address: null,
  postal_code: null,
  enrolled_in_loyalty_program: true,
} as unknown as VoriShopper

const known = {
  ...bare,
  first_name: "Clinton",
  last_name: "Blackburn",
  email_address: "clinton@example.com",
  postal_code: "94105",
} as unknown as VoriShopper

const fromCheckout = {
  email: "shopper@example.com",
  firstName: "Ada",
  lastName: "Lovelace",
  postalCode: "94105",
}

describe("enrolling a shopper", () => {
  it("asks for them to be in the loyalty programme, which is the point", () => {
    expect(shopperFromCheckout({ ...fromCheckout, phone: "+14155551234" })).toEqual({
      email_address: "shopper@example.com",
      enrolled_in_loyalty_program: true,
      first_name: "Ada",
      last_name: "Lovelace",
      phone_number: "+14155551234",
      postal_code: "94105",
    })
  })

  it("sends only what checkout actually knows", () => {
    expect(shopperFromCheckout({ phone: "+14155551234" })).toEqual({
      enrolled_in_loyalty_program: true,
      phone_number: "+14155551234",
    })
  })
})

describe("filling in a shopper the store already had", () => {
  it("fills the blanks on a record that is only a phone number", () => {
    // A shopper enrolled at the till often has nothing else on them.
    expect(missingShopperDetails(bare, fromCheckout)).toEqual({
      email_address: "shopper@example.com",
      first_name: "Ada",
      last_name: "Lovelace",
      postal_code: "94105",
    })
  })

  it("never overwrites what the grocer already holds", () => {
    // Their record may have been taken at the till or corrected by staff, and
    // is a better source than whoever's card happened to pay.
    expect(missingShopperDetails(known, fromCheckout)).toBeNull()
  })

  it("fills only the field that is actually missing", () => {
    const noEmail = { ...known, email_address: null } as unknown as VoriShopper

    expect(missingShopperDetails(noEmail, fromCheckout)).toEqual({
      email_address: "shopper@example.com",
    })
  })

  it("fills a postal code the record is missing, and leaves one it has", () => {
    const noPostcode = { ...known, postal_code: null } as unknown as VoriShopper

    expect(missingShopperDetails(noPostcode, fromCheckout)).toEqual({ postal_code: "94105" })
    // Theirs stands, even when checkout has a different one.
    expect(missingShopperDetails(known, { ...fromCheckout, postalCode: "10001" })).toBeNull()
  })

  it("says nothing about loyalty enrolment either way", () => {
    // Adding somebody's surname has no business restating whether they are in
    // the programme, and doing so could enrol somebody who had opted out.
    const optedOut = { ...bare, enrolled_in_loyalty_program: false } as unknown as VoriShopper

    expect(missingShopperDetails(optedOut, fromCheckout)).not.toHaveProperty(
      "enrolled_in_loyalty_program",
    )
    expect(missingShopperDetails(bare, fromCheckout)).not.toHaveProperty(
      "enrolled_in_loyalty_program",
    )
  })

  it("asks for nothing when checkout knows nothing new", () => {
    // Saves a request on every returning shopper.
    expect(missingShopperDetails(bare, {})).toBeNull()
    expect(missingShopperDetails(bare, { firstName: null, email: null })).toBeNull()
  })
})
