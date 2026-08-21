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
 * The details this checkout should write onto the shopper's record.
 *
 * Two modes, because there is no single right answer about who knows a
 * shopper's name better. By default only blanks are filled: a grocer's own
 * record may have been taken at the till, corrected by staff, or be the
 * shopper's real name rather than whoever's card happened to pay, so a web
 * form does not get to overwrite it. With `overwrite`, checkout is taken as
 * the current truth instead - which is what a store wants if shoppers move,
 * remarry or fix a typo and expect the change to stick.
 *
 * Either way, what checkout does not know it does not touch: a missing field
 * leaves whatever the grocer holds rather than clearing it. Returns null when
 * there is nothing to send, so a matched shopper costs one request not two.
 */
export const shopperDetailsToSync = (
  shopper: VoriShopper,
  details: {
    email?: null | string
    firstName?: null | string
    lastName?: null | string
    postalCode?: null | string
  },
  { overwrite = false }: { overwrite?: boolean } = {},
): Partial<UpdateShopperRequest> | null => {
  const update: Partial<UpdateShopperRequest> = {}

  // Present on the form, and either genuinely different or filling a blank.
  const wanted = (value: null | string | undefined, held: null | string | undefined) =>
    Boolean(value) && (overwrite ? value !== held : !held)

  if (wanted(details.firstName, shopper.first_name)) update.first_name = details.firstName!
  if (wanted(details.lastName, shopper.last_name)) update.last_name = details.lastName!
  if (wanted(details.email, shopper.email_address)) update.email_address = details.email!
  if (wanted(details.postalCode, shopper.postal_code)) update.postal_code = details.postalCode!

  // Only the fields actually changing are sent. `enrolled_in_loyalty_program`
  // in particular is left out: nothing on this request is required, and a
  // checkout correcting somebody's surname has no business restating whether
  // they are in the loyalty programme.
  return Object.keys(update).length ? update : null
}
