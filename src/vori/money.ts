/**
 * Money conversions between Payload and Vori.
 *
 * Payload stores prices as an integer number of minor units — the ecommerce
 * plugin hands `paymentIntent.amount` straight to Stripe, so a $4.99 product
 * is 499. Vori takes decimal strings ("4.99") and re-checks the arithmetic on
 * every line and on the transaction as a whole, rejecting anything that does
 * not reconcile.
 *
 * Everything here is integer arithmetic on cents for that reason. No value
 * becomes a float at any point: `0.1 + 0.2` in a line total is the difference
 * between a recorded transaction and a 400.
 */

/** 499 → "4.99". Negative values keep the sign in front: -50 → "-0.50". */
export const centsToDecimal = (cents: number): string => {
  if (!Number.isInteger(cents)) {
    throw new TypeError(`Expected an integer number of cents, received ${cents}`)
  }

  const negative = cents < 0
  const absolute = Math.abs(cents)
  const dollars = Math.floor(absolute / 100)
  const remainder = absolute % 100

  return `${negative ? '-' : ''}${dollars}.${String(remainder).padStart(2, '0')}`
}

/**
 * "4.99" → 499. Accepts the decimal strings Vori returns for prices, which
 * may carry more than two decimal places or none at all.
 */
export const decimalToCents = (value: null | number | string | undefined): null | number => {
  if (value === null || value === undefined || value === '') return null

  const text = String(value).trim()
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null

  const negative = text.startsWith('-')
  const [whole, fraction = ''] = text.replace('-', '').split('.')
  const hundredths = `${fraction}00`.slice(0, 2)
  const cents = Number(whole) * 100 + Number(hundredths)

  return negative ? -cents : cents
}

/** Extended price for a line: unit price in cents × a whole-number quantity. */
export const extendCents = (unitCents: number, quantity: number): number => {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new RangeError(`Quantity must be a positive whole number, received ${quantity}`)
  }
  return unitCents * quantity
}

export const sumCents = (values: number[]): number => values.reduce((total, n) => total + n, 0)
