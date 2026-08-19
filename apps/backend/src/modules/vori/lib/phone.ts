import { parsePhoneNumberFromString } from "libphonenumber-js"

/**
 * Phone numbers, as a loyalty account is identified by.
 *
 * A shopper is keyed by their phone number, so the same number typed three
 * different ways has to resolve to one account. "(415) 555-1234",
 * "415-555-1234" and "+1 415 555 1234" are one shopper; treating them as three
 * would put duplicate loyalty accounts into a grocer's database and split one
 * person's points across them.
 *
 * This is a parsing problem rather than a formatting one, so it uses a real
 * phone number library rather than a regex. An account key has to reject what
 * is not a number as reliably as it accepts what is: a hand-rolled version
 * here waved through impossible area codes and nonexistent country codes,
 * either of which enrols a junk shopper that nobody can ever match again.
 */

/** Numbers with no country code are read as US, which is where the store is. */
const DEFAULT_COUNTRY = "US"

/** E.164, or null when it is not a number we can key a loyalty account on. */
export const normalizePhone = (value: null | string | undefined): null | string => {
  if (!value) return null

  const parsed = parsePhoneNumberFromString(String(value).trim(), DEFAULT_COUNTRY)

  // `isValid` rather than `isPossible`: possible only checks the length, and a
  // number that is the right length but not a real one is exactly the sort
  // that creates an account no future checkout will ever match.
  return parsed?.isValid() ? parsed.number : null
}

/** "+14155551234" -> "(415) 555-1234", for showing a shopper what we matched. */
export const formatPhone = (e164: null | string | undefined): null | string => {
  if (!e164) return null

  const parsed = parsePhoneNumberFromString(e164)
  if (!parsed?.isValid()) return e164

  return parsed.country === DEFAULT_COUNTRY ? parsed.formatNational() : parsed.formatInternational()
}
