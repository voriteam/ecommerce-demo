import type { components } from "./generated/schema"

/**
 * Loyalty shoppers.
 *
 * A shopper is identified by their phone number, which is what makes
 * normalising it before any lookup the load-bearing part of this - see
 * lib/phone.ts.
 */

export type VoriShopper = components["schemas"]["Shopper"]
export type CreateShopperRequest = components["schemas"]["CreateShopperRequest"]
export type UpdateShopperRequest = components["schemas"]["UpdateShopperRequest"]

/**
 * What this store knows about a shopper when it enrols one.
 *
 * Enrolled rather than merely created: `enrolled_in_loyalty_program` is what
 * makes the account earn points, and somebody who gave their number at
 * checkout has asked for exactly that.
 */
export const shopperFromCheckout = (details: {
  email?: null | string
  firstName?: null | string
  lastName?: null | string
  phone: string
  postalCode?: null | string
}): CreateShopperRequest => ({
  enrolled_in_loyalty_program: true,
  phone_number: details.phone,
  ...(details.email ? { email_address: details.email } : {}),
  ...(details.firstName ? { first_name: details.firstName } : {}),
  ...(details.lastName ? { last_name: details.lastName } : {}),
  ...(details.postalCode ? { postal_code: details.postalCode } : {}),
})

/**
 * The details this checkout can fill in that the shopper's record is missing.
 *
 * Only ever fills blanks. A grocer's own record is the better source - it may
 * have been taken at the till, corrected by staff, or be the shopper's real
 * name rather than whoever's card paid - so a web form does not get to
 * overwrite it. Returns null when there is nothing to add, so a matched
 * shopper costs one request rather than two.
 */
export const missingShopperDetails = (
  shopper: VoriShopper,
  details: {
    email?: null | string
    firstName?: null | string
    lastName?: null | string
    postalCode?: null | string
  },
): Partial<UpdateShopperRequest> | null => {
  const filled: Partial<UpdateShopperRequest> = {}

  if (!shopper.first_name && details.firstName) filled.first_name = details.firstName
  if (!shopper.last_name && details.lastName) filled.last_name = details.lastName
  if (!shopper.email_address && details.email) filled.email_address = details.email
  if (!shopper.postal_code && details.postalCode) filled.postal_code = details.postalCode

  // Only the fields being filled are sent. `enrolled_in_loyalty_program` in
  // particular is left out: nothing on this request is required, and a
  // checkout adding somebody's surname has no business restating whether they
  // are in the loyalty programme.
  return Object.keys(filled).length ? filled : null
}
