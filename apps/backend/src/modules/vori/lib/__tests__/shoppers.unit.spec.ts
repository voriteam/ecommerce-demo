import { shopperDetailsToSync, shopperFromCheckout, type VoriShopper } from "../shoppers"

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

const knownAsCheckout = {
  email: "clinton@example.com",
  firstName: "Clinton",
  lastName: "Blackburn",
  postalCode: "94105",
}

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
    expect(shopperDetailsToSync(bare, fromCheckout)).toEqual({
      email_address: "shopper@example.com",
      first_name: "Ada",
      last_name: "Lovelace",
      postal_code: "94105",
    })
  })

  it("never overwrites what the grocer already holds", () => {
    // Their record may have been taken at the till or corrected by staff, and
    // is a better source than whoever's card happened to pay.
    expect(shopperDetailsToSync(known, fromCheckout)).toBeNull()
  })

  it("fills only the field that is actually missing", () => {
    const noEmail = { ...known, email_address: null } as unknown as VoriShopper

    expect(shopperDetailsToSync(noEmail, fromCheckout)).toEqual({
      email_address: "shopper@example.com",
    })
  })

  it("fills a postal code the record is missing, and leaves one it has", () => {
    const noPostcode = { ...known, postal_code: null } as unknown as VoriShopper

    expect(shopperDetailsToSync(noPostcode, fromCheckout)).toEqual({ postal_code: "94105" })
    // Theirs stands, even when checkout has a different one.
    expect(shopperDetailsToSync(known, { ...fromCheckout, postalCode: "10001" })).toBeNull()
  })

  it("says nothing about loyalty enrolment either way", () => {
    // Adding somebody's surname has no business restating whether they are in
    // the programme, and doing so could enrol somebody who had opted out.
    const optedOut = { ...bare, enrolled_in_loyalty_program: false } as unknown as VoriShopper

    expect(shopperDetailsToSync(optedOut, fromCheckout)).not.toHaveProperty(
      "enrolled_in_loyalty_program",
    )
    expect(shopperDetailsToSync(bare, fromCheckout)).not.toHaveProperty(
      "enrolled_in_loyalty_program",
    )
  })

  it("asks for nothing when checkout knows nothing new", () => {
    // Saves a request on every returning shopper.
    expect(shopperDetailsToSync(bare, {})).toBeNull()
    expect(shopperDetailsToSync(bare, { firstName: null, email: null })).toBeNull()
  })
})

describe("correcting a shopper from the checkout form", () => {
  const overwrite = { overwrite: true }

  it("overwrites a name the record already held", () => {
    // The store has opted into treating the form as the current truth.
    expect(shopperDetailsToSync(known, fromCheckout, overwrite)).toEqual({
      email_address: "shopper@example.com",
      first_name: "Ada",
      last_name: "Lovelace",
    })
  })

  it("sends only the fields that actually changed", () => {
    // Their postal code already matches, so it is not restated.
    expect(
      shopperDetailsToSync(known, { ...fromCheckout, firstName: "Clinton" }, overwrite),
    ).toEqual({
      email_address: "shopper@example.com",
      last_name: "Lovelace",
    })
  })

  it("updates a postal code the shopper has changed", () => {
    expect(shopperDetailsToSync(known, { postalCode: "10001" }, overwrite)).toEqual({
      postal_code: "10001",
    })
  })

  it("still fills blanks", () => {
    expect(shopperDetailsToSync(bare, fromCheckout, overwrite)).toEqual({
      email_address: "shopper@example.com",
      first_name: "Ada",
      last_name: "Lovelace",
      postal_code: "94105",
    })
  })

  it("leaves alone what checkout does not know", () => {
    // A form that never asked for a surname must not erase the one on record.
    expect(shopperDetailsToSync(known, { email: "new@example.com" }, overwrite)).toEqual({
      email_address: "new@example.com",
    })
    expect(shopperDetailsToSync(known, { firstName: null, lastName: null }, overwrite)).toBeNull()
  })

  it("asks for nothing when the details already match", () => {
    expect(shopperDetailsToSync(known, knownAsCheckout, overwrite)).toBeNull()
  })

  it("says nothing about loyalty enrolment either way", () => {
    const optedOut = { ...known, enrolled_in_loyalty_program: false } as unknown as VoriShopper

    expect(shopperDetailsToSync(optedOut, fromCheckout, overwrite)).not.toHaveProperty(
      "enrolled_in_loyalty_program",
    )
  })
})
